/**
 * Bezier Life — spine grammar + sampler
 * js/model/spine.js
 *
 * The stroke's spine is a chain of two segment types, joined with a continuous tangent:
 *   { type:'S', len }                 straight
 *   { type:'A', n, r, dir, sweep }    arc of n/8 of a circle (n = 1..8), radius r, dir ±1
 *
 * buildSpine(G, φ, ds) turns a genome into dense samples (every ds units):
 *   xs, ys     position          nx, ny   unit normal
 *   k          signed curvature  u        0..1 along the whole journey
 *   f          0..1 inside the current segment, seg = segment index
 * then applies a similarity fit so the spine always enters/leaves on the
 * genome's chosen edges, whatever the TIME phase does to lengths and radii.
 */
(function (BL) {
  'use strict';
  const { clamp } = BL.math;
  const { tn, timeCoord } = BL.random;
  const { edgePoint } = BL.frame;

  /** Arc length of a segment. */
  function segLength(sg) {
    return sg.type === 'S' ? sg.len : sg.r * sg.sweep;
  }
  /* Exact walk: straights by direction, arcs around their true center (no drift).
   cb(x, y, heading, curvature, localArcLength) */
  function walkSeg(sg, p, h, step, cb) {
    const len = segLength(sg),
      n = Math.max(1, Math.ceil(len / step));
    if (sg.type === 'S') {
      const cx = Math.cos(h),
        cy = Math.sin(h);
      for (let i = 1; i <= n; i++) {
        const l = (len * i) / n;
        cb(p.x + cx * l, p.y + cy * l, h, 0, l);
      }
      return { x: p.x + cx * len, y: p.y + cy * len, h };
    }
    const d = sg.dir,
      r = sg.r,
      ccx = p.x - d * r * Math.sin(h),
      ccy = p.y + d * r * Math.cos(h);
    for (let i = 1; i <= n; i++) {
      const a = (sg.sweep * i) / n,
        h2 = h + d * a;
      cb(ccx + d * r * Math.sin(h2), ccy - d * r * Math.cos(h2), h2, d / r, r * a);
    }
    const h2 = h + d * sg.sweep;
    return {
      x: ccx + d * r * Math.sin(h2),
      y: ccy - d * r * Math.cos(h2),
      h: h2,
    };
  }

  /* ---- v2.3: smoothing before the draw -------------------------------------------------
   * 1. easeCurvature: straights and arcs meet with a jump in curvature (0 → 1/r). The curvature is
   *    blurred along the spine and the spine re-integrated from it, so every joint gets a short
   *    easing curve (like a clothoid) and the bend ramps in. Total turn of each segment is kept.
   * 2. softOffset: on the inside of a tight arc a bristle cannot sit further out than the radius.
   *    Instead of a hard clamp (which made a corner where the arc starts), large offsets are
   *    compressed smoothly toward the radius.
   */
  const SMOOTH_JOINT = 45; // units over which curvature eases at each joint
  // Inner offsets stay within this share of the local radius. The tighter a bristle hugs the
  // centre, the faster it must swing sideways when the curvature changes (a sudden bend);
  // 0.7 keeps every bristle path at least ~30% of the spine's radius (v1/v2 used a hard 0.97).
  const INNER_LIMIT = 0.7;
  function boxBlur(a, r) {
    const n = a.length,
      P = new Float64Array(n + 1),
      o = new Float32Array(n);
    for (let i = 0; i < n; i++) P[i + 1] = P[i] + a[i];
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - r),
        hi = Math.min(n - 1, i + r);
      o[i] = (P[hi + 1] - P[lo]) / (hi - lo + 1);
    }
    return o;
  }
  /** Blur curvature along raw samples (3 box passes ≈ Gaussian) and rebuild heading + position. */
  function easeCurvature(raw, smoothLen) {
    const n = raw.length;
    if (n < 4) return;
    let k = new Float32Array(n);
    for (let i = 0; i < n; i++) k[i] = raw[i].k;
    const meanDs = raw[n - 1].s / (n - 1),
      r = Math.max(1, Math.round(smoothLen / meanDs / 3));
    k = boxBlur(boxBlur(boxBlur(k, r), r), r);
    let h = raw[0].h,
      x = raw[0].x,
      y = raw[0].y;
    raw[0].k = k[0];
    for (let i = 1; i < n; i++) {
      const d = raw[i].s - raw[i - 1].s,
        h1 = h + 0.5 * (k[i - 1] + k[i]) * d,
        hm = 0.5 * (h + h1);
      x += Math.cos(hm) * d;
      y += Math.sin(hm) * d;
      h = h1;
      raw[i].x = x;
      raw[i].y = y;
      raw[i].h = h;
      raw[i].k = k[i];
    }
  }
  /** Offset `off` (signed, along the normal) at curvature kk, compressed smoothly on the inner side. */
  function softOffset(kk, off) {
    if (kk === 0) return off;
    const sg = Math.sign(kk),
      lim = INNER_LIMIT / Math.abs(kk),
      x = (off * sg) / lim,
      a = 0.55;
    if (x <= a) return off;
    return sg * lim * (a + (1 - a) * Math.tanh((x - a) / (1 - a)));
  }
  /**
   * 3. smoothOffsets: a bristle sits at offset d[k] from the spine. Where a tight arc squeezes it
   *    inward, d must change quickly, and a bristle that moves sideways fast bends sharply.
   *    The offset track is therefore soft-clamped, blurred along the spine over ~blurLen units
   *    (so it eases in and out of every squeeze) and soft-clamped again. Returns a new array.
   */
  function smoothOffsets(sp, d, blurLen = 60) {
    const n = sp.n,
      ds = sp.len / Math.max(1, n - 1);
    let o = new Float32Array(n);
    for (let k = 0; k < n; k++) o[k] = softOffset(sp.k[k], d[k]);
    const r = Math.max(1, Math.round(blurLen / ds / 3));
    o = boxBlur(boxBlur(boxBlur(o, r), r), r);
    for (let k = 0; k < n; k++) o[k] = softOffset(sp.k[k], o[k]);
    return o;
  }
  /** Point at offset d from spine sample k, no clamping (d already prepared). */
  const pointAt = (sp, k, d) => [sp.xs[k] + sp.nx[k] * d, sp.ys[k] + sp.ny[k] * d];
  /** Point at signed offset `off` from spine sample k (inner side compressed smoothly). */
  function offsetAt(sp, k, off) {
    off = softOffset(sp.k[k], off);
    return [sp.xs[k] + sp.nx[k] * off, sp.ys[k] + sp.ny[k] * off];
  }

  /** Genome + TIME phase φ → dense spine samples (spacing ds), fitted to the entry/exit edges. */
  function buildSpine(G, phi, ds) {
    const T = { seed: G.timeSeed, x: timeCoord(phi) };
    const segs = G.segs.map((g) =>
      g.type === 'S'
        ? { type: 'S', len: g.len * (1 + 0.28 * tn(T, 1, g.i)), i: g.i }
        : {
            type: 'A',
            n: g.n,
            dir: g.dir,
            r: g.r * (1 + 0.3 * tn(T, 2, g.i)),
            sweep: Math.max(Math.PI / 8, ((g.n + 0.45 * tn(T, 3, g.i)) * Math.PI) / 4),
            i: g.i,
          }
    );
    const h0 = G.h0 + 0.12 * tn(T, 4, 0);
    const eT = clamp(G.entryT + 0.07 * tn(T, 5, 0), 0.08, 0.92),
      xT = clamp(G.exitT + 0.07 * tn(T, 6, 0), 0.08, 0.92);
    let p = edgePoint(G.entrySide, G.entryT),
      h = h0,
      s = 0;
    const raw = [{ x: p.x, y: p.y, h, k: 0, seg: 0, f: 0, s: 0 }];
    for (const sg of segs) {
      const s0 = s,
        L = segLength(sg);
      p = walkSeg(sg, p, h, ds, (x, y, hh, kk, ls) =>
        raw.push({ x, y, h: hh, k: kk, seg: sg.i, f: ls / L, s: s0 + ls })
      );
      h = p.h;
      s += L;
    }
    easeCurvature(raw, SMOOTH_JOINT); // v2.3: no curvature jumps at joints
    const A = edgePoint(G.entrySide, eT),
      B = edgePoint(G.exitSide, xT);
    const S0 = raw[0],
      Pe = raw[raw.length - 1];
    const vx = Pe.x - S0.x,
      vy = Pe.y - S0.y,
      wx = B.x - A.x,
      wy = B.y - A.y;
    const kf = Math.hypot(wx, wy) / (Math.hypot(vx, vy) || 1);
    let rot = Math.atan2(wy, wx) - Math.atan2(vy, vx);
    rot = Math.atan2(Math.sin(rot), Math.cos(rot));
    const cr = Math.cos(rot),
      sr = Math.sin(rot),
      n = raw.length;
    const sp = {
      n,
      xs: new Float32Array(n),
      ys: new Float32Array(n),
      nx: new Float32Array(n),
      ny: new Float32Array(n),
      k: new Float32Array(n),
      u: new Float32Array(n),
      f: new Float32Array(n),
      seg: new Int16Array(n),
      len: s * kf,
      kf,
      rot,
      segs,
      ds,
    };
    for (let i = 0; i < n; i++) {
      const q = raw[i],
        dx = (q.x - S0.x) * kf,
        dy = (q.y - S0.y) * kf,
        hh = q.h + rot;
      sp.xs[i] = A.x + dx * cr - dy * sr;
      sp.ys[i] = A.y + dx * sr + dy * cr;
      sp.nx[i] = -Math.sin(hh);
      sp.ny[i] = Math.cos(hh);
      sp.k[i] = q.k / kf;
      sp.u[i] = q.s / s;
      sp.f[i] = q.f;
      sp.seg[i] = q.seg;
    }
    return sp;
  }
  /* The genome must hold up across the whole time range, not just at φ = 0 */

  BL.spine = {
    segLength,
    walkSeg,
    buildSpine,
    softOffset,
    offsetAt,
    smoothOffsets,
    pointAt,
    SMOOTH_JOINT,
    INNER_LIMIT,
  };
})((window.BL = window.BL || {}));
