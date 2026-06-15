/**
 * JS source injected into the `custom-script` sandbox (see
 * `buildCustomScriptSandboxDoc`) before user/AI code runs. Defines a small
 * `window.Manim` helper library so "manim 式" animations can use manim's
 * coordinate system (origin at center, +y up, x in [-7, 7], y in [-4, 4]),
 * color palette, standard rate functions, signature
 * Create/Write/FadeIn/FadeOut/Transform-style motions, and `Axes`/`NumberPlane`
 * coordinate-plane mobjects (with `coordsToPoint`) without the real
 * Python manim library (which the sandbox cannot load over the network).
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
      el.setAttribute('font-size', String(opts.fontSize != null ? opts.fontSize : 0.6));
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
    scale: function (m, factor, progress, cx, cy) {
      var p = clamp01(progress);
      var s = lerp(1, factor, p);
      var scx = cx || 0, scy = toSvgY(cy || 0);
      m.el.setAttribute('transform', 'translate(' + scx + ' ' + scy + ') scale(' + s + ') translate(' + (-scx) + ' ' + (-scy) + ')');
    },
    transform: function (from, to, progress) {
      var p = clamp01(progress);
      from.el.style.opacity = String(1 - p);
      to.el.style.opacity = String(p);
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
  };
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
  };
})();
`;
