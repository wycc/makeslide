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
# Room left for activations at 2048x2048 on top of the weights before the whole pipeline is
# allowed to sit on the GPU; below that, auto mode turns on model CPU offload.
OFFLOAD_HEADROOM_BYTES = 6 * 1024 ** 3


def parse_offload(value: str | None) -> bool | None:
    """QWEN_IMAGE_CPU_OFFLOAD: 1/true/on → force on, 0/false/off → force off, unset/auto → decide from VRAM."""
    v = (value or "auto").strip().lower()
    if v in ("1", "true", "yes", "on"):
        return True
    if v in ("0", "false", "no", "off"):
        return False
    return None


def is_loopback(host: str) -> bool:
    return host in ("localhost", "::1") or host.startswith("127.")


def reachable_urls(host: str, port: int) -> list[str]:
    """For a wildcard bind (0.0.0.0 / ::), the URLs to type into MakeSlide's settings."""
    import socket

    addrs: list[str] = []
    try:
        # The address the default route would use — the one other machines on the LAN can reach.
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 9))  # TEST-NET-1; UDP connect sends nothing
            addrs.append(probe.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addrs.append(str(info[4][0]))
    except OSError:
        pass
    urls = [f"http://{a}:{port}" for a in dict.fromkeys(addrs) if not a.startswith("127.")]
    return urls + [f"http://127.0.0.1:{port}"]


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

    def __init__(self, model: str, device: str, dtype: str, cpu_offload: bool | None) -> None:
        import torch  # imported lazily so --stub needs neither torch nor diffusers
        from diffusers import QwenImage21Pipeline

        torch_dtype = {"bfloat16": torch.bfloat16, "float16": torch.float16, "float32": torch.float32}[dtype]
        pipe = QwenImage21Pipeline.from_pretrained(model, torch_dtype=torch_dtype)
        if cpu_offload is None:
            cpu_offload = self._needs_offload(torch, pipe, device)
        if cpu_offload:
            # Keeps only the active sub-model on the GPU, so the peak is the largest component
            # (the ~17 GB text encoder in bf16) rather than the whole ~32 GB pipeline.
            pipe.enable_model_cpu_offload(device=device)
        else:
            pipe = pipe.to(device)
        self.pipe = pipe
        self.torch = torch
        self.device = device
        self.cpu_offload = cpu_offload

    @staticmethod
    def _needs_offload(torch: Any, pipe: Any, device: str) -> bool:
        """Auto mode: offload unless the whole pipeline plus working room fits in the free VRAM.

        Measured from the loaded weights and the card's *free* memory, so a smaller dtype, a
        bigger card or another process already holding VRAM all come out right."""
        if not str(device).startswith("cuda") or not torch.cuda.is_available():
            return False
        weights = sum(
            p.numel() * p.element_size()
            for module in pipe.components.values()
            if isinstance(module, torch.nn.Module)
            for p in module.parameters()
        )
        free, _total = torch.cuda.mem_get_info(torch.device(device))
        needed = weights + OFFLOAD_HEADROOM_BYTES
        gib = 1024 ** 3
        offload = needed > free
        print(
            f"[qwen-image] weights {weights / gib:.1f} GiB + {OFFLOAD_HEADROOM_BYTES / gib:.0f} GiB headroom vs "
            f"{free / gib:.1f} GiB free VRAM → cpu offload {'on' if offload else 'off'} "
            f"(force with --cpu-offload / --no-cpu-offload)",
            flush=True,
        )
        return offload

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
    parser.add_argument("--host", default=os.environ.get("QWEN_IMAGE_HOST", "127.0.0.1"), help="0.0.0.0 (or ::) listens on every interface so other machines can reach it — set --token too")
    parser.add_argument("--port", type=int, default=int(os.environ.get("QWEN_IMAGE_PORT", "8765")), help="0 = pick a free port")
    parser.add_argument("--device", default=os.environ.get("QWEN_IMAGE_DEVICE", "cuda"))
    parser.add_argument("--dtype", default=os.environ.get("QWEN_IMAGE_DTYPE", "bfloat16"), choices=["bfloat16", "float16", "float32"])
    offload = parser.add_mutually_exclusive_group()
    offload.add_argument("--cpu-offload", dest="cpu_offload", action="store_const", const=True, help="force enable_model_cpu_offload")
    offload.add_argument("--no-cpu-offload", dest="cpu_offload", action="store_const", const=False, help="force the whole pipeline onto the GPU")
    parser.set_defaults(cpu_offload=parse_offload(os.environ.get("QWEN_IMAGE_CPU_OFFLOAD")))
    parser.add_argument("--steps", type=int, default=int(os.environ.get("QWEN_IMAGE_STEPS", "40")))
    parser.add_argument("--max-pixels", type=int, default=int(os.environ.get("QWEN_IMAGE_MAX_PIXELS", str(2048 * 2048))))
    parser.add_argument("--token", default=os.environ.get("QWEN_IMAGE_SERVER_TOKEN") or None, help="require `Authorization: Bearer <token>` (set it when exposing the port)")
    parser.add_argument("--stub", action="store_true", help="serve placeholder images without loading a model")
    args = parser.parse_args()

    if not is_loopback(args.host) and not args.token:
        # Warn before the (slow) model load so it is not buried under the progress bars.
        print(
            f"[qwen-image] WARNING: listening on {args.host} without --token — anyone who can reach this "
            "port can use the GPU. Set --token (or QWEN_IMAGE_SERVER_TOKEN) and the same token in MakeSlide.",
            file=sys.stderr,
            flush=True,
        )

    # Bind before loading the model: a port already in use should fail in a second, not after the
    # ~30 GB of weights have been read. Requests that arrive meanwhile wait in the listen backlog.
    service = Service(None, "stub" if args.stub else args.model, args.steps, args.max_pixels, args.token)
    server_class = ThreadingHTTPServer
    if ":" in args.host:  # an IPv6 literal such as :: needs an IPv6 socket
        import socket

        class ServerV6(ThreadingHTTPServer):
            address_family = socket.AF_INET6

        server_class = ServerV6
    try:
        server = server_class((args.host, args.port), make_handler(service))
    except OSError as err:
        sys.exit(f"[qwen-image] ERROR: cannot listen on {args.host}:{args.port}: {err.strerror} (another server running? pick --port)")
    port = server.server_address[1]

    if args.stub:
        service.pipeline = StubPipeline()
    else:
        mode = {True: "on", False: "off", None: "auto"}[args.cpu_offload]
        print(f"[qwen-image] loading {args.model} on {args.device} ({args.dtype}, cpu_offload={mode}) …", flush=True)
        service.pipeline = DiffusersPipeline(args.model, args.device, args.dtype, args.cpu_offload)
        print("[qwen-image] model ready", flush=True)

    bound = f"[{args.host}]" if ":" in args.host else args.host
    print(f"[qwen-image] listening on http://{bound}:{port}{' (token required)' if args.token else ''}", flush=True)
    if args.host in ("0.0.0.0", "::", ""):
        for url in reachable_urls(args.host, port):
            print(f"[qwen-image]   reachable at {url}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
