import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { MANIM_HELPER_SCRIPT } from "./manimHelperScript";

interface FakeElement {
  tagName: string;
  style: Record<string, string>;
  children: FakeElement[];
  textContent: string;
  setAttribute(name: string, value: unknown): void;
  getAttribute(name: string): string | null;
  appendChild(child: FakeElement): FakeElement;
  removeChild(child: FakeElement): FakeElement;
  getTotalLength(): number;
}

function createFakeElement(tagName: string): FakeElement {
  const attrs = new Map<string, string>();
  const el: FakeElement = {
    tagName,
    style: {},
    children: [],
    textContent: "",
    setAttribute(name, value) {
      attrs.set(name, String(value));
    },
    getAttribute(name) {
      return attrs.has(name) ? (attrs.get(name) as string) : null;
    },
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    removeChild(child) {
      el.children = el.children.filter((c) => c !== child);
      return child;
    },
    getTotalLength() {
      return 10;
    },
  };
  return el;
}

/** Runs `MANIM_HELPER_SCRIPT` against a minimal DOM stub and returns `window.Manim`. */
function loadManim(): any {
  const sandbox: any = {
    window: {},
    document: {
      createElementNS: (_ns: string, tag: string) => createFakeElement(tag),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(MANIM_HELPER_SCRIPT, sandbox);
  return sandbox.window.Manim;
}

test("Manim.rate functions clamp to [0,1] and smooth matches manim's smoothstep", () => {
  const Manim = loadManim();
  assert.equal(Manim.rate.linear(-1), 0);
  assert.equal(Manim.rate.linear(2), 1);
  assert.equal(Manim.rate.linear(0.3), 0.3);
  assert.equal(Manim.rate.smooth(0), 0);
  assert.equal(Manim.rate.smooth(1), 1);
  assert.equal(Manim.rate.smooth(0.5), 0.5);
  assert.equal(Manim.rate.thereAndBack(0), 0);
  assert.equal(Manim.rate.thereAndBack(0.5), 1);
  assert.equal(Manim.rate.thereAndBack(1), 0);
});

test("Manim.lerp and Manim.lerpColor interpolate linearly", () => {
  const Manim = loadManim();
  assert.equal(Manim.lerp(0, 10, 0.5), 5);
  assert.equal(Manim.lerp(10, 20, 0), 10);
  assert.equal(Manim.lerp(10, 20, 1), 20);
  assert.equal(Manim.lerpColor("#000000", "#ffffff", 0.5), "#808080");
});

test("Manim.colors exposes manim's signature palette", () => {
  const Manim = loadManim();
  assert.equal(Manim.colors.BLUE, "#58C4DD");
  assert.equal(Manim.colors.WHITE, "#FFFFFF");
  assert.equal(Manim.colors.BLACK, "#000000");
});

test("Manim.shapes.circle creates a y-flipped circle mobject", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const m = Manim.shapes.circle(svg, { x: 1, y: 2, radius: 0.5, color: "#FFFFFF" });
  assert.equal(m.kind, "circle");
  assert.equal(m.el.getAttribute("cx"), "1");
  assert.equal(m.el.getAttribute("cy"), "-2");
  assert.equal(m.el.getAttribute("r"), "0.5");
  assert.equal(svg.children.includes(m.el), true);
});

test("Manim.shapes.text sets centered text attributes", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const m = Manim.shapes.text(svg, { x: 0, y: 1, text: "Hello" });
  assert.equal(m.kind, "text");
  assert.equal(m.el.getAttribute("text-anchor"), "middle");
  assert.equal(m.el.textContent, "Hello");
  assert.equal(m.el.getAttribute("cy"), null);
});

test("Manim.animate.fadeIn/fadeOut set opacity from progress", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const m = Manim.shapes.dot(svg, { x: 0, y: 0 });
  Manim.animate.fadeIn(m, 0.3);
  assert.equal(m.el.style.opacity, "0.3");
  Manim.animate.fadeOut(m, 0.3);
  assert.equal(m.el.style.opacity, "0.7");
});

test("Manim.animate.create draws a shape's outline via stroke-dasharray/dashoffset", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const m = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1, fill: Manim.colors.BLUE, fillOpacity: 0.8 });
  Manim.animate.create(m, 0.5);
  assert.equal(m.el.getAttribute("stroke-dasharray"), "10");
  assert.equal(m.el.getAttribute("stroke-dashoffset"), "5");
  assert.equal(m.el.getAttribute("fill-opacity"), "0.4");
  Manim.animate.create(m, 1);
  assert.equal(m.el.getAttribute("stroke-dashoffset"), "0");
  assert.equal(m.el.getAttribute("fill-opacity"), "0.8");
});

test("Manim.animate.write reveals text progressively then restores it at progress 1", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const m = Manim.shapes.text(svg, { x: 0, y: 0, text: "Hello" });
  Manim.animate.write(m, 0.4);
  assert.equal(m.el.textContent, "He");
  Manim.animate.write(m, 1);
  assert.equal(m.el.textContent, "Hello");
});

test("Manim.animate.shift translates by progress fraction of the displacement, flipping y", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const m = Manim.shapes.dot(svg, { x: 0, y: 0 });
  Manim.animate.shift(m, 2, 4, 0.5);
  assert.equal(m.el.getAttribute("transform"), "translate(1 -2)");
});

test("Manim.animate.transform cross-fades opacity and interpolates matching attributes", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const from = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1 });
  const to = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 3 });
  Manim.animate.transform(from, to, 0.5);
  assert.equal(from.el.style.opacity, "0.5");
  assert.equal(to.el.style.opacity, "0.5");
  assert.equal(from.el.getAttribute("r"), "2");
  assert.equal(to.el.getAttribute("r"), "2");
});
