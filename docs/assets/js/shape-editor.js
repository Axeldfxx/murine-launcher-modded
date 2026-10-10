// Icon shape editor for /icon-shapes/. Plain JS, no build step; polygon-clipping.min.js (loaded first) merges shapes.
//
// An icon is a list of shapes that get merged into one outline. A shape is either
//   { pts: [{x, y, r, s}], mirror }      an editable polygon with rounded corners, or
//   { fixed: name, a, x, y, mirror }     a ready-made FIXED path, scaled by a and then moved by (x, y).
// mirror adds copies flipped across the canvas centre lines: 'none', 'h' (left/right), 'v' (top/bottom), 'both'.
// Polygon points live in the launcher's 0..100 box:
//   r = corner size (how far the rounding reaches along both edges)
//   s = smoothing, 0 = straight cut, 0.5 = circular arc, 1 = squircle-like
// The output path is written for androidx graphics-shapes' SvgPathParser
// (ShapeDelegate.GenericPathShape), which is stricter than SVG: absolute M/L/C/Z only,
// numbers separated by single spaces, no exponents, one closed contour.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  // Points may sit outside the 0..100 box (rounding pulls the outline inward), so the canvas
  // shows a margin around it and grows when something reaches further out.
  const view = { lo: -20, hi: 120 };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmt = (n) => String(+n.toFixed(2)); // +"…" drops trailing zeros and "-0"
  const r2 = (n) => +n.toFixed(2);
  const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

  // ---------- geometry ----------

  // How far each corner's rounding actually reaches. Two corners sharing an edge split it in proportion
  // to their sizes, so they never overlap.
  function cornerSizes(pts) {
    const n = pts.length, cap = (p, q, len) => (p.r + q.r <= len ? p.r : (len * p.r) / (p.r + q.r));
    return pts.map((p, i) => {
      const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n], la = dist(a, p), lb = dist(p, b);
      return la < 1e-6 || lb < 1e-6 ? 0 : Math.min(p.r, cap(p, a, la), cap(p, b, lb));
    });
  }

  function buildPath(pts) {
    const n = pts.length, out = [], sizes = cornerSizes(pts);
    let last = null;
    const xy = (p) => fmt(p.x) + ' ' + fmt(p.y);
    // Skip near-zero lines: they become degenerate cubics in the launcher's polygon.
    const line = (p) => { if (!last || dist(last, p) > 0.05) out.push('L ' + xy(p)); last = p; };

    pts.forEach((p, i) => {
      const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
      const la = dist(a, p), lb = dist(p, b), d = sizes[i];
      if (d < 0.01) return line(p);

      const pin = lerp(p, a, d / la), pout = lerp(p, b, d / lb);
      const cos = ((a.x - p.x) * (b.x - p.x) + (a.y - p.y) * (b.y - p.y)) / (la * lb);
      const turn = Math.PI - Math.acos(clamp(cos, -1, 1));
      // Handle length (as a fraction of d) that makes the cubic a circular arc for this angle.
      const kc = turn < 1e-3 ? 2 / 3 : ((4 / 3) * Math.tan(turn / 4)) / Math.tan(turn / 2);
      const k = p.s < 0.5 ? 2 * p.s * kc : kc + (2 * p.s - 1) * (1 - kc);
      line(pin);
      if (k < 1e-3) return line(pout); // a straight cut: a flat cubic here confuses the launcher's polygon detection
      out.push('C ' + xy(lerp(pin, p, k)) + ' ' + xy(lerp(pout, p, k)) + ' ' + xy(pout));
      last = pout;
    });
    out[0] = 'M' + out[0].slice(1);
    return out.join(' ') + ' Z';
  }

  // ponytail: checks the polygon, not the rounded outline; good enough to catch crossed edges
  function selfIntersects(pts) {
    const n = pts.length;
    const o = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    for (let i = 0; i < n; i++) {
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue; // adjacent through the closing edge
        const a = pts[i], b = pts[i + 1], c = pts[j], d = pts[(j + 1) % n];
        if (o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b)) return true;
      }
    }
    return false;
  }

  const measure = (d) => { const m = $('se-measure-path'); m.setAttribute('d', d); return m.getBBox(); };

  // Scales and centres the *rendered* outline of a polygon so it fills the 0..100 box.
  function fit(pts) {
    const bb = measure(buildPath(pts)), k = 100 / Math.max(bb.width, bb.height);
    const ox = (100 - bb.width * k) / 2, oy = (100 - bb.height * k) / 2;
    return pts.map((p) => ({ x: r2((p.x - bb.x) * k + ox), y: r2((p.y - bb.y) * k + oy), r: r2(p.r * k), s: p.s }));
  }

  // Regular polygon (inner = 1) or star (inner < 1, alternating outer/inner points).
  function polygon(sides, inner, rotDeg, rOuter, rInner = rOuter, s = 0.5) {
    const m = inner < 1 ? sides * 2 : sides;
    return Array.from({ length: m }, (_, i) => {
      const t = ((rotDeg - 90) * Math.PI) / 180 + (i * 2 * Math.PI) / m;
      const isInner = inner < 1 && i % 2 === 1, rad = 50 * (isInner ? inner : 1);
      return { x: 50 + rad * Math.cos(t), y: 50 + rad * Math.sin(t), r: isInner ? rInner : rOuter, s };
    });
  }

  const box = (tl, tr, br, bl, s = 0.5) =>
    [[0, 0, tl], [100, 0, tr], [100, 100, br], [0, 100, bl]].map(([x, y, r]) => ({ x, y, r, s }));

  const PRESETS = {
    Circle: () => box(50, 50, 50, 50),
    Squircle: () => box(50, 50, 50, 50, 1),
    'Rounded square': () => box(24, 24, 24, 24, 0.6),
    Square: () => box(8, 8, 8, 8),
    Arch: () => box(50, 50, 14, 14),
    Teardrop: () => box(50, 10, 50, 50),
    Leaf: () => box(50, 12, 50, 12),
    Cut: () => box(22, 22, 22, 22, 0),
    Triangle: () => polygon(3, 1, 0, 18),
    Hexagon: () => polygon(6, 1, 0, 14),
    Octagon: () => polygon(8, 1, 22.5, 8),
    'Cookie 4': () => polygon(4, 0.62, 45, 45, 14),
    'Cookie 7': () => polygon(7, 0.8, 0, 20, 8),
    Flower: () => polygon(6, 0.62, 0, 30, 2),
    Burst: () => polygon(12, 0.86, 0, 4, 2),
    Diamond: () => polygon(4, 1, 0, 16),
  };

  // Ready-made paths that can't be expressed as one rounded polygon, so they aren't editable point by point.
  const FIXED = {
    // App icon head: outer silhouette + forehead + goatee fused into one contour (the launcher
    // only reads the first contour), eye/whisker cut-outs dropped, simplified to 0.05 units.
    Murine: 'M 9.38 59.57 L 10.34 60.94 L 11.76 62.66 L 13.13 64.1 L 14.6 65.44 L 14.91 65.86 L 15.1 66.52 L 15.08 67.03 L 14.82 67.67 L 14.38 68.15 L 15.92 69.39 L 17.76 70.65 L 19.7 71.81 L 22.13 73.01 L 24.4 74.01 L 28.59 75.67 L 32.42 78.33 L 34.36 79.44 L 36.36 80.43 L 37.27 80.84 L 37.71 80.54 L 38.2 80.38 L 38.72 80.38 L 39.36 80.6 L 39.88 81.05 L 40.21 81.62 L 40.97 82.54 L 42.8 84.45 L 44.66 86.14 L 46.74 87.76 L 47.54 87.52 L 48.25 87.62 L 48.73 87.87 L 49.92 88.77 L 51.22 87.83 L 51.68 87.58 L 52.36 87.48 L 53.26 87.7 L 55.15 86.26 L 56.9 84.65 L 58.61 82.8 L 59.67 81.51 L 60.04 80.87 L 60.45 80.53 L 60.93 80.32 L 61.63 80.28 L 62.14 80.43 L 62.64 80.78 L 64.15 80.17 L 67.84 78.1 L 71.36 75.7 L 77.07 73.41 L 80.63 71.67 L 83.17 70.11 L 84.98 68.81 L 85.74 68.16 L 85.3 67.67 L 85.02 67.03 L 85.02 66.33 L 85.19 65.84 L 85.49 65.41 L 86.97 64.07 L 88.32 62.63 L 89.42 61.29 L 90.59 59.67 L 90.48 59.53 L 85.59 57.99 L 85.14 57.72 L 84.9 57.47 L 84.63 57.03 L 84.51 56.52 L 84.53 56 L 84.71 55.51 L 86.56 53.36 L 87.65 51.76 L 84.31 51.74 L 83.64 51.54 L 83.11 51.1 L 82.84 50.65 L 82.7 49.96 L 82.78 49.45 L 83.17 48.5 L 83.53 48.1 L 83.82 47.91 L 86.26 47.22 L 88.31 46.38 L 90.26 45.29 L 92.07 43.96 L 93.54 42.63 L 95.04 40.98 L 96.35 39.19 L 97.49 37.26 L 98.5 35.01 L 99.27 32.65 L 99.72 30.45 L 99.97 27.99 L 99.95 25.51 L 99.67 23.3 L 99.13 21.14 L 98.41 19.28 L 97.46 17.53 L 96.1 15.78 L 94.66 14.4 L 92.83 13.12 L 90.84 12.15 L 88.94 11.57 L 86.96 11.27 L 84.73 11.28 L 82.53 11.64 L 80.18 12.4 L 77.94 13.47 L 75.65 14.93 L 73.69 16.46 L 71.85 18.13 L 69.18 21.06 L 66.81 24.13 L 66.41 24.48 L 65.92 24.69 L 65.4 24.74 L 65.05 24.69 L 64.56 24.49 L 64.27 24.28 L 63.94 23.87 L 63.79 23.55 L 63.7 22.83 L 62.22 23.17 L 58.96 24.1 L 55.59 25.25 L 52.37 24.93 L 49.72 24.84 L 47.44 24.92 L 44.26 25.26 L 41.24 24.21 L 36.13 22.81 L 35.93 23.6 L 35.5 24.14 L 34.9 24.48 L 34.21 24.56 L 33.7 24.44 L 33.12 24.07 L 31.48 21.93 L 30.05 20.22 L 27.44 17.58 L 26.51 16.75 L 24.97 15.5 L 23.55 14.49 L 22.07 13.58 L 20.74 12.89 L 19.14 12.22 L 17.48 11.7 L 15.79 11.37 L 14.31 11.24 L 12.8 11.27 L 11.35 11.47 L 9.91 11.85 L 8.5 12.38 L 6.57 13.45 L 4.99 14.68 L 3.45 16.3 L 2.18 18.13 L 1.22 20.14 L 0.48 22.5 L 0.11 24.71 L 0 27.18 L 0.1 28.91 L 0.33 30.63 L 0.75 32.56 L 1.27 34.23 L 2 36.07 L 2.77 37.62 L 3.68 39.1 L 4.7 40.53 L 5.8 41.85 L 6.83 42.93 L 9.11 44.85 L 10.77 45.91 L 12.33 46.68 L 13.96 47.29 L 16.14 47.92 L 16.56 48.25 L 16.79 48.53 L 17.21 49.53 L 17.26 50.06 L 17.09 50.75 L 16.65 51.32 L 16.2 51.6 L 15.51 51.76 L 12.27 51.78 L 12.29 51.93 L 13.3 53.26 L 15.22 55.55 L 15.39 56.04 L 15.42 56.56 L 15.29 57.06 L 15.02 57.51 L 14.78 57.75 L 14.34 58.02 Z',
  };

  // ---------- shapes ----------

  const MIRRORS = { none: [], h: [[-1, 1]], v: [[1, -1]], both: [[-1, 1], [1, -1], [-1, -1]] };
  // Rewrites every coordinate pair of one of our own paths (absolute M/L/C/Z, single spaces).
  const mapPath = (d, f) => d.replace(/(-?[\d.]+) (-?[\d.]+)/g, (_, x, y) => { const p = f(+x, +y); return fmt(p.x) + ' ' + fmt(p.y); });
  const shapePath = (sh) => (sh.fixed ? mapPath(FIXED[sh.fixed], (x, y) => ({ x: x * sh.a + sh.x, y: y * sh.a + sh.y })) : buildPath(sh.pts));
  // A shape's own outline followed by its mirrored copies.
  const copies = (sh) => {
    const d = shapePath(sh);
    return [d, ...MIRRORS[sh.mirror].map(([sx, sy]) => mapPath(d, (x, y) => ({ x: sx < 0 ? 100 - x : x, y: sy < 0 ? 100 - y : y })))];
  };
  // p -> (p - c) * k + t, for both kinds of shape (corner sizes scale too, so the look is kept).
  function transform(sh, k, cx, cy, tx, ty) {
    if (sh.fixed) return { ...sh, a: r2(sh.a * k), x: r2((sh.x - cx) * k + tx), y: r2((sh.y - cy) * k + ty) };
    return { ...sh, pts: sh.pts.map((p) => ({ x: r2((p.x - cx) * k + tx), y: r2((p.y - cy) * k + ty), r: r2(p.r * k), s: p.s })) };
  }
  // Scales the given shapes, mirrored copies included, until they touch the box. An axis with mirrored
  // copies is symmetric around the canvas centre, so it may only scale around 50, never shift.
  function fitted(list) {
    const bb = measure(list.flatMap(copies).join(' '));
    if (!(bb.width > 0.01 && bb.height > 0.01)) return list;
    const lockX = list.some((s) => s.mirror === 'h' || s.mirror === 'both');
    const lockY = list.some((s) => s.mirror === 'v' || s.mirror === 'both');
    const kx = lockX ? 50 / Math.max(50 - bb.x, bb.x + bb.width - 50) : 100 / bb.width;
    const ky = lockY ? 50 / Math.max(50 - bb.y, bb.y + bb.height - 50) : 100 / bb.height;
    const k = Math.min(kx, ky), cx = lockX ? 50 : bb.x + bb.width / 2, cy = lockY ? 50 : bb.y + bb.height / 2;
    return list.map((s) => transform(s, k, cx, cy, 50, 50));
  }
  // Puts `sh` where `old` was: same centre, longest side as long as old's.
  function placeLike(sh, old) {
    const a = measure(shapePath(old)), b = measure(shapePath(sh));
    const k = Math.max(a.width, a.height) / Math.max(b.width, b.height, 0.01);
    return { ...transform(sh, k, b.x + b.width / 2, b.y + b.height / 2, a.x + a.width / 2, a.y + a.height / 2), mirror: old.mirror };
  }
  const presetShapes = (name) => (Object.hasOwn(FIXED, name)
    ? [{ fixed: name, a: 1, x: 0, y: 0, mirror: 'none' }]
    : [{ pts: fit(PRESETS[name]()), mirror: 'none' }]);
  const shapeName = (sh, i) => sh.fixed || `Shape ${i + 1}`;

  // ---------- merging ----------

  // Polyline of one of our own paths; curves become segments of at most ~1.5 units.
  function flatten(d) {
    const t = d.split(' '), ring = [];
    let i = 0, cx = 0, cy = 0;
    while (i < t.length) {
      const c = t[i++];
      if (c === 'M' || c === 'L') { cx = +t[i++]; cy = +t[i++]; ring.push([cx, cy]); }
      else if (c === 'C') {
        const [x1, y1, x2, y2, x, y] = t.slice(i, i + 6).map(Number);
        i += 6;
        const len = Math.hypot(x1 - cx, y1 - cy) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x - x2, y - y2);
        const n = clamp(Math.ceil(len / 1.5), 2, 32);
        for (let k = 1; k <= n; k++) {
          const s = k / n, u = 1 - s, a = u * u * u, b = 3 * u * u * s, c2 = 3 * u * s * s, e = s * s * s;
          ring.push([a * cx + b * x1 + c2 * x2 + e * x, a * cy + b * y1 + c2 * y2 + e * y]);
        }
        cx = x; cy = y;
      }
    }
    return ring;
  }
  // Ramer–Douglas–Peucker: drops points closer than tol to the line between their neighbours.
  function simplify(pts, tol) {
    if (pts.length < 4) return pts;
    const keep = new Uint8Array(pts.length), stack = [[0, pts.length - 1]];
    keep[0] = keep[pts.length - 1] = 1;
    while (stack.length) {
      const [a, b] = stack.pop(), [ax, ay] = pts[a], [bx, by] = pts[b], len = Math.hypot(bx - ax, by - ay) || 1;
      let idx = -1, max = tol;
      for (let i = a + 1; i < b; i++) {
        const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
        if (d > max) { max = d; idx = i; }
      }
      if (idx >= 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  // The icon as one outline for the launcher: { d, error, note }. A lone shape keeps its exact path
  // (curves included); anything else is flattened, merged and simplified to straight segments.
  function iconPath() {
    const all = shapes.flatMap(copies);
    if (all.length === 1) return { d: all[0] };
    let merged;
    try { merged = polygonClipping.union(...all.map((d) => [flatten(d)])); } catch (e) { return { d: all.join(' '), error: "These shapes couldn't be merged." }; }
    const outline = (poly) => 'M ' + simplify(poly[0].slice(0, -1), 0.05).map(([x, y]) => fmt(x) + ' ' + fmt(y)).join(' L ') + ' Z';
    if (merged.length !== 1) {
      return { d: merged.map(outline).join(' '), error: "The shapes don't all touch. The launcher needs them to form one connected outline." };
    }
    return { d: outline(merged[0]), note: merged[0].length > 1 ? 'Gaps enclosed by the shapes are filled in: the launcher needs an outline without holes.' : '' };
  }

  // ---------- state ----------

  const STORE = 'murine-shape-editor';
  let shapes, active = 0, mode = 'edit', sel = -1, drag = null, sliding = false;
  let pts = null, fixed = null; // shortcuts into shapes[active]: its points, or its FIXED name
  const sync = () => {
    active = clamp(active, 0, shapes.length - 1);
    pts = shapes[active].pts || null;
    fixed = shapes[active].fixed || null;
    if (fixed) mode = 'move';
  };
  const undo = [], redo = [];

  // Everything needed to resume editing. Undo, localStorage and edit links all go through this pair,
  // so a new piece of state only has to be added to snapshot() and restore().
  const snapshot = () => ({ shapes, active });
  // Also reads edit links, i.e. anything anyone can type into a URL: rebuild every field, keep nothing unchecked.
  function cleanShape(s) {
    const mirror = Object.hasOwn(MIRRORS, s?.mirror) ? s.mirror : 'none';
    if (typeof s?.fixed === 'string' && Object.hasOwn(FIXED, s.fixed)) {
      const sh = { fixed: s.fixed, a: clamp(+(s.a ?? 1), 0.01, 20), x: clamp(+(s.x ?? 0), -1000, 1000), y: clamp(+(s.y ?? 0), -1000, 1000), mirror };
      return [sh.a, sh.x, sh.y].every(Number.isFinite) ? sh : null;
    }
    if (!Array.isArray(s?.pts) || s.pts.length < 3 || s.pts.length > 200) return null;
    const p = s.pts.map((q) => ({ x: clamp(+q?.x, -500, 600), y: clamp(+q?.y, -500, 600), r: clamp(+q?.r, 0, 500), s: clamp(+q?.s, 0, 1) }));
    return p.every((q) => [q.x, q.y, q.r, q.s].every(Number.isFinite)) ? { pts: p, mirror } : null;
  }
  function restore(o) {
    // Saves and links from before multiple shapes held one shape: { pts } or { pts, fixed }.
    if (o && !o.shapes && (o.pts || o.fixed)) o = { shapes: [o.fixed ? { fixed: o.fixed } : { pts: o.pts }], active: 0 };
    if (!Array.isArray(o?.shapes) || !o.shapes.length || o.shapes.length > 20) return false;
    const list = o.shapes.map(cleanShape);
    if (list.includes(null)) return false;
    shapes = list;
    active = Number.isInteger(o.active) ? o.active : 0;
    sel = -1;
    sync();
    return true;
  }

  // Links carry their data deflated (raw DEFLATE, built into every current browser as CompressionStream)
  // and base64url-encoded. The app reads the import link with java.util.zip.Inflater(true) + Base64.URL_SAFE.
  const pipe = (bytes, stream) => new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer();
  const pack = async (str) => btoa(String.fromCharCode(...new Uint8Array(await pipe(str, new CompressionStream('deflate-raw')))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unpack = async (b64) => new TextDecoder().decode(await pipe(
    Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)), new DecompressionStream('deflate-raw')));
  // Same path with the separators the launcher's parser also accepts: "M9.38,59.57L.5,-.97Z".
  const compactPath = (d) => d.replace(/ ?([MLCZ]) ?/g, '$1').replace(/ /g, ',').replace(/(^|[^\d])0\./g, '$1.');
  const IMPORT = 'murine-home://icon-shape?shape='; // ponytail: the app side doesn't exist yet; it must validate the path

  // Built after every change, so a click can copy or open them without waiting.
  let links = { edit: '', import: '' }, linkRun = 0;
  async function refreshLinks(d, bad) {
    const run = ++linkRun, state = JSON.stringify(snapshot());
    const [e, i] = await Promise.all([pack(state), pack(compactPath(d))]);
    if (run !== linkRun) return; // a newer change already started its own
    links = { edit: location.origin + location.pathname + '#edit=' + e, import: bad ? '' : IMPORT + i };
    $('se-use').href = links.import || '#';
  }
  const grid = { show: true, snap: true, step: 5 };
  const snap = (v) => clamp(grid.snap ? Math.round(v / grid.step) * grid.step : +v.toFixed(2), view.lo, view.hi);
  const checkpoint = () => {
    undo.push(JSON.stringify(snapshot()));
    if (undo.length > 100) undo.shift();
    redo.length = 0; // a new edit starts a new branch, so there's nothing left to redo
  };
  // Whole icon (presets, Reset) or just the selected shape (Generate).
  const loadIcon = (list) => { checkpoint(); shapes = list; active = 0; sel = -1; mode = 'edit'; sync(); render(); };
  const replaceShape = (sh) => { checkpoint(); shapes[active] = sh; sel = -1; mode = 'edit'; sync(); render(); };
  const withSize = (i, r) => pts.map((p, k) => (k === i ? { ...p, r } : p));
  const neighbours = (i) => [(i + pts.length - 1) % pts.length, (i + 1) % pts.length];
  // Largest size corner i can take before it starts shrinking a neighbour's rounding. Neighbours only
  // ever shrink as it grows, so a binary search finds the point.
  function squeezeStart(i, max) {
    const nb = neighbours(i);
    const sum = (r) => { const d = cornerSizes(withSize(i, r)); return d[nb[0]] + d[nb[1]]; };
    const base = sum(0);
    if (sum(max) >= base - 0.01) return max;
    let lo = 0, hi = max;
    for (let k = 0; k < 20; k++) { const m = (lo + hi) / 2; if (sum(m) < base - 0.01) hi = m; else lo = m; }
    return lo;
  }

  // ---------- rendering ----------

  const svg = $('se-canvas');
  const el = (tag, attrs) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  };
  // Grows or shrinks a container to n children. Everything on the canvas is updated in place, never
  // replaced: a replaced element under a finger is detached, and its touch events then never reach
  // the canvas listener that stops the page scrolling.
  const resize = (parent, n, make) => {
    while (parent.children.length > n) parent.lastChild.remove();
    while (parent.children.length < n) parent.append(make());
  };

  function drawGrid() {
    const g = $('se-grid');
    g.replaceChildren();
    if (!grid.show) return;
    const { lo, hi } = view;
    for (let v = Math.ceil(lo / grid.step) * grid.step; v <= hi; v += grid.step) {
      const cls = v === 50 ? 'se-grid-mid' : 'se-grid-line';
      g.append(el('line', { x1: v, y1: lo, x2: v, y2: hi, class: cls }));
      g.append(el('line', { x1: lo, y1: v, x2: hi, y2: v, class: cls }));
    }
  }

  let activeBox = null; // bounding box of the selected shape's own outline, for Move mode
  const boxCorners = (b) => [{ x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x + b.width, y: b.y + b.height }, { x: b.x, y: b.y + b.height }];

  function render() {
    const lines = shapes.map(copies); // per shape: own outline, then its mirrored copies
    if (!drag) {
      const bb = measure(lines.flat().join(' '));
      const xy = [bb.x, bb.y, bb.x + bb.width, bb.y + bb.height, ...(pts ? pts.flatMap((p) => [p.x, p.y]) : [])];
      const lo = Math.floor(Math.min(-20, ...xy) - 6), hi = Math.ceil(Math.max(120, ...xy) + 6);
      if (lo !== view.lo || hi !== view.hi) {
        Object.assign(view, { lo, hi });
        svg.setAttribute('viewBox', `${lo} ${lo} ${hi - lo} ${hi - lo}`);
        drawGrid();
      }
    }
    const out = iconPath();
    const crossed = shapes.findIndex((sh) => sh.pts && selfIntersects(sh.pts));
    const bad = !!out.error || crossed >= 0;

    // Each shape and mirrored copy is filled and outlined on its own; the selected one is drawn last, on top.
    const order = shapes.map((_, i) => i).filter((i) => i !== active).concat(active); // selected shape on top
    const strokes = order.flatMap((i) => lines[i].map((d, c) => ({ d, cls: 'se-line' + (i === active ? ' active' : '') + (c ? ' copy' : '') })));
    const layer = $('se-lines');
    resize(layer, strokes.length, () => el('path', {}));
    strokes.forEach((s, k) => { layer.children[k].setAttribute('d', s.d); layer.children[k].setAttribute('class', s.cls); });
    $('se-outline').setAttribute('points', pts && mode === 'edit' ? pts.map((p) => p.x + ',' + p.y).join(' ') : '');

    // Neighbours whose rounding the selected corner is currently eating into.
    const squeezed = new Set();
    if (pts && sel >= 0) {
      const now = cornerSizes(pts), alone = cornerSizes(withSize(sel, 0));
      for (const j of neighbours(sel)) if (now[j] < alone[j] - 0.01) squeezed.add(j);
    }

    const handles = $('se-handles'), adders = $('se-adders'), shown = pts && mode === 'edit' ? pts : [];
    const focused = document.activeElement?.dataset?.i !== undefined;
    resize(adders, shown.length, () => {
      const g = el('g', { class: 'se-add' }), t = el('title', {});
      t.textContent = 'Add a point here';
      g.append(el('circle', { r: 5, class: 'se-hit' }), el('circle', { r: 2.6 }), el('path', {}), t);
      return g;
    });
    resize(handles, shown.length, () => {
      const g = el('g', { tabindex: 0, role: 'button' });
      g.append(el('circle', { r: 6, class: 'se-hit' }), el('circle', { r: 2.4 }));
      return g;
    });
    shown.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length], m = lerp(p, q, 0.5), a = adders.children[i], h = handles.children[i];
      a.dataset.add = i;
      a.style.display = !drag && dist(p, q) > 10 ? '' : 'none'; // grabAt() uses the same rule
      for (const c of a.querySelectorAll('circle')) { c.setAttribute('cx', m.x); c.setAttribute('cy', m.y); }
      a.querySelector('path').setAttribute('d', `M${m.x - 1.4} ${m.y}h2.8M${m.x} ${m.y - 1.4}v2.8`);
      h.dataset.i = i;
      h.setAttribute('aria-label', `Point ${i + 1}`);
      h.setAttribute('class', 'se-handle' + (i === sel ? ' selected' : '') + (squeezed.has(i) ? ' squeezed' : ''));
      for (const c of h.children) { c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); }
    });
    if (focused && sel >= 0 && document.activeElement !== handles.children[sel]) handles.children[sel]?.focus();

    // Move mode: a box around the selected shape, with a resize handle on each corner.
    const moving = mode === 'move';
    $('se-move').style.display = moving ? '' : 'none';
    if (moving) {
      activeBox = measure(lines[active][0]);
      const r = $('se-move-box'), b = activeBox;
      r.setAttribute('x', b.x); r.setAttribute('y', b.y); r.setAttribute('width', b.width); r.setAttribute('height', b.height);
      boxCorners(b).forEach((c, i) => {
        const h = $('se-move').querySelectorAll('.se-resize')[i];
        h.setAttribute('x', c.x - 2); h.setAttribute('y', c.y - 2);
      });
    }
    $('se-fit-shape').hidden = $('se-mirror').hidden = !moving;
    for (const b of $('se-mirror').querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.mirror === shapes[active].mirror);

    renderCards();

    // controls
    const editable = !!pts;
    $('se-corner-set').disabled = !editable;
    $('se-point-set').disabled = !editable || moving;
    $('se-fixed-note').hidden = editable;
    if (editable) {
      const cur = pts[Math.max(sel, 0)];
      $('se-corner-legend').textContent = sel >= 0 ? `Corner ${sel + 1}` : 'All corners';
      // The slider ends where the shape stops changing: two corners sharing an edge split it, so with every
      // corner the same size each one saturates at half its shorter edge; a lone corner can take more.
      const reach = (i) => Math.min(dist(pts[i], pts[(i + pts.length - 1) % pts.length]), dist(pts[i], pts[(i + 1) % pts.length]));
      const maxSize = sel >= 0 ? reach(sel) : Math.max(...pts.map((_, i) => reach(i) / 2));
      $('se-size').max = Math.max(0.1, Math.ceil(maxSize * 10) / 10); // set before value, which the browser clamps to it
      $('se-size').value = cur.r; $('se-size-v').textContent = fmt(Math.min(cur.r, +$('se-size').max));
      const max = +$('se-size').max, zone = sel >= 0 ? squeezeStart(sel, max) : max, hasZone = zone < max - 0.05;
      $('se-size-track').classList.toggle('has-zone', hasZone);
      $('se-size-track').style.setProperty('--squeeze', zone / max);
      // Only the text changes while the slider is dragged (the zone depends on the neighbours, not on this
      // corner's size): showing or hiding an element under the thumb makes Chrome drop the drag.
      const warn = $('se-size-warn');
      warn.hidden = !hasZone;
      warn.classList.toggle('active', squeezed.size > 0);
      warn.textContent = squeezed.size ? 'Shrinking the highlighted neighbouring corners'
        : 'Past the red mark it also shrinks the neighbouring corners';
      $('se-smooth').value = Math.round(cur.s * 100); $('se-smooth-v').textContent = Math.round(cur.s * 100) + '%';
      $('se-apply-all').disabled = sel < 0;
      $('se-x').disabled = $('se-y').disabled = sel < 0;
      $('se-x').value = sel >= 0 ? fmt(cur.x) : ''; $('se-y').value = sel >= 0 ? fmt(cur.y) : '';
      $('se-remove').disabled = sel < 0 || pts.length <= 3;
    }
    $('se-undo').disabled = undo.length === 0;
    $('se-redo').disabled = redo.length === 0;

    // output
    $('se-out').value = out.d;
    document.querySelectorAll('.se-preview path').forEach((p) => p.setAttribute('d', out.d));
    $('se-warn').hidden = !bad;
    $('se-warn').textContent = out.error || (crossed < 0 ? '' : (shapes.length > 1 ? shapeName(shapes[crossed], crossed) + ': e' : 'E')
      + "dges cross each other. The launcher needs a shape that doesn't overlap itself.");
    $('se-note').hidden = !out.note;
    $('se-note').textContent = out.note || '';
    $('se-use').classList.toggle('se-disabled', bad);
    refreshLinks(out.d, bad);
    $('se-share-import').disabled = bad;
    try { localStorage.setItem(STORE, JSON.stringify(snapshot())); } catch (e) { /* private mode */ }
  }

  // ---------- shape cards ----------

  const icon = (cp) => `<span class="material-symbols-outlined" aria-hidden="true">&#x${cp};</span>`;
  let cardsKey = '';
  function renderCards() {
    const key = JSON.stringify([shapes, active, mode]);
    if (key === cardsKey) return;
    cardsKey = key;
    const cards = $('se-cards'), focus = document.activeElement?.closest?.('#se-cards [data-act]');
    const refocus = focus && focus.dataset.act + ':' + focus.dataset.card;
    cards.innerHTML = shapes.map((sh, i) => {
      const on = i === active, name = shapeName(sh, i);
      return `<div class="se-card${on ? ' active' : ''}" role="listitem">
        <button type="button" class="se-card-pick" data-act="pick" data-card="${i}" aria-pressed="${on}" aria-label="Select ${name}">
          <svg viewBox="-10 -10 120 120" aria-hidden="true"><rect class="se-card-box" x="0" y="0" width="100" height="100"/>
            ${copies(sh).map((d, c) => `<path class="${c ? 'copy' : ''}" d="${d}"/>`).join('')}</svg>
          <span>${name}</span>
        </button>
        ${shapes.length > 1 ? `<button type="button" class="se-card-del" data-act="del" data-card="${i}" title="Delete ${name}" aria-label="Delete ${name}">${icon('e92e')}</button>` : ''}
        ${on ? `<div class="se-card-modes" role="group" aria-label="Mode">
          <button type="button" data-act="edit" data-card="${i}" aria-pressed="${mode === 'edit'}" title="Edit points" ${sh.fixed ? 'disabled' : ''}>${icon('f097')}</button>
          <button type="button" data-act="move" data-card="${i}" aria-pressed="${mode === 'move'}" title="Move and resize">${icon('e89f')}</button>
        </div>` : ''}
      </div>`;
    }).join('') + `<button type="button" class="se-card se-card-add" data-act="add" data-card="-1" title="Add a shape" aria-label="Add a shape">${icon('e145')}</button>`;
    if (refocus) cards.querySelector(`[data-act="${refocus.split(':')[0]}"][data-card="${refocus.split(':')[1]}"]`)?.focus();
  }
  $('se-cards').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const i = +b.dataset.card;
    if (b.dataset.act === 'pick') { active = i; sel = -1; mode = 'edit'; sync(); render(); }
    else if (b.dataset.act === 'edit' || b.dataset.act === 'move') { mode = b.dataset.act; sel = -1; sync(); render(); }
    else if (b.dataset.act === 'del') {
      if (!confirm(`Delete ${shapeName(shapes[i], i)}? Undo can still bring it back.`)) return;
      checkpoint();
      shapes.splice(i, 1);
      if (active >= i && active > 0) active--;
      sel = -1; sync(); render();
    } else if (b.dataset.act === 'add') addDialog.open();
  });

  // ---------- canvas interaction ----------

  const toSvg = (e) => new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());

  // What a press grabs, decided by distance rather than by the element under the finger: fingers land
  // well off a 6px dot, and touchstart (which stops the page scrolling) and pointerdown (which starts
  // the drag) have to agree. Edit mode grabs points and "+" marks, Move mode the selected shape's box.
  function grabAt(clientX, clientY, touch) {
    const at = toSvg({ clientX, clientY }), unitPx = svg.getBoundingClientRect().width / (view.hi - view.lo);
    const reach = Math.max(6, touch ? 28 / unitPx : 0); // 6 units ≈ the old hit circle; fingers get ≥ 28px
    let best = null, bestD = reach;
    if (mode === 'move') {
      if (!activeBox) return null;
      boxCorners(activeBox).forEach((c, i) => { const d = dist(at, c); if (d < bestD) { best = { resize: i }; bestD = d; } });
      const b = activeBox;
      return best || (at.x >= b.x && at.x <= b.x + b.width && at.y >= b.y && at.y <= b.y + b.height ? { move: true } : null);
    }
    if (!pts) return null;
    pts.forEach((q, i) => {
      const next = pts[(i + 1) % pts.length], dq = dist(at, q);
      if (dq < bestD) { best = { point: i }; bestD = dq; }
      // A "+" only exists on edges longer than 10 units, and counts as a bit further than it is so a
      // point next to it still wins.
      const dm = dist(at, lerp(q, next, 0.5)) * 1.3;
      if (dist(q, next) > 10 && dm < bestD) { best = { add: i }; bestD = dm; }
    });
    return best;
  }
  // The topmost shape whose outline (or a mirrored copy) contains the point, else -1.
  function shapeAt(e) {
    const p = toSvg(e), m = $('se-measure-path');
    for (let i = shapes.length - 1; i >= 0; i--) {
      for (const d of copies(shapes[i])) { m.setAttribute('d', d); if (m.isPointInFill(new DOMPoint(p.x, p.y))) return i; }
    }
    return -1;
  }

  // Touch: anywhere but something grabbable, the page scrolls and pinch-zooms as usual.
  let tap = null;
  svg.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    if (e.touches.length === 1 && grabAt(t.clientX, t.clientY, true)) e.preventDefault();
  }, { passive: false });
  // A tap (not a scroll, which ends in pointercancel instead of click) selects the shape under it, or
  // deselects the point when it lands on empty space.
  svg.addEventListener('click', () => {
    if (tap === null) return;
    if (tap >= 0 && tap !== active) { active = tap; sel = -1; mode = shapes[tap].fixed ? 'move' : mode; sync(); render(); }
    else if (sel >= 0) { sel = -1; render(); }
    tap = null;
  });

  svg.addEventListener('pointerdown', (e) => {
    const g = grabAt(e.clientX, e.clientY, e.pointerType === 'touch');
    tap = g ? null : shapeAt(e);
    if (!g) return;
    checkpoint();
    const at = toSvg(e);
    if (g.point !== undefined || g.add !== undefined) {
      if (g.add !== undefined) {
        const a = pts[g.add], m = lerp(a, pts[(g.add + 1) % pts.length], 0.5);
        pts.splice(g.add + 1, 0, { x: snap(m.x), y: snap(m.y), r: a.r, s: a.s });
        sel = g.add + 1;
      } else sel = g.point;
      drag = { kind: 'point', dx: pts[sel].x - at.x, dy: pts[sel].y - at.y }; // the point keeps its distance from the finger
    } else if (g.move) {
      drag = { kind: 'move', from: at, orig: shapes[active] };
    } else {
      const c = boxCorners(activeBox), anchor = c[(g.resize + 2) % 4];
      drag = { kind: 'resize', anchor, d0: dist(anchor, c[g.resize]), orig: shapes[active] };
    }
    svg.setPointerCapture(e.pointerId);
    e.preventDefault(); // this also stops the browser focusing the canvas, so do it here:
    svg.focus({ preventScroll: true }); // Delete, arrows and Esc then act on what was just grabbed
    render();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = toSvg(e);
    if (drag.kind === 'point') {
      pts[sel].x = snap(p.x + drag.dx);
      pts[sel].y = snap(p.y + drag.dy);
    } else if (drag.kind === 'move') {
      const step = (v) => (grid.snap ? Math.round(v / grid.step) * grid.step : v);
      shapes[active] = transform(drag.orig, 1, 0, 0, step(p.x - drag.from.x), step(p.y - drag.from.y));
      sync();
    } else {
      const k = Math.max(0.05, dist(drag.anchor, p) / drag.d0), a = drag.anchor;
      shapes[active] = transform(drag.orig, k, a.x, a.y, a.x, a.y);
      sync();
    }
    render();
  });
  const endDrag = () => { if (drag) { drag = null; render(); } };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);
  svg.addEventListener('focusin', (e) => {
    const h = e.target.closest('[data-i]');
    if (h && +h.dataset.i !== sel) { sel = +h.dataset.i; render(); }
  });

  // A shape can't go below 3 points: shake the canvas rather than silently ignore the key.
  const shake = () => {
    const stage = svg.parentElement;
    stage.classList.remove('se-shake');
    void stage.offsetWidth; // restarts the animation when pressed again mid-shake
    stage.classList.add('se-shake');
  };
  document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === 'z' || key === 'y')) {
      if (e.target.matches('input, textarea, select')) return; // a text field keeps its own undo
      e.preventDefault();
      return (key === 'y' || e.shiftKey ? $('se-redo') : $('se-undo')).click(); // Ctrl+Y, or Ctrl/Cmd+Shift+Z
    }
    // Delete, Backspace and Esc act on the selected point wherever the focus is (say, on its Size slider),
    // unless you're typing in a field or a dialog is open. Arrows still need the canvas focused, so elsewhere
    // they keep moving sliders and scrolling the page.
    const typing = e.target.matches('input:not([type=range]):not([type=checkbox]), textarea, select');
    const pointKey = sel >= 0 && mode === 'edit' && ['Delete', 'Backspace', 'Escape'].includes(e.key)
      && !typing && !e.target.closest('.contact-modal-overlay');
    if (!pointKey && !svg.contains(document.activeElement)) return;
    const step = grid.snap ? grid.step : e.shiftKey ? 5 : 0.5;
    const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (mode === 'move') { // arrows move the whole shape
      if (!mv) return;
      checkpoint();
      shapes[active] = transform(shapes[active], 1, 0, 0, mv[0] * step, mv[1] * step);
      sync();
    } else if (sel < 0) return;
    else if (mv) {
      checkpoint();
      pts[sel].x = snap(pts[sel].x + mv[0] * step);
      pts[sel].y = snap(pts[sel].y + mv[1] * step);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (pts.length <= 3) return shake();
      checkpoint();
      pts.splice(sel, 1);
      sel = Math.min(sel, pts.length - 1);
    } else if (e.key === 'Escape') {
      sel = -1;
    } else return;
    e.preventDefault();
    render();
  });

  // Move mode's buttons on the canvas: fit this shape, and mirroring.
  $('se-fit-shape').onclick = () => { checkpoint(); shapes[active] = fitted([shapes[active]])[0]; sync(); render(); };
  $('se-mirror').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mirror]');
    if (!b || b.dataset.mirror === shapes[active].mirror) return;
    checkpoint();
    shapes[active] = { ...shapes[active], mirror: b.dataset.mirror };
    sync(); render();
  });

  // ---------- panel ----------

  const corner = (key, v) => {
    if (!sliding) { checkpoint(); sliding = true; }
    (sel >= 0 ? [pts[sel]] : pts).forEach((p) => (p[key] = v));
    render();
  };
  $('se-size').addEventListener('input', (e) => corner('r', +e.target.value));
  $('se-smooth').addEventListener('input', (e) => corner('s', e.target.value / 100));
  ['se-size', 'se-smooth'].forEach((id) => $(id).addEventListener('change', () => (sliding = false)));

  $('se-apply-all').onclick = () => {
    checkpoint();
    const { r, s } = pts[sel];
    pts.forEach((p) => Object.assign(p, { r, s }));
    render();
  };
  ['x', 'y'].forEach((k) =>
    $('se-' + k).addEventListener('change', (e) => {
      if (sel < 0 || e.target.value === '') return;
      checkpoint();
      pts[sel][k] = clamp(+e.target.value, view.lo, view.hi);
      render();
    })
  );
  $('se-remove').onclick = () => { checkpoint(); pts.splice(sel, 1); sel = -1; render(); };
  $('se-fit').onclick = () => { checkpoint(); shapes = fitted(shapes); sync(); render(); };
  // Undo and redo each move the current state onto the other stack.
  const travel = (from, to) => {
    if (!from.length) return;
    const now = JSON.stringify(snapshot());
    if (restore(JSON.parse(from.pop()))) { to.push(now); render(); }
  };
  $('se-undo').onclick = () => travel(undo, redo);
  $('se-redo').onclick = () => travel(redo, undo);
  $('se-reset').onclick = () => {
    if (confirm('Start over from the default squircle? Undo can still bring this icon back.')) loadIcon(presetShapes('Squircle'));
  };
  $('se-gen').onclick = () => {
    const n = clamp(+$('se-sides').value || 6, 3, 24), inner = clamp(+$('se-inner').value || 100, 10, 100) / 100;
    const num = (id, max) => clamp(+$(id).value || 0, 0, max); // empty or junk input counts as 0
    const made = { pts: fit(polygon(n, inner, +$('se-rot').value || 0, num('se-gen-r', 50), num('se-gen-ir', 50), num('se-gen-s', 100) / 100)), mirror: 'none' };
    replaceShape(placeLike(made, shapes[active])); // takes the selected shape's place and size
  };

  $('se-show-grid').onchange = (e) => { grid.show = e.target.checked; drawGrid(); };
  $('se-snap').onchange = (e) => (grid.snap = e.target.checked);
  $('se-step').onchange = (e) => { grid.step = +e.target.value; drawGrid(); };

  // ---------- dialogs (same markup and styles as the site's contact dialog) ----------

  function dialog(id) {
    const box = $(id);
    document.body.append(box); // out of <main>, so it covers the nav bar like the contact dialog does
    let opener = null;
    const d = {
      open() {
        opener = document.activeElement;
        box.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        box.querySelector('button:not(:disabled):not([hidden]):not([data-close])')?.focus();
      },
      close() {
        box.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        opener?.focus();
      },
    };
    box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('[data-close]')) d.close(); });
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); d.close(); } });
    return d;
  }
  const shareDialog = dialog('se-share'), addDialog = dialog('se-add');
  $('se-share-open').onclick = shareDialog.open;

  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); } catch (e) {
      const t = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
    }
  };
  const shareTexts = { edit: () => links.edit, import: () => links.import, path: () => $('se-out').value };
  $('se-share').querySelectorAll('[data-copy]').forEach((card) => {
    const label = card.querySelector('.se-card-sub'), text = label.textContent;
    card.onclick = async () => {
      await copyText(shareTexts[card.dataset.copy]());
      label.textContent = 'Copied to the clipboard';
      setTimeout(() => (label.textContent = text), 1500);
    };
  });
  if (navigator.share) {
    $('se-share-native').hidden = false;
    $('se-share-native').onclick = () => navigator.share({ title: 'Murine icon shape', url: links.edit }).catch(() => {});
  }

  $('se-use').addEventListener('click', (e) => { if (e.currentTarget.classList.contains('se-disabled')) e.preventDefault(); });

  // ---------- presets ----------

  // A preset in the grid replaces the whole icon; picked from the "+" card it is added as new shapes,
  // at half size in the middle and in Move mode, ready to be placed.
  const tile = (name) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'se-preset';
    b.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><path d="${presetShapes(name).map(shapePath).join(' ')}"/></svg><span>${name}</span>`;
    return b;
  };
  for (const name of [...Object.keys(PRESETS), ...Object.keys(FIXED)]) {
    const b = tile(name);
    b.onclick = () => { loadIcon(presetShapes(name)); svg.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    $('se-presets').append(b);
    const a = tile(name);
    a.onclick = () => {
      checkpoint();
      shapes.push(...presetShapes(name).map((s) => transform(s, 0.5, 50, 50, 50, 50)));
      active = shapes.length - 1; sel = -1; mode = 'move';
      sync(); addDialog.close(); render();
    };
    $('se-add-grid').append(a);
  }

  // ---------- start ----------

  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE)); } catch (e) { /* private mode or garbage */ }
  if (!restore(saved)) { shapes = presetShapes('Squircle'); sync(); }
  // An edit link replaces the current work, which stays one Undo away. Pasting a link into a tab that
  // already has the editor open only changes the hash, hence the hashchange listener.
  async function openEditLink() {
    if (!location.hash.startsWith('#edit=')) return;
    const data = location.hash.slice(6);
    history.replaceState(null, '', location.pathname + location.search); // a reload then keeps later edits
    let link = null;
    // Real states are a few KB packed at most; the cap keeps a crafted link from inflating into megabytes.
    if (data.length < 16000) try { link = JSON.parse(await unpack(data)); } catch (e) { /* malformed link */ }
    const before = JSON.stringify(snapshot());
    if (restore(link)) { undo.push(before); redo.length = 0; }
    render();
  }
  addEventListener('hashchange', openEditLink);
  // Fingers can't hit 5-unit cells (about 13px on a phone-sized canvas), so touch screens start at 10.
  // Pixel density doesn't matter here: sizes are in CSS pixels, which already account for it.
  if (matchMedia('(pointer: coarse)').matches) $('se-step').value = grid.step = 10;
  drawGrid();
  render();
  openEditLink();

  // ponytail: one self-check, runs on every load; the console says if the output format ever regresses
  for (const sample of [buildPath(fit(PRESETS['Cookie 7']())), ...Object.values(FIXED), iconPath().d]) {
    console.assert(/^M [\d. -]+( [LC] [\d. -]+)* Z$/.test(sample) && !/[eE]|--|\.\d+\./.test(sample),
      'shape-editor: path not in launcher-safe format', sample);
  }
})();
