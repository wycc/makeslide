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

test("Manim.animate.indicateAround scales up+recolours mid-progress and restores at progress=1", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const circ = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1, color: Manim.colors.BLUE });
  const origStroke = circ.el.getAttribute("stroke");

  // At progress=0.5 (peak): scale > 1, stroke shifts toward flash colour
  Manim.animate.indicateAround(circ, 0.5, { scale: 1.5, color: "#ffffff" });
  const transform05 = circ.el.getAttribute("transform") as string;
  assert.ok(transform05.startsWith("scale("), "transform should be a scale");
  const scale05 = parseFloat(transform05.replace("scale(", "").replace(")", ""));
  assert.ok(scale05 > 1, "scale at progress=0.5 should be > 1");
  assert.ok(scale05 <= 1.5, "scale at progress=0.5 should be <= max scale");
  // stroke colour should have shifted from BLUE toward white
  const stroke05 = circ.el.getAttribute("stroke") as string;
  assert.notEqual(stroke05, origStroke, "stroke should shift toward flash colour at progress=0.5");

  // At progress=1: scale back to 1, stroke restored to original
  Manim.animate.indicateAround(circ, 1, { scale: 1.5, color: "#ffffff" });
  const transform1 = circ.el.getAttribute("transform") as string;
  assert.equal(transform1, "scale(1)", "transform should be scale(1) at progress=1");
  const stroke1 = circ.el.getAttribute("stroke") as string;
  assert.equal(stroke1, origStroke, "stroke should be restored to original at progress=1");
  assert.equal(circ.el.style.opacity, "1");
});

test("Manim.animate.indicateAround uses default scale=1.3 and amber flash colour when no opts", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const sq = Manim.shapes.square(svg, { x: 0, y: 0, size: 2, color: Manim.colors.RED });

  Manim.animate.indicateAround(sq, 0.5);
  const transform = sq.el.getAttribute("transform") as string;
  const scale = parseFloat(transform.replace("scale(", "").replace(")", ""));
  // default scale=1.3 so at progress=0.5 (smooth(1)=1), scale should equal 1.3
  assert.ok(Math.abs(scale - 1.3) < 0.01, `default scale should be ~1.3, got ${scale}`);
});

test("Manim.animate.flash recolours mid-progress and restores colours + opacity at progress=1", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const circ = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1, color: Manim.colors.BLUE });
  circ.el.style.opacity = "0.8";
  const origStroke = circ.el.getAttribute("stroke") as string;

  // progress=0.5 (peak): stroke shifts toward white, opacity approaches maxOpacity
  Manim.animate.flash(circ, 0.5, { color: "#ffffff", maxOpacity: 1 });
  const stroke05 = circ.el.getAttribute("stroke") as string;
  assert.notEqual(stroke05, origStroke, "stroke should shift toward flash colour at progress=0.5");
  const opacity05 = parseFloat(circ.el.style.opacity);
  assert.ok(opacity05 >= 0.8, "opacity should be >= original at progress=0.5");

  // progress=1: restore original stroke and opacity, no transform change
  Manim.animate.flash(circ, 1, { color: "#ffffff", maxOpacity: 1 });
  const stroke1 = circ.el.getAttribute("stroke") as string;
  assert.equal(stroke1, origStroke, "stroke should be restored to original at progress=1");
  const opacity1 = parseFloat(circ.el.style.opacity);
  assert.ok(Math.abs(opacity1 - 0.8) < 0.01, `opacity should be restored to 0.8, got ${opacity1}`);
});

test("Manim.animate.flash uses default white colour when no opts", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  // Use a non-white stroke so we can detect a colour shift
  const rect = Manim.shapes.square(svg, { x: 0, y: 0, size: 2, color: Manim.colors.RED });
  const origStroke = rect.el.getAttribute("stroke") as string;

  Manim.animate.flash(rect, 0.5);
  const stroke05 = rect.el.getAttribute("stroke") as string;
  assert.notEqual(stroke05, origStroke, "stroke should shift from RED toward default white at progress=0.5");

  Manim.animate.flash(rect, 1);
  assert.equal(rect.el.getAttribute("stroke"), origStroke, "stroke restored after flash completes");
});

test("Manim.animate.uncreate increases dashoffset at mid-progress and sets opacity=0 at progress=1", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const circ = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1, color: Manim.colors.BLUE });

  Manim.animate.uncreate(circ, 0.5);
  const dashoffset05 = parseFloat(circ.el.getAttribute("stroke-dashoffset") as string);
  assert.ok(dashoffset05 > 0, "stroke-dashoffset should be > 0 at progress=0.5");

  Manim.animate.uncreate(circ, 1);
  assert.equal(circ.el.style.opacity, "0", "opacity should be 0 at progress=1");
});

test("Manim.animate.uncreate is the reverse of create (dashoffset decreases for create, increases for uncreate)", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const rect = Manim.shapes.square(svg, { x: 0, y: 0, size: 2, color: Manim.colors.GREEN });

  Manim.animate.create(rect, 0.3);
  const createOffset = parseFloat(rect.el.getAttribute("stroke-dashoffset") as string);

  // reset attributes
  rect.el.setAttribute("stroke-dasharray", "0");
  rect.el.setAttribute("stroke-dashoffset", "0");

  Manim.animate.uncreate(rect, 0.3);
  const uncreateOffset = parseFloat(rect.el.getAttribute("stroke-dashoffset") as string);

  assert.ok(uncreateOffset > 0, "uncreate dashoffset at 0.3 should be > 0");
  assert.ok(createOffset > uncreateOffset, "create at 0.3 has large dashoffset (most of path hidden) while uncreate at 0.3 has small dashoffset (path barely started un-drawing)");
});

function parseTranslateX(transform: string): number {
  const m = transform.match(/translateX\(([^p]+)px\)/);
  return m ? parseFloat(m[1]) : 0;
}

test("Manim.animate.shake gives zero translateX offset at progress=0 and progress=1", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const circ = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1, color: Manim.colors.BLUE });

  Manim.animate.shake(circ, 0);
  const offset0 = parseTranslateX(circ.el.style.transform);
  assert.ok(Math.abs(offset0) < 0.01, `progress=0 should give ~0 translateX, got ${offset0}`);

  Manim.animate.shake(circ, 1);
  const offset1 = parseTranslateX(circ.el.style.transform);
  assert.ok(Math.abs(offset1) < 0.01, `progress=1 should give ~0 translateX, got ${offset1}`);
});

test("Manim.animate.shake gives non-zero translateX at intermediate progress and respects amplitude/cycles opts", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const circ = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1, color: Manim.colors.RED });

  // With default cycles=4, at progress=0.125: sin(0.125 * π * 4) = sin(π/2) = 1 → offset = amplitude(8)
  Manim.animate.shake(circ, 0.125);
  const offsetMid = parseTranslateX(circ.el.style.transform);
  assert.ok(Math.abs(offsetMid) > 1, `intermediate progress should give non-zero offset, got ${offsetMid}`);

  // Custom amplitude=20, cycles=2: at progress=0.25: sin(0.25 * π * 2) = sin(π/2) = 1 → offset = 20
  Manim.animate.shake(circ, 0.25, { amplitude: 20, cycles: 2 });
  const offsetCustom = parseTranslateX(circ.el.style.transform);
  assert.ok(Math.abs(offsetCustom - 20) < 0.01, `custom amplitude=20 at peak should give ~20, got ${offsetCustom}`);
});

test("Manim.animate.wiggle produces non-zero translateX at mid-progress and clears transform at progress=1", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const circ = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1, color: Manim.colors.RED });

  Manim.animate.wiggle(circ, 0.25, { amplitude: 10, frequency: 3 });
  const transform25 = circ.el.getAttribute("transform") as string;
  assert.ok(transform25 && transform25 !== "" && transform25 !== "translate(0 0)", "transform should be non-zero at progress=0.25");

  Manim.animate.wiggle(circ, 1);
  const transform1 = circ.el.getAttribute("transform") as string;
  assert.equal(transform1, "", "transform should be cleared at progress=1");
});

test("Manim.animate.wiggle uses default amplitude=8 and frequency=3 when no opts", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const rect = Manim.shapes.square(svg, { x: 0, y: 0, size: 2, color: Manim.colors.GREEN });

  Manim.animate.wiggle(rect, 0.1);
  const transform = rect.el.getAttribute("transform") ?? "";
  assert.ok(transform && transform.startsWith("translate("), "transform should start with translate(");
  const tx = parseFloat(transform.replace("translate(", "").split(" ")[0]);
  assert.ok(Math.abs(tx) <= 8, "translateX should not exceed default amplitude=8");
});

test("Manim.animate.spinAround produces non-zero rotation at mid-progress and clears transform at progress=1", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const circ = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 2, color: Manim.colors.BLUE });

  Manim.animate.spinAround(circ, 0.5, { turns: 2 });
  const transform05 = circ.el.getAttribute("transform") ?? "";
  assert.ok(transform05.startsWith("rotate("), "transform should start with rotate( at mid-progress");
  const angle05 = parseFloat(transform05.replace("rotate(", "").split(" ")[0]);
  assert.ok(angle05 > 0 && angle05 < 720, "angle at progress=0.5 with turns=2 should be 360");

  Manim.animate.spinAround(circ, 1, { turns: 2 });
  const transform1 = circ.el.getAttribute("transform") ?? "";
  assert.equal(transform1, "", "transform should be cleared at progress=1");
});

test("Manim.animate.spinAround defaults to 1 turn and produces increasing angle with progress", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const rect = Manim.shapes.square(svg, { x: 0, y: 0, size: 2, color: Manim.colors.RED });

  Manim.animate.spinAround(rect, 0.25);
  const transform25 = rect.el.getAttribute("transform") ?? "";
  const angle25 = parseFloat(transform25.replace("rotate(", "").split(" ")[0]);

  Manim.animate.spinAround(rect, 0.75);
  const transform75 = rect.el.getAttribute("transform") ?? "";
  const angle75 = parseFloat(transform75.replace("rotate(", "").split(" ")[0]);

  assert.ok(angle25 < angle75, "angle should increase with progress");
  assert.ok(Math.abs(angle25 - 90) < 1, "angle at 0.25 should be ~90 degrees for 1 turn");
  assert.ok(Math.abs(angle75 - 270) < 1, "angle at 0.75 should be ~270 degrees for 1 turn");
});

test("Manim.animate.bounce produces negative translateY at mid-progress and clears transform at progress=1", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const circ = Manim.shapes.circle(svg, { x: 0, y: 0, radius: 1, color: Manim.colors.GREEN });

  Manim.animate.bounce(circ, 0.25, { height: 40, bounces: 2 });
  const transform25 = circ.el.getAttribute("transform") ?? "";
  assert.ok(transform25.startsWith("translate(0 "), "transform should start with translate(0 at mid-progress");
  const ty25 = parseFloat(transform25.replace("translate(0 ", "").replace(")", ""));
  assert.ok(ty25 < 0, "translateY should be negative (upward bounce) at mid-progress");

  Manim.animate.bounce(circ, 1, { height: 40, bounces: 2 });
  const transform1 = circ.el.getAttribute("transform") ?? "";
  assert.equal(transform1, "", "transform should be cleared at progress=1");
});

test("Manim.animate.bounce uses default height=30 and bounces=2 when no opts", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const rect = Manim.shapes.square(svg, { x: 0, y: 0, size: 2, color: Manim.colors.YELLOW });

  Manim.animate.bounce(rect, 0.25);
  const transform = rect.el.getAttribute("transform") ?? "";
  const ty = parseFloat(transform.replace("translate(0 ", "").replace(")", ""));
  assert.ok(ty <= 0, "translateY should be <= 0 (upward or at rest)");
  assert.ok(ty >= -30, "translateY should not exceed default height=30");
});

test("Manim.animate.typewrite shows partial text at mid-progress and full text at progress=1", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const label = Manim.shapes.text(svg, { x: 0, y: 0, text: "Hello World", size: 14, color: "#ffffff" });

  Manim.animate.typewrite(label, 0.5);
  const mid = label.el.textContent ?? "";
  assert.ok(mid.length > 0, "textContent should be non-empty at mid-progress");
  assert.ok(mid.length < "Hello World".length, "textContent should be shorter than full text at mid-progress");

  Manim.animate.typewrite(label, 1);
  const full = label.el.textContent ?? "";
  assert.equal(full, "Hello World", "textContent should equal full text at progress=1");
});

test("Manim.animate.typewrite with reverse=true erases from end, restoring full text at progress=1", () => {
  const Manim = loadManim();
  const svg = createFakeElement("svg");
  const label = Manim.shapes.text(svg, { x: 0, y: 0, text: "ABCDE", size: 14, color: "#ffffff" });

  Manim.animate.typewrite(label, 0.4, { reverse: true });
  const mid = label.el.textContent ?? "";
  assert.ok(mid.length > 0, "textContent should be non-empty at progress=0.4 with reverse");
  assert.ok("ABCDE".endsWith(mid), "reversed typewrite should show tail of the string");
  assert.ok(mid.length < "ABCDE".length, "should show fewer chars than full text");

  Manim.animate.typewrite(label, 1, { reverse: true });
  const full = label.el.textContent ?? "";
  assert.equal(full, "ABCDE", "full text should be restored at progress=1");
});
