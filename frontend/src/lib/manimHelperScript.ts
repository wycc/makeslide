/**
 * JS source injected into the `custom-script` sandbox (see
 * `buildCustomScriptSandboxDoc`) before user/AI code runs. Defines a small
 * `window.Manim` helper library so "manim 式" animations can use manim's
 * coordinate system (origin at center, +y up, x in [-7, 7], y in [-4, 4]),
 * color palette, standard rate functions, signature
 * Create/Write/FadeIn/FadeOut/Transform-style motions (including SVG path
 * morphing for circle↔square/rect cross-type transforms), `Axes`/`NumberPlane`
 * coordinate-plane mobjects (with `coordsToPoint`), and `Manim.tex(latex)`
 * for MathML math rendering (via postMessage to the host page which holds
 * the KaTeX library and its fonts) without the real Python manim library
 * (which the sandbox cannot load over the network).
 *
 * Kept as plain ES5 source text (no TypeScript/build step) so it can be
 * embedded verbatim into the sandboxed iframe's `srcDoc`.
 */
export const MANIM_HELPER_SCRIPT = `
(function () {
  "use strict";
  var W = 14, H = 8;
  function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }
  function smooth(t) {
    t = clamp01(t);
    return t * t * t * (10 - 15 * t + 6 * t * t);
  }
  var rate = {
    linear: function (t) { return clamp01(t); },
    smooth: smooth,
    thereAndBack: function (t) { t = clamp01(t); return t < 0.5 ? smooth(2 * t) : smooth(2 - 2 * t); },
    rushInto: function (t) { return 2 * smooth(clamp01(t) / 2); },
    rushFrom: function (t) { return 2 * smooth(clamp01(t) / 2 + 0.5) - 1; },
  };
  function lerp(a, b, t) { return a + (b - a) * clamp01(t); }
  function hexToRgb(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function toHex2(n) {
    var s = Math.round(n).toString(16);
    return s.length < 2 ? '0' + s : s;
  }
  function normalizeSvgFontSize(fontSize) {
    if (fontSize == null) return 0.45;
    if (typeof fontSize === 'number') {
      if (!isFinite(fontSize) || fontSize <= 0) return 0.45;
      // Manim's SVG scene is only 8 units tall. LLMs often pass pixel-like
      // values such as 18/24/32; using those directly as SVG user units makes
      // labels cover the entire slide. Treat large numeric values as pixels
      // for a 600px-high slide and convert them back into scene units.
      return fontSize > 4 ? fontSize * H / 600 : fontSize;
    }
    return fontSize;
  }
  function lerpColor(c1, c2, t) {
    var a = hexToRgb(c1), b = hexToRgb(c2), p = clamp01(t);
    return '#' + toHex2(lerp(a.r, b.r, p)) + toHex2(lerp(a.g, b.g, p)) + toHex2(lerp(a.b, b.b, p));
  }
  var colors = {
    WHITE: '#FFFFFF', BLACK: '#000000', GREY: '#888888',
    BLUE: '#58C4DD', GREEN: '#83C167', RED: '#FC6255', YELLOW: '#FFFF00',
    PURPLE: '#9A72AC', ORANGE: '#FF862F', PINK: '#FF8080', TEAL: '#5CD0B3',
  };
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function toSvgY(y) { return -y; }
  function createSvg(root) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', (-W / 2) + ' ' + (-H / 2) + ' ' + W + ' ' + H);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.display = 'block';
    root.appendChild(svg);
    return svg;
  }
  function mobject(svg, el, kind) {
    svg.appendChild(el);
    return { el: el, kind: kind, svg: svg };
  }
  function applyStyle(el, opts) {
    opts = opts || {};
    el.setAttribute('stroke', opts.color || colors.WHITE);
    el.setAttribute('stroke-width', String(opts.strokeWidth != null ? opts.strokeWidth : 0.05));
    var fillOpacity = opts.fillOpacity != null ? opts.fillOpacity : (opts.fill ? 1 : 0);
    el.setAttribute('fill', opts.fill || colors.WHITE);
    el.setAttribute('fill-opacity', String(fillOpacity));
  }
  var shapes = {
    circle: function (svg, opts) {
      opts = opts || {};
      var el = document.createElementNS(SVG_NS, 'circle');
      el.setAttribute('cx', String(opts.x || 0));
      el.setAttribute('cy', String(toSvgY(opts.y || 0)));
      el.setAttribute('r', String(opts.radius != null ? opts.radius : 1));
      applyStyle(el, opts);
      return mobject(svg, el, 'circle');
    },
    square: function (svg, opts) {
      opts = opts || {};
      var size = opts.size != null ? opts.size : 2;
      var el = document.createElementNS(SVG_NS, 'rect');
      el.setAttribute('x', String((opts.x || 0) - size / 2));
      el.setAttribute('y', String(toSvgY(opts.y || 0) - size / 2));
      el.setAttribute('width', String(size));
      el.setAttribute('height', String(size));
      applyStyle(el, opts);
      return mobject(svg, el, 'rect');
    },
    rectangle: function (svg, opts) {
      opts = opts || {};
      var width = opts.width != null ? opts.width : 2;
      var height = opts.height != null ? opts.height : 1;
      var el = document.createElementNS(SVG_NS, 'rect');
      el.setAttribute('x', String((opts.x || 0) - width / 2));
      el.setAttribute('y', String(toSvgY(opts.y || 0) - height / 2));
      el.setAttribute('width', String(width));
      el.setAttribute('height', String(height));
      applyStyle(el, opts);
      return mobject(svg, el, 'rect');
    },
    line: function (svg, opts) {
      opts = opts || {};
      var el = document.createElementNS(SVG_NS, 'line');
      el.setAttribute('x1', String(opts.x1 || 0));
      el.setAttribute('y1', String(toSvgY(opts.y1 || 0)));
      el.setAttribute('x2', String(opts.x2 || 0));
      el.setAttribute('y2', String(toSvgY(opts.y2 || 0)));
      el.setAttribute('stroke', opts.color || colors.WHITE);
      el.setAttribute('stroke-width', String(opts.strokeWidth != null ? opts.strokeWidth : 0.05));
      el.setAttribute('fill', 'none');
      return mobject(svg, el, 'line');
    },
    arrow: function (svg, opts) {
      opts = opts || {};
      var g = document.createElementNS(SVG_NS, 'g');
      var line = shapes.line(svg, opts).el;
      svg.removeChild(line);
      g.appendChild(line);
      var dx = (opts.x2 || 0) - (opts.x1 || 0);
      var dy = (opts.y2 || 0) - (opts.y1 || 0);
      var angle = Math.atan2(toSvgY(dy), dx) * 180 / Math.PI;
      var headSize = opts.headSize != null ? opts.headSize : 0.2;
      var head = document.createElementNS(SVG_NS, 'polygon');
      head.setAttribute('points', '0,0 ' + (-headSize * 1.8) + ',' + (-headSize) + ' ' + (-headSize * 1.8) + ',' + headSize);
      head.setAttribute('fill', opts.color || colors.WHITE);
      head.setAttribute('transform', 'translate(' + (opts.x2 || 0) + ' ' + toSvgY(opts.y2 || 0) + ') rotate(' + angle + ')');
      g.appendChild(head);
      return mobject(svg, g, 'arrow');
    },
    dot: function (svg, opts) {
      opts = opts || {};
      var el = document.createElementNS(SVG_NS, 'circle');
      el.setAttribute('cx', String(opts.x || 0));
      el.setAttribute('cy', String(toSvgY(opts.y || 0)));
      el.setAttribute('r', String(opts.radius != null ? opts.radius : 0.08));
      el.setAttribute('fill', opts.color || colors.WHITE);
      el.setAttribute('stroke', 'none');
      return mobject(svg, el, 'dot');
    },
    polygon: function (svg, opts) {
      opts = opts || {};
      var pts = (opts.points || []).map(function (p) { return p[0] + ',' + toSvgY(p[1]); }).join(' ');
      var el = document.createElementNS(SVG_NS, 'polygon');
      el.setAttribute('points', pts);
      applyStyle(el, opts);
      return mobject(svg, el, 'polygon');
    },
    text: function (svg, opts) {
      opts = opts || {};
      var el = document.createElementNS(SVG_NS, 'text');
      el.setAttribute('x', String(opts.x || 0));
      el.setAttribute('y', String(toSvgY(opts.y || 0)));
      el.setAttribute('font-size', String(normalizeSvgFontSize(opts.fontSize)));
      el.setAttribute('fill', opts.color || colors.WHITE);
      el.setAttribute('text-anchor', 'middle');
      el.setAttribute('dominant-baseline', 'central');
      el.textContent = opts.text || '';
      return mobject(svg, el, 'text');
    },
  };
  function buildAxisRange(range, fallback) {
    range = range || fallback;
    return {
      min: range[0],
      max: range[1],
      step: range[2] != null ? range[2] : 1,
    };
  }
  function coordinateSystem(svg, opts, withGrid) {
    opts = opts || {};
    var xr = buildAxisRange(opts.xRange, [-7, 7, 1]);
    var yr = buildAxisRange(opts.yRange, [-4, 4, 1]);
    var xLength = opts.xLength != null ? opts.xLength : W;
    var yLength = opts.yLength != null ? opts.yLength : H;
    var color = opts.color || colors.WHITE;
    var gridColor = opts.gridColor || colors.GREY;
    var strokeWidth = opts.strokeWidth != null ? opts.strokeWidth : 0.025;
    var tickSize = opts.tickSize != null ? opts.tickSize : 0.1;
    function coordsToPoint(x, y) {
      return {
        x: (x - xr.min) / (xr.max - xr.min) * xLength - xLength / 2,
        y: (y - yr.min) / (yr.max - yr.min) * yLength - yLength / 2,
      };
    }
    var g = document.createElementNS(SVG_NS, 'g');
    function addLine(x1, y1, x2, y2, strokeColor, sw) {
      var el = document.createElementNS(SVG_NS, 'line');
      el.setAttribute('x1', String(x1));
      el.setAttribute('y1', String(toSvgY(y1)));
      el.setAttribute('x2', String(x2));
      el.setAttribute('y2', String(toSvgY(y2)));
      el.setAttribute('stroke', strokeColor);
      el.setAttribute('stroke-width', String(sw));
      g.appendChild(el);
      return el;
    }
    var origin = coordsToPoint(0, 0);
    if (withGrid) {
      for (var gx = xr.min; gx <= xr.max + 1e-9; gx += xr.step) {
        var gpx = coordsToPoint(gx, 0).x;
        addLine(gpx, -yLength / 2, gpx, yLength / 2, gridColor, strokeWidth * 0.6);
      }
      for (var gy = yr.min; gy <= yr.max + 1e-9; gy += yr.step) {
        var gpy = coordsToPoint(0, gy).y;
        addLine(-xLength / 2, gpy, xLength / 2, gpy, gridColor, strokeWidth * 0.6);
      }
    }
    addLine(-xLength / 2, origin.y, xLength / 2, origin.y, color, strokeWidth);
    addLine(origin.x, -yLength / 2, origin.x, yLength / 2, color, strokeWidth);
    for (var tx = xr.min; tx <= xr.max + 1e-9; tx += xr.step) {
      var tpx = coordsToPoint(tx, 0).x;
      addLine(tpx, origin.y - tickSize, tpx, origin.y + tickSize, color, strokeWidth);
    }
    for (var ty = yr.min; ty <= yr.max + 1e-9; ty += yr.step) {
      var tpy = coordsToPoint(0, ty).y;
      addLine(origin.x - tickSize, tpy, origin.x + tickSize, tpy, color, strokeWidth);
    }
    svg.appendChild(g);
    return {
      el: g,
      kind: withGrid ? 'numberPlane' : 'axes',
      svg: svg,
      coordsToPoint: coordsToPoint,
    };
  }
  var coordinateSystems = {
    axes: function (svg, opts) { return coordinateSystem(svg, opts, false); },
    numberPlane: function (svg, opts) { return coordinateSystem(svg, opts, true); },
  };
  function getLength(el) {
    try { return el.getTotalLength(); } catch (e) { return 0; }
  }
  // ── Path morphing helpers ────────────────────────────────────────────────────
  // Each shape is decomposed into 4 cubic Bézier segments stored as
  // [sx,sy, c1x,c1y, c2x,c2y, ex,ey].  All coordinates are in SVG space
  // (y-axis pointing down, already passed through toSvgY where needed).
  var KAPPA = 0.5523; // circle-as-4-cubic-Béziers approximation constant
  function circleMorphSegs(el) {
    var cx = parseFloat(el.getAttribute('cx') || '0');
    var cy = parseFloat(el.getAttribute('cy') || '0');
    var r  = parseFloat(el.getAttribute('r')  || '1');
    var k = KAPPA * r;
    return [
      [cx,   cy-r,  cx+k, cy-r,  cx+r, cy-k,  cx+r, cy  ],
      [cx+r, cy,    cx+r, cy+k,  cx+k, cy+r,  cx,   cy+r],
      [cx,   cy+r,  cx-k, cy+r,  cx-r, cy+k,  cx-r, cy  ],
      [cx-r, cy,    cx-r, cy-k,  cx-k, cy-r,  cx,   cy-r],
    ];
  }
  function rectMorphSegs(el) {
    var rx = parseFloat(el.getAttribute('x')      || '0');
    var ry = parseFloat(el.getAttribute('y')      || '0');
    var rw = parseFloat(el.getAttribute('width')  || '2');
    var rh = parseFloat(el.getAttribute('height') || '2');
    var ccx = rx + rw / 2, ccy = ry + rh / 2;
    var hw  = rw / 2,      hh  = rh / 2;
    // Control points are placed AT the corner so the curve hugs it tightly.
    // Tangents at each anchor point are axis-aligned, matching the circle's
    // tangent directions at the same cardinal positions (top/right/bottom/left).
    return [
      [ccx,   ccy-hh,  ccx+hw, ccy-hh,  ccx+hw, ccy-hh,  ccx+hw, ccy  ],
      [ccx+hw, ccy,    ccx+hw, ccy+hh,  ccx+hw, ccy+hh,  ccx,    ccy+hh],
      [ccx,   ccy+hh,  ccx-hw, ccy+hh,  ccx-hw, ccy+hh,  ccx-hw, ccy  ],
      [ccx-hw, ccy,    ccx-hw, ccy-hh,  ccx-hw, ccy-hh,  ccx,    ccy-hh],
    ];
  }
  function parsePolygonPoints(pts) {
    var raw = (pts || '').trim().split(/[\\s,]+/);
    var result = [];
    for (var i = 0; i + 1 < raw.length; i += 2) {
      var px = parseFloat(raw[i]);
      var py = parseFloat(raw[i + 1]);
      if (!isNaN(px) && !isNaN(py)) result.push([px, py]);
    }
    return result;
  }
  // Decomposes a convex SVG polygon into 4 cubic Bézier segments anchored at
  // the 4 cardinal extremal vertices (topmost/rightmost/bottommost/leftmost).
  // Control points use axis-aligned tangents scaled by KAPPA × half-span,
  // matching the tangent convention of circleMorphSegs and rectMorphSegs so
  // the path morphs smoothly when cross-type transforming with circle or rect.
  function polygonMorphSegs(el) {
    var pts = parsePolygonPoints(el.getAttribute('points') || '');
    if (pts.length < 3) return null;
    var ti = 0, ri = 0, bi = 0, li = 0;
    for (var i = 1; i < pts.length; i++) {
      if (pts[i][1] < pts[ti][1]) ti = i;  // min SVG-y = topmost
      if (pts[i][0] > pts[ri][0]) ri = i;  // max x = rightmost
      if (pts[i][1] > pts[bi][1]) bi = i;  // max SVG-y = bottommost
      if (pts[i][0] < pts[li][0]) li = i;  // min x = leftmost
    }
    var t = pts[ti], r = pts[ri], b = pts[bi], l = pts[li];
    var kh = KAPPA * (r[0] - l[0]) / 2;  // horizontal control offset
    var kv = KAPPA * (b[1] - t[1]) / 2;  // vertical control offset
    return [
      [t[0], t[1],  t[0]+kh, t[1],       r[0], r[1]-kv,  r[0], r[1]],  // top → right
      [r[0], r[1],  r[0], r[1]+kv,        b[0]+kh, b[1],  b[0], b[1]],  // right → bottom
      [b[0], b[1],  b[0]-kh, b[1],        l[0], l[1]+kv,  l[0], l[1]],  // bottom → left
      [l[0], l[1],  l[0], l[1]-kv,        t[0]-kh, t[1],  t[0], t[1]],  // left → top
    ];
  }
  function getMorphSegs(m) {
    if (m.kind === 'circle')  return circleMorphSegs(m.el);
    if (m.kind === 'rect')    return rectMorphSegs(m.el);
    if (m.kind === 'polygon') return polygonMorphSegs(m.el);
    return null;
  }
  function lerpSegs(segs1, segs2, t) {
    return segs1.map(function (s, i) {
      var s2 = segs2[i];
      return s.map(function (v, j) { return lerp(v, s2[j], t); });
    });
  }
  function segsToPathD(segs) {
    var d = 'M ' + segs[0][0].toFixed(4) + ',' + segs[0][1].toFixed(4);
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      d += ' C ' + s[2].toFixed(4) + ',' + s[3].toFixed(4) + ' '
                 + s[4].toFixed(4) + ',' + s[5].toFixed(4) + ' '
                 + s[6].toFixed(4) + ',' + s[7].toFixed(4);
    }
    return d + ' Z';
  }
  var animate = {
    create: function (m, progress) {
      var p = clamp01(progress);
      if (m.kind === 'text' || m.kind === 'dot' || m.kind === 'arrow' || m.kind === 'axes' || m.kind === 'numberPlane') {
        m.el.style.opacity = String(p);
        return;
      }
      var len = getLength(m.el);
      if (len > 0) {
        m.el.setAttribute('stroke-dasharray', String(len));
        m.el.setAttribute('stroke-dashoffset', String(len * (1 - p)));
      }
      var full = m.el.getAttribute('data-fill-opacity');
      if (full == null) {
        full = m.el.getAttribute('fill-opacity') || '0';
        m.el.setAttribute('data-fill-opacity', full);
      }
      m.el.setAttribute('fill-opacity', String(parseFloat(full) * p));
      m.el.style.opacity = '1';
    },
    uncreate: function (m, progress) {
      var p = clamp01(progress);
      if (m.kind === 'text' || m.kind === 'dot' || m.kind === 'arrow' || m.kind === 'axes' || m.kind === 'numberPlane') {
        m.el.style.opacity = String(1 - p);
        return;
      }
      var len = getLength(m.el);
      if (len > 0) {
        m.el.setAttribute('stroke-dasharray', String(len));
        m.el.setAttribute('stroke-dashoffset', String(len * p));
      }
      var full = m.el.getAttribute('data-fill-opacity');
      if (full == null) {
        full = m.el.getAttribute('fill-opacity') || '1';
        m.el.setAttribute('data-fill-opacity', full);
      }
      m.el.setAttribute('fill-opacity', String(parseFloat(full) * (1 - p)));
      m.el.style.opacity = p >= 1 ? '0' : '1';
    },
    write: function (m, progress) {
      var p = clamp01(progress);
      if (m.kind === 'text') {
        var full = m.el.getAttribute('data-full-text');
        if (full == null) {
          full = m.el.textContent || '';
          m.el.setAttribute('data-full-text', full);
        }
        m.el.textContent = full.slice(0, Math.round(full.length * p));
        m.el.style.opacity = '1';
      } else {
        animate.create(m, p);
      }
    },
    fadeIn: function (m, progress) { m.el.style.opacity = String(clamp01(progress)); },
    fadeOut: function (m, progress) { m.el.style.opacity = String(1 - clamp01(progress)); },
    grow: function (m, progress, cx, cy) {
      var p = clamp01(progress);
      var scx = cx || 0, scy = toSvgY(cy || 0);
      m.el.setAttribute('transform', 'translate(' + scx + ' ' + scy + ') scale(' + p + ') translate(' + (-scx) + ' ' + (-scy) + ')');
      m.el.style.opacity = p > 0 ? '1' : '0';
    },
    shift: function (m, dx, dy, progress) {
      var p = clamp01(progress);
      m.el.setAttribute('transform', 'translate(' + (dx * p) + ' ' + (-dy * p) + ')');
    },
    rotate: function (m, angleDeg, progress, cx, cy) {
      var p = clamp01(progress);
      var scx = cx || 0, scy = toSvgY(cy || 0);
      m.el.setAttribute('transform', 'rotate(' + (angleDeg * p) + ' ' + scx + ' ' + scy + ')');
    },
    spinAround: function (m, progress, opts) {
      var p = clamp01(progress);
      var turns = (opts && opts.turns != null) ? opts.turns : 1;
      var angleDeg = p * turns * 360;
      var bbox = m.el.getBBox ? m.el.getBBox() : null;
      var scx = (opts && opts.cx != null) ? opts.cx : (bbox ? bbox.x + bbox.width / 2 : 0);
      var scy = (opts && opts.cy != null) ? toSvgY(opts.cy) : (bbox ? bbox.y + bbox.height / 2 : 0);
      if (p >= 1) {
        m.el.setAttribute('transform', '');
        return;
      }
      m.el.setAttribute('transform', 'rotate(' + angleDeg + ' ' + scx + ' ' + scy + ')');
    },
    scale: function (m, factor, progress, cx, cy) {
      var p = clamp01(progress);
      var s = lerp(1, factor, p);
      var scx = cx || 0, scy = toSvgY(cy || 0);
      m.el.setAttribute('transform', 'translate(' + scx + ' ' + scy + ') scale(' + s + ') translate(' + (-scx) + ' ' + (-scy) + ')');
    },
    transform: function (from, to, progress) {
      var p = clamp01(progress);
      var fromSegs = getMorphSegs(from);
      var toSegs   = getMorphSegs(to);
      if (fromSegs && toSegs && fromSegs.length === toSegs.length) {
        // Path morphing: convert both shapes to a shared <path> and interpolate
        // the control points so circle↔square/rect animates smoothly.
        if (!from._morphEl) {
          var mp = document.createElementNS(SVG_NS, 'path');
          ['stroke', 'stroke-width', 'fill', 'fill-opacity'].forEach(function (attr) {
            var v = from.el.getAttribute(attr);
            if (v != null) { mp.setAttribute(attr, v); }
          });
          from.svg.appendChild(mp);
          from._morphEl = mp;
        }
        from.el.style.display = 'none';
        to.el.style.display   = 'none';
        from._morphEl.style.opacity = '1';
        var fs = from.el.getAttribute('stroke'), ts = to.el.getAttribute('stroke');
        if (fs && ts) { from._morphEl.setAttribute('stroke', lerpColor(fs, ts, p)); }
        var ff = from.el.getAttribute('fill'), tf = to.el.getAttribute('fill');
        if (ff && tf && ff !== 'none' && tf !== 'none') {
          from._morphEl.setAttribute('fill', lerpColor(ff, tf, p));
        }
        var ffo = parseFloat(from.el.getAttribute('fill-opacity') || '0');
        var tfo = parseFloat(to.el.getAttribute('fill-opacity')   || '0');
        from._morphEl.setAttribute('fill-opacity', String(lerp(ffo, tfo, p)));
        from._morphEl.setAttribute('d', segsToPathD(lerpSegs(fromSegs, toSegs, p)));
        return;
      }
      // Fallback for same-type transforms (attribute lerp) and unsupported cross-type (cross-fade).
      from.el.style.opacity = String(1 - p);
      to.el.style.opacity   = String(p);
      if (from.kind === to.kind) {
        ['cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2', 'font-size'].forEach(function (attr) {
          var a = from.el.getAttribute(attr), b = to.el.getAttribute(attr);
          if (a != null && b != null) {
            var v = String(lerp(parseFloat(a), parseFloat(b), p));
            from.el.setAttribute(attr, v);
            to.el.setAttribute(attr, v);
          }
        });
      }
    },
    // Manim's Indicate: scale up + flash colour, then scale back + restore colour.
    // progress 0→0.5: scale 1→scale, colour→flashColor
    // progress 0.5→1: scale→1, flashColor→original colour
    indicateAround: function (m, progress, opts) {
      var p = clamp01(progress);
      var scale = (opts && opts.scale != null) ? opts.scale : 1.3;
      var flashColor = (opts && opts.color) ? opts.color : '#f59e0b';
      var origStroke = m._indicateOrigStroke !== undefined ? m._indicateOrigStroke : m.el.getAttribute('stroke');
      var origFill   = m._indicateOrigFill   !== undefined ? m._indicateOrigFill   : m.el.getAttribute('fill');
      if (m._indicateOrigStroke === undefined) { m._indicateOrigStroke = origStroke; }
      if (m._indicateOrigFill   === undefined) { m._indicateOrigFill   = origFill;   }
      // phase: 0→0.5 go, 0.5→1 return
      var phase = p < 0.5 ? (p * 2) : (1 - (p - 0.5) * 2);
      var s = lerp(1, scale, smooth(phase));
      m.el.setAttribute('transform', 'scale(' + s + ')');
      var stroke = origStroke ? lerpColor(origStroke, flashColor, phase) : null;
      var fill   = (origFill && origFill !== 'none') ? lerpColor(origFill, flashColor, phase) : null;
      if (stroke) { m.el.setAttribute('stroke', stroke); }
      if (fill)   { m.el.setAttribute('fill',   fill); }
      m.el.style.opacity = '1';
      if (p >= 1) {
        m.el.setAttribute('transform', 'scale(1)');
        if (origStroke) { m.el.setAttribute('stroke', origStroke); }
        if (origFill)   { m.el.setAttribute('fill',   origFill); }
        delete m._indicateOrigStroke;
        delete m._indicateOrigFill;
      }
    },
    flash: function (m, progress, opts) {
      var p = clamp01(progress);
      var flashColor = (opts && opts.color) ? opts.color : '#ffffff';
      var maxOpacity = (opts && opts.maxOpacity != null) ? opts.maxOpacity : 1;
      var origStroke = m._flashOrigStroke !== undefined ? m._flashOrigStroke : m.el.getAttribute('stroke');
      var origFill   = m._flashOrigFill   !== undefined ? m._flashOrigFill   : m.el.getAttribute('fill');
      var origOpacity = m._flashOrigOpacity !== undefined ? m._flashOrigOpacity : (parseFloat(m.el.style.opacity) || 1);
      if (m._flashOrigStroke  === undefined) { m._flashOrigStroke  = origStroke; }
      if (m._flashOrigFill    === undefined) { m._flashOrigFill    = origFill; }
      if (m._flashOrigOpacity === undefined) { m._flashOrigOpacity = origOpacity; }
      // phase: 0→0.5 flash, 0.5→1 return
      var phase = p < 0.5 ? (p * 2) : (1 - (p - 0.5) * 2);
      var stroke = origStroke ? lerpColor(origStroke, flashColor, phase) : null;
      var fill   = (origFill && origFill !== 'none') ? lerpColor(origFill, flashColor, phase) : null;
      if (stroke) { m.el.setAttribute('stroke', stroke); }
      if (fill)   { m.el.setAttribute('fill',   fill); }
      m.el.style.opacity = String(lerp(origOpacity, maxOpacity, phase));
      if (p >= 1) {
        if (origStroke) { m.el.setAttribute('stroke', origStroke); }
        if (origFill)   { m.el.setAttribute('fill',   origFill); }
        m.el.style.opacity = String(origOpacity);
        delete m._flashOrigStroke;
        delete m._flashOrigFill;
        delete m._flashOrigOpacity;
      }
    },
    wiggle: function (m, progress, opts) {
      var p = clamp01(progress);
      var amplitude = (opts && opts.amplitude != null) ? opts.amplitude : 8;
      var frequency = (opts && opts.frequency != null) ? opts.frequency : 3;
      var tx = Math.sin(p * frequency * 2 * Math.PI) * amplitude * (1 - p);
      if (p >= 1) {
        m.el.setAttribute('transform', '');
        return;
      }
      m.el.setAttribute('transform', 'translate(' + tx + ' 0)');
    },
    bounce: function (m, progress, opts) {
      var p = clamp01(progress);
      var height = (opts && opts.height != null) ? opts.height : 30;
      var bounces = (opts && opts.bounces != null) ? opts.bounces : 2;
      var ty = 0;
      if (p < 1) {
        var phase = (p * bounces) % 1;
        ty = -Math.abs(Math.sin(phase * Math.PI)) * height * (1 - p * 0.5);
      }
      if (p >= 1) {
        m.el.setAttribute('transform', '');
        return;
      }
      m.el.setAttribute('transform', 'translate(0 ' + ty + ')');
    },
    typewrite: function (m, progress, opts) {
      var p = clamp01(progress);
      var reverse = opts && opts.reverse;
      if (m.kind !== 'text') {
        m.el.style.opacity = String(p);
        return;
      }
      var full = m.el.getAttribute('data-full-text');
      if (full == null) {
        full = m.el.textContent || '';
        m.el.setAttribute('data-full-text', full);
      }
      var count = Math.round(full.length * p);
      m.el.textContent = reverse ? full.slice(full.length - count) : full.slice(0, count);
      m.el.style.opacity = '1';
    },
    shake: function (m, progress, opts) {
      var p = clamp01(progress);
      var amplitude = (opts && typeof opts.amplitude === 'number') ? opts.amplitude : 8;
      var cycles = (opts && typeof opts.cycles === 'number') ? opts.cycles : 4;
      var offset = Math.sin(p * Math.PI * cycles) * amplitude;
      m.el.style.transform = 'translateX(' + offset + 'px)';
    },
    pulse: function (m, progress, opts) {
      var p = clamp01(progress);
      var maxScale = (opts && opts.maxScale != null) ? opts.maxScale : 1.2;
      var t = rate.thereAndBack(p);
      var s = lerp(1, maxScale, t);
      if (m.el.getBBox) {
        var bbox = m.el.getBBox();
        var cx = (opts && opts.cx != null) ? opts.cx : (bbox.x + bbox.width / 2);
        var cy = (opts && opts.cy != null) ? opts.cy : (bbox.y + bbox.height / 2);
        if (p <= 0 || p >= 1) {
          m.el.removeAttribute('transform');
        } else {
          m.el.setAttribute('transform', 'translate(' + cx + ' ' + cy + ') scale(' + s + ') translate(' + (-cx) + ' ' + (-cy) + ')');
        }
      } else {
        if (p <= 0 || p >= 1) {
          m.el.style.transform = '';
        } else {
          m.el.style.transform = 'scale(' + s + ')';
        }
      }
    },
    zoomIn: function (m, progress, opts) {
      var p = clamp01(progress);
      var startScale = (opts && opts.startScale != null) ? Number(opts.startScale) : 0.1;
      var s = lerp(startScale, 1, p);
      if (p >= 1) {
        m.el.style.transform = '';
        m.el.style.opacity = '';
      } else {
        m.el.style.opacity = String(p);
        if (m.el.getBBox) {
          var bb = m.el.getBBox();
          var cx = bb.x + bb.width / 2;
          var cy = bb.y + bb.height / 2;
          m.el.setAttribute('transform', 'translate(' + cx + ' ' + cy + ') scale(' + s + ') translate(' + (-cx) + ' ' + (-cy) + ')');
        } else {
          m.el.style.transform = 'scale(' + s + ')';
        }
      }
    },
    countUp: function (m, progress, opts) {
      var p = clamp01(progress);
      var from = (opts && opts.from != null) ? Number(opts.from) : 0;
      var to = (opts && opts.to != null) ? Number(opts.to) : 0;
      var prefix = (opts && opts.prefix) ? String(opts.prefix) : '';
      var suffix = (opts && opts.suffix) ? String(opts.suffix) : '';
      var val = Math.round(lerp(from, to, p));
      m.el.textContent = prefix + String(val) + suffix;
    },
    fadeInFromDirection: function (m, progress, opts) {
      var p = clamp01(progress);
      var direction = (opts && opts.direction) || 'left';
      var distance = (opts && opts.distance != null) ? opts.distance : 40;
      var remaining = 1 - p;
      var dx = 0, dy = 0;
      if (direction === 'left')  { dx = -distance * remaining; }
      if (direction === 'right') { dx =  distance * remaining; }
      if (direction === 'up')    { dy = -distance * remaining; }
      if (direction === 'down')  { dy =  distance * remaining; }
      if (p >= 1) {
        m.el.style.transform = '';
        m.el.style.opacity = '1';
      } else {
        m.el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        m.el.style.opacity = String(p);
      }
    },
    colorShift: function (m, progress, opts) {
      var p = clamp01(progress);
      var attr = (opts && opts.attr) || 'stroke';
      var toColor = opts && opts.to ? String(opts.to) : '#ffffff';
      var fromColor = opts && opts.from ? String(opts.from)
        : (m.el.getAttribute('stroke') || '#000000');
      var color = lerpColor(fromColor, toColor, p);
      if (attr === 'stroke' || attr === 'both') {
        m.el.setAttribute('stroke', color);
        if (m.el.tagName === 'text') { m.el.setAttribute('fill', color); }
      }
      if (attr === 'fill' || attr === 'both') {
        m.el.setAttribute('fill', color);
      }
    },
    drawBorderThenFill: function (m, progress) {
      var p = clamp01(progress);
      var len = getLength(m.el);
      m.el.setAttribute('stroke-dasharray', String(len));
      if (p <= 0.5) {
        m.el.setAttribute('stroke-dashoffset', String(len * (1 - p * 2)));
        m.el.setAttribute('fill-opacity', '0');
      } else {
        m.el.setAttribute('stroke-dashoffset', '0');
        m.el.setAttribute('fill-opacity', String((p - 0.5) * 2));
      }
    },
  };
  // tex() — sends a renderLatex postMessage to the host page (which runs
  // KaTeX with its fonts), resolves to a <div> with the rendered MathML.
  var _texResolvers = {};
  var _texCounter = 0;
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || d.type !== 'latexResult' || !_texResolvers[d.id]) return;
    var resolve = _texResolvers[d.id];
    delete _texResolvers[d.id];
    resolve(d.html || '');
  });
  function tex(latex, opts) {
    return new Promise(function (resolve) {
      var id = ++_texCounter;
      _texResolvers[id] = function (html) {
        var el = document.createElement('div');
        el.innerHTML = html;
        el.style.display = 'inline-block';
        if (opts && opts.color) { el.style.color = String(opts.color); }
        if (opts && opts.fontSize) { el.style.fontSize = String(opts.fontSize); }
        resolve(el);
      };
      window.parent.postMessage({ type: 'renderLatex', id: id, latex: String(latex) }, '*');
    });
  }
  window.Manim = {
    config: { width: W, height: H },
    rate: rate,
    colors: colors,
    lerp: lerp,
    lerpColor: lerpColor,
    createSvg: createSvg,
    shapes: shapes,
    coordinateSystems: coordinateSystems,
    animate: animate,
    tex: tex,
  };
})();
`;
