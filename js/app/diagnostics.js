/**
 * Bezier Life — diagnostics
 * js/app/diagnostics.js
 *
 * kinkReport(S): finds sudden bends. For every drawn path (the spine, and the Ink bristles
 * when the piece is computed in Ink), it compares the direction of the path over the
 * `span` units before and after each point. A smooth curve of radius R turns by about
 * span / R; a corner turns a lot over a tiny span. Turns above `maxDeg` are counted.
 *   BL.diagnostics.kinkReport(BL.app.ui.piece)            // in the browser console
 *   → { spine: {max, count}, bristles: {max, count, paths} }
 */
(function (BL) {
  'use strict';

  /** Max turn (degrees) and number of points turning more than maxDeg, for one polyline. */
  function pathKinks(xs, ys, n, span, maxDeg) {
    // step = number of samples covering `span` units
    let len = 0;
    for (let i = 1; i < n; i++) len += Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
    const step = Math.max(1, Math.round((span * (n - 1)) / Math.max(len, 1e-6)));
    let max = 0,
      count = 0;
    for (let i = step; i < n - step; i++) {
      const ax = xs[i] - xs[i - step],
        ay = ys[i] - ys[i - step],
        bx = xs[i + step] - xs[i],
        by = ys[i + step] - ys[i];
      const la = Math.hypot(ax, ay),
        lb = Math.hypot(bx, by);
      if (la < 1e-6 || lb < 1e-6) continue; // collapsed (no visible direction)
      const deg = (Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / (la * lb)))) * 180) / Math.PI;
      if (deg > max) max = deg;
      if (deg > maxDeg) count++;
    }
    return { max, count };
  }

  /** Sudden-bend report for a computed piece. span in frame units, maxDeg threshold. */
  function kinkReport(S, span = 3, maxDeg = 30) {
    const spine = pathKinks(S.sp.xs, S.sp.ys, S.sp.n, span, maxDeg);
    const bristles = { max: 0, count: 0, paths: 0 };
    if (S.ink && S.ink.lanes && S.ink.lanes[0].x) {
      for (const L of S.ink.lanes) {
        const r = pathKinks(L.x, L.y, S.sp.n, span, maxDeg);
        bristles.max = Math.max(bristles.max, r.max);
        bristles.count += r.count;
        if (r.count) bristles.paths++;
      }
    }
    return { spine, bristles };
  }

  BL.diagnostics = { kinkReport, pathKinks };
})((window.BL = window.BL || {}));
