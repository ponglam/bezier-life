/**
 * Bezier Life — colour helpers
 * js/core/color.js
 *
 * Colours are plain [r, g, b] arrays in 0–255 (sRGB).
 * - hsl(h,s,l)      : HSL → rgb array
 * - rgb2hsl / hex   : conversions
 * - mix / css       : blend, and format as a CSS rgba() string (with brightness factor k)
 * - jit(hex, R)     : small seeded shift so each visitor's palette is unique
 * - lumOf(rgb)      : relative luminance 0–1
 */
(function (BL) {
  'use strict';
  const { clamp, lerp } = BL.math;

  /** HSL (h degrees, s and l 0–1) → [r, g, b] 0–255. */
  function hsl(h, s, l) {
    h = (((h % 360) + 360) % 360) / 360;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s,
      p = 2 * l - q;
    const f = (t) => {
      t = (t + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const css = (c, a = 1, k = 1) =>
    `rgba(${clamp(c[0] * k, 0, 255) | 0},${clamp(c[1] * k, 0, 255) | 0},${clamp(c[2] * k, 0, 255) | 0},${a})`;

  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  /** [r, g, b] → [h degrees, s, l]. */
  function rgb2hsl(c) {
    const r = c[0] / 255,
      g = c[1] / 255,
      b = c[2] / 255,
      mx = Math.max(r, g, b),
      mn = Math.min(r, g, b),
      l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l];
    const d = mx - mn,
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [h * 60, s, l];
  }
  /* each visitor gets the palette with a small personal shift, so no two pieces are identical */
  function jit(h, R, dh = 6, dl = 0.03) {
    const [hh, ss, ll] = rgb2hsl(hex(h));
    return hsl(
      hh + R.range(-dh, dh),
      clamp(ss * R.range(0.9, 1.1), 0, 1),
      clamp(ll + R.range(-dl, dl), 0, 1)
    );
  }
  const lumOf = (c) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

  BL.color = { hsl, rgb2hsl, hex, mix, css, jit, lumOf };
})((window.BL = window.BL || {}));
