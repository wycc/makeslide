#!/usr/bin/env python3
"""Qwen-Image-2.1 as a standalone HTTP service for MakeSlide.

Runs the open-weight model (https://github.com/QwenLM/Qwen-Image-2.1) through the official
Diffusers pipeline and exposes it over a small JSON API, so the MakeSlide backend can draw and
edit slide images through it exactly as it does through OpenAI. Nothing in here depends on the
MakeSlide code base: put this directory on whichever machine has the GPU, point the backend's
Qwen base URL at it (settings page → 圖片供應商 → Qwen), done.

    python3 server.py --model Qwen/Qwen-Image-2.1 --host 0.0.0.0 --port 8765 --token <secret>

API (all JSON; images travel as base64 / data URLs):
    GET  /health                    → {"ok": true, "ready": true, "model": ..., "device": ...}
    POST /v1/images/generations     {"prompt", "size": "1536x1024", "n": 1, "seed"?, "negative_prompt"?}
    POST /v1/images/edits           {"prompt", "size"?, "images": ["data:image/png;base64,..."], "mask"?: "data:..."}
                                    → {"created": <unix>, "data": [{"b64_json": "<png>"}]}

A mask follows the OpenAI convention: transparent pixels mark the region that may change. The
model itself takes no mask, so the server pastes the model's output back into the original only
where the mask is transparent — everything else stays byte-identical.

`--stub` serves placeholder images without loading any model (a rendered prompt on a coloured
canvas), for wiring tests and for developing on a machine without a GPU.
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

try:
    from PIL import Image, ImageDraw
except ImportError:  # pragma: no cover - the doc lists pillow as a requirement
    print("pillow is required: pip install pillow", file=sys.stderr)
    raise

DEFAULT_SIZE = (1536, 1024)
MAX_REFERENCE_IMAGES = 10


def parse_size(size: str | None, max_pixels: int) -> tuple[int, int]:
    """OpenAI-style `WxH` → (w, h) rounded to multiples of 16 and capped at `max_pixels`."""
    width, height = DEFAULT_SIZE
    if size and size.lower() != "auto":
        parts = size.lower().replace("×", "x").replace("*", "x").split("x")
        if len(parts) == 2 and parts[0].strip().isdigit() and parts[1].strip().isdigit():
            width, height = int(parts[0]), int(parts[1])
    if width * height > max_pixels:
        scale = (max_pixels / (width * height)) ** 0.5
        width, height = int(width * scale), int(height * scale)
    width = max(64, (width // 16) * 16)
    height = max(64, (height // 16) * 16)
    return width, height


def decode_image(data: str) -> Image.Image:
    """A data URL or bare base64 → PIL image."""
    if "," in data and data.startswith("data:"):
        data = data.split(",", 1)[1]
    return Image.open(io.BytesIO(base64.b64decode(data)))


def encode_png(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def apply_mask(original: Image.Image, generated: Image.Image, mask: Image.Image) -> Image.Image:
    """Keep `original` everywhere the mask is opaque; take `generated` where it is transparent."""
    base = original.convert("RGBA")
    result = generated.convert("RGBA").resize(base.size, Image.LANCZOS)
    alpha = mask.convert("RGBA").resize(base.size, Image.NEAREST).getchannel("A")
    # composite(a, b, m): m=255 → a. We want the generated pixels where the mask is transparent (alpha 0).
    return Image.composite(result, base, alpha.point(lambda a: 255 - a))


class StubPipeline:
    """No model: draws the prompt on a canvas so the round trip can be exercised anywhere."""

    device = "stub"

    def __call__(self, prompt: str, images: list[Image.Image], width: int, height: int, steps: int, seed: int | None, negative_prompt: str | None) -> Image.Image:
        tint = (40 + (hash(prompt) % 120), 80, 120 + (len(images) * 30) % 100)
        canvas = Image.new("RGB", (width, height), tint)
        draw = ImageDraw.Draw(canvas)
        draw.text((16, 16), f"stub · {width}x{height} · refs={len(images)}", fill=(255, 255, 255))
        draw.text((16, 40), prompt[:200], fill=(255, 255, 255))
        return canvas


class DiffusersPipeline:
    """The real thing: QwenImage21Pipeline, text-to-image and image-conditioned generation."""

    def __init__(self, model: str, device: str, dtype: str, cpu_offload: bool) -> None:
        import torch  # imported lazily so --stub needs neither torch nor diffusers
        from diffusers import QwenImage21Pipeline

        torch_dtype = {"bfloat16": torch.bfloat16, "float16": torch.float16, "float32": torch.float32}[dtype]
        pipe = QwenImage21Pipeline.from_pretrained(model, torch_dtype=torch_dtype)
        if cpu_offload:
            # Keeps only the active sub-model on the GPU; the way to run the 7B model on ~8 GB cards.
            pipe.enable_model_cpu_offload(device=device)
        else:
            pipe = pipe.to(device)
        self.pipe = pipe
        self.torch = torch
        self.device = device

    def __call__(self, prompt: str, images: list[Image.Image], width: int, height: int, steps: int, seed: int | None, negative_prompt: str | None) -> Image.Image:
        generator = self.torch.Generator(self.device).manual_seed(seed) if seed is not None else None
        kwargs: dict[str, Any] = {"prompt": prompt, "num_inference_steps": steps, "width": width, "height": height, "generator": generator}
        if negative_prompt:
            kwargs["negative_prompt"] = negative_prompt
        if images:
            kwargs["image"] = [img.convert("RGB") for img in images[:MAX_REFERENCE_IMAGES]]
        return self.pipe(**kwargs).images[0]


class Service:
    def __init__(self, pipeline: Any, model: str, steps: int, max_pixels: int, token: str | None) -> None:
        self.pipeline = pipeline
        self.model = model
        self.steps = steps
        self.max_pixels = max_pixels
        self.token = token
        # One generation at a time: the GPU is the bottleneck and concurrent runs just fight for VRAM.
        self.lock = threading.Lock()

    def generate(self, body: dict[str, Any], edit: bool) -> dict[str, Any]:
        prompt = str(body.get("prompt") or "").strip()
        if not prompt:
            raise ValueError("prompt is required")
        images = [decode_image(d) for d in (body.get("images") or [])] if edit else []
        if edit and not images:
            raise ValueError("images[] is required for edits")
        mask = decode_image(body["mask"]) if body.get("mask") else None
        if images:
            # Edits keep the reference size unless the caller asked for something else.
            width, height = parse_size(body.get("size") or f"{images[0].width}x{images[0].height}", self.max_pixels)
        else:
            width, height = parse_size(body.get("size"), self.max_pixels)
        seed = body.get("seed")
        started = time.time()
        with self.lock:
            out = self.pipeline(prompt, images, width, height, int(body.get("steps") or self.steps), int(seed) if seed is not None else None, body.get("negative_prompt"))
        if mask is not None and images:
            out = apply_mask(images[0], out, mask)
        n = int(body.get("n") or 1)
        print(f"[qwen-image] {'edit' if edit else 'generate'} {width}x{height} refs={len(images)} mask={mask is not None} {time.time() - started:.1f}s", flush=True)
        return {"created": int(time.time()), "data": [{"b64_json": encode_png(out)} for _ in range(max(1, n))]}


def make_handler(service: Service):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, status: int, payload: dict[str, Any]) -> None:
            raw = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def _authorized(self) -> bool:
            if not service.token:
                return True
            header = self.headers.get("Authorization", "")
            return header == f"Bearer {service.token}"

        def do_GET(self) -> None:  # noqa: N802
            if self.path.split("?")[0] == "/health":
                self._send(200, {"ok": True, "ready": True, "model": service.model, "device": getattr(service.pipeline, "device", "?")})
                return
            self._send(404, {"error": {"message": f"Invalid URL (GET {self.path})"}})

        def do_POST(self) -> None:  # noqa: N802
            path = self.path.split("?")[0]
            if path not in ("/v1/images/generations", "/v1/images/edits"):
                self._send(404, {"error": {"message": f"Invalid URL (POST {self.path})"}})
                return
            if not self._authorized():
                self._send(401, {"error": {"message": "invalid or missing bearer token"}})
                return
            length = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(length) or b"{}")
                result = service.generate(body, edit=path.endswith("/edits"))
            except ValueError as err:
                self._send(400, {"error": {"message": str(err)}})
                return
            except Exception as err:  # noqa: BLE001 - surface model errors to the caller
                self._send(500, {"error": {"message": f"{type(err).__name__}: {err}"}})
                return
            self._send(200, result)

        def log_message(self, fmt: str, *args: Any) -> None:  # quieter default logging
            print(f"[qwen-image] {self.address_string()} {fmt % args}", flush=True)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description="Qwen-Image-2.1 HTTP service for MakeSlide")
    parser.add_argument("--model", default=os.environ.get("QWEN_IMAGE_MODEL", "Qwen/Qwen-Image-2.1"), help="Hugging Face id or local path")
    parser.add_argument("--host", default=os.environ.get("QWEN_IMAGE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("QWEN_IMAGE_PORT", "8765")), help="0 = pick a free port")
    parser.add_argument("--device", default=os.environ.get("QWEN_IMAGE_DEVICE", "cuda"))
    parser.add_argument("--dtype", default=os.environ.get("QWEN_IMAGE_DTYPE", "bfloat16"), choices=["bfloat16", "float16", "float32"])
    parser.add_argument("--cpu-offload", action="store_true", default=os.environ.get("QWEN_IMAGE_CPU_OFFLOAD") == "1", help="enable_model_cpu_offload (for cards with little VRAM)")
    parser.add_argument("--steps", type=int, default=int(os.environ.get("QWEN_IMAGE_STEPS", "40")))
    parser.add_argument("--max-pixels", type=int, default=int(os.environ.get("QWEN_IMAGE_MAX_PIXELS", str(2048 * 2048))))
    parser.add_argument("--token", default=os.environ.get("QWEN_IMAGE_SERVER_TOKEN") or None, help="require `Authorization: Bearer <token>` (set it when exposing the port)")
    parser.add_argument("--stub", action="store_true", help="serve placeholder images without loading a model")
    args = parser.parse_args()

    if args.stub:
        pipeline: Any = StubPipeline()
    else:
        print(f"[qwen-image] loading {args.model} on {args.device} ({args.dtype}, cpu_offload={args.cpu_offload}) …", flush=True)
        pipeline = DiffusersPipeline(args.model, args.device, args.dtype, args.cpu_offload)
        print("[qwen-image] model ready", flush=True)

    service = Service(pipeline, "stub" if args.stub else args.model, args.steps, args.max_pixels, args.token)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(service))
    host, port = server.server_address[:2]
    print(f"[qwen-image] listening on http://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
