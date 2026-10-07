/**
 * Bezier Life — math helpers
 * js/core/math.js
 *
 * Small numeric helpers shared by every module.
 */
(function (BL) {
  'use strict';

  /** Clamp x into [a, b]. */
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  /** Linear interpolation. */
  const lerp = (a, b, t) => a + (b - a) * t;
  /** Hermite smoothstep between edges a and b. */
  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  /** Promise that resolves after ms milliseconds (used to yield to the browser). */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  BL.math = { clamp, lerp, smooth, sleep };
})((window.BL = window.BL || {}));
