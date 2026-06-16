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
    window: {
      addEventListener: () => {},
      removeEventListener: () => {},
      parent: { postMessage: () => {} },
    },
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

test("Manim.coordinateSystems.axes draws axes+ticks and maps coordsToPoint to the scene", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const axes = Manim.coordinateSystems.axes(svg, { xRange: [-5, 5, 1], yRange: [-3, 3, 1] });
  assert.equal(axes.kind, "axes");
  assert.equal(svg.children.includes(axes.el), true);
  // x-axis + y-axis + 11 x-ticks + 7 y-ticks, no grid lines
  assert.equal(axes.el.children.length, 2 + 11 + 7);
  // coordsToPoint returns plain objects from the vm sandbox realm, so compare
  // fields individually instead of via assert.deepEqual (cross-realm prototypes).
  const origin = axes.coordsToPoint(0, 0);
  assert.equal(origin.x, 0);
  assert.equal(origin.y, 0);
  const max = axes.coordsToPoint(5, 3);
  assert.equal(max.x, 7);
  assert.equal(max.y, 4);
  const min = axes.coordsToPoint(-5, -3);
  assert.equal(min.x, -7);
  assert.equal(min.y, -4);
});

test("Manim.coordinateSystems.numberPlane adds grid lines on top of axes", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const axes = Manim.coordinateSystems.axes(svg, { xRange: [-5, 5, 1], yRange: [-3, 3, 1] });
  const plane = Manim.coordinateSystems.numberPlane(svg, { xRange: [-5, 5, 1], yRange: [-3, 3, 1] });
  assert.equal(plane.kind, "numberPlane");
  // grid adds 11 vertical + 7 horizontal lines before the axes/ticks
  assert.equal(plane.el.children.length, axes.el.children.length + 11 + 7);
});

test("Manim.animate.fadeIn/create on axes mobjects fades by progress", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const axes = Manim.coordinateSystems.axes(svg, {});
  Manim.animate.create(axes, 0.4);
  assert.equal(axes.el.style.opacity, "0.4");
  Manim.animate.fadeOut(axes, 0.4);
  assert.equal(axes.el.style.opacity, "0.6");
});

test("Manim.animate.transform uses path morphing for circle→circle and generates a <path> element", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const from = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1 });
  const to   = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 2 });
  Manim.animate.transform(from, to, 0.5);
  // Both originals are hidden; a new <path> morph element is appended to svg
  assert.equal(from.el.style.display, "none");
  assert.equal(to.el.style.display,   "none");
  assert.ok(from._morphEl, "morphEl should be created");
  assert.equal(from._morphEl.getAttribute("d")?.startsWith("M"), true, "path d should start with M");
  // At progress=0, path should look like 'from'; at progress=1, path should look like 'to'
  Manim.animate.transform(from, to, 0);
  const d0 = from._morphEl.getAttribute("d") as string;
  Manim.animate.transform(from, to, 1);
  const d1 = from._morphEl.getAttribute("d") as string;
  assert.notEqual(d0, d1, "path 'd' should differ between progress=0 and progress=1");
});

test("Manim.animate.transform uses path morphing for circle→square (cross-type)", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const circle = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1, color: Manim.colors.BLUE });
  const square = Manim.shapes.square(svg, { x: 0, y: 0, size: 2,   color: Manim.colors.RED  });
  Manim.animate.transform(circle, square, 0.5);
  assert.equal(circle.el.style.display, "none", "circle should be hidden during morph");
  assert.equal(square.el.style.display, "none", "square should be hidden during morph");
  assert.ok(circle._morphEl, "morphEl should be created for cross-type morph");
  const d = circle._morphEl.getAttribute("d") as string;
  assert.ok(d.startsWith("M") && d.endsWith("Z"), "path data should be a closed path");
  // Midpoint path should differ from both endpoints
  Manim.animate.transform(circle, square, 0);
  const d0 = circle._morphEl.getAttribute("d") as string;
  Manim.animate.transform(circle, square, 1);
  const d1 = circle._morphEl.getAttribute("d") as string;
  assert.notEqual(d0, d1, "circle (d at t=0) and square (d at t=1) paths should be different");
});

test("Manim.animate.transform uses path morphing for polygon→circle (cross-type)", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  // Equilateral-ish triangle (SVG coords): top=(0,-2), right=(2,1), left=(-2,1)
  const tri = Manim.shapes.polygon(svg, {
    points: [[0, 2], [2, -1], [-2, -1]],  // math coords: top=(0,2), etc.
    color: Manim.colors.YELLOW,
  });
  const circle = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1.5, color: Manim.colors.BLUE });
  Manim.animate.transform(tri, circle, 0.5);
  assert.equal(tri.el.style.display, "none", "polygon should be hidden during morph");
  assert.equal(circle.el.style.display, "none", "circle should be hidden during morph");
  assert.ok(tri._morphEl, "morphEl should be created for polygon→circle cross-type morph");
  const d = tri._morphEl.getAttribute("d") as string;
  assert.ok(d.startsWith("M") && d.endsWith("Z"), "morphed path should be closed (M...Z)");
  // Check d changes between t=0 (polygon) and t=1 (circle)
  Manim.animate.transform(tri, circle, 0);
  const d0 = tri._morphEl.getAttribute("d") as string;
  Manim.animate.transform(tri, circle, 1);
  const d1 = tri._morphEl.getAttribute("d") as string;
  assert.notEqual(d0, d1, "path should differ between progress=0 and progress=1");
});

test("Manim.animate.transform uses path morphing for polygon→polygon (same kind)", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const tri = Manim.shapes.polygon(svg, { points: [[0, 2], [2, -1], [-2, -1]] });
  const pent = Manim.shapes.polygon(svg, {
    points: [[0, 2], [1.9, 0.6], [1.2, -1.6], [-1.2, -1.6], [-1.9, 0.6]],
  });
  Manim.animate.transform(tri, pent, 0.5);
  assert.ok(tri._morphEl, "morphEl created for polygon→polygon morph");
  const d = tri._morphEl.getAttribute("d") as string;
  assert.ok(d.startsWith("M") && d.endsWith("Z"), "morphed path is a closed path");
  Manim.animate.transform(tri, pent, 0);
  const d0 = tri._morphEl.getAttribute("d") as string;
  Manim.animate.transform(tri, pent, 1);
  const d1 = tri._morphEl.getAttribute("d") as string;
  assert.notEqual(d0, d1, "polygon paths should differ at t=0 and t=1");
});

test("Manim.animate.transform uses path morphing for polygon→rect (cross-type)", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const diamond = Manim.shapes.polygon(svg, {
    points: [[0, 2], [2, 0], [0, -2], [-2, 0]],  // diamond in math coords
    color: Manim.colors.GREEN,
  });
  const rect = Manim.shapes.rectangle(svg, { x: 0, y: 0, width: 3, height: 2, color: Manim.colors.RED });
  Manim.animate.transform(diamond, rect, 0.5);
  assert.equal(diamond.el.style.display, "none", "polygon hidden during morph");
  assert.equal(rect.el.style.display, "none", "rect hidden during morph");
  assert.ok(diamond._morphEl, "morphEl created for polygon→rect");
  const d = diamond._morphEl.getAttribute("d") as string;
  assert.ok(d.startsWith("M") && d.endsWith("Z"), "path is closed");
  Manim.animate.transform(diamond, rect, 0);
  const d0 = diamond._morphEl.getAttribute("d") as string;
  Manim.animate.transform(diamond, rect, 1);
  const d1 = diamond._morphEl.getAttribute("d") as string;
  assert.notEqual(d0, d1, "diamond (t=0) and rect (t=1) paths should differ");
});

test("Manim.animate.transform falls back to cross-fade for types without morph support (e.g. line)", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const lineA = Manim.shapes.line(svg, { x1: -1, y1: 0, x2: 1, y2: 0, color: Manim.colors.WHITE });
  const lineB = Manim.shapes.line(svg, { x1: -2, y1: 0, x2: 2, y2: 0, color: Manim.colors.RED  });
  Manim.animate.transform(lineA, lineB, 0.5);
  // line kind has no morph segments → falls back to opacity cross-fade
  assert.equal(lineA.el.style.opacity, "0.5");
  assert.equal(lineB.el.style.opacity, "0.5");
  assert.equal(lineA._morphEl, undefined, "no morphEl for unsupported types");
});
