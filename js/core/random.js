/**
 * Bezier Life — seeded randomness
 * js/core/random.js
 *
 * DETERMINISM RULE: nothing in the artwork may call Math.random().
 * All randomness comes from named sub-streams of the visitor's master seed:
 *   makeRng(master + '/spine'), makeRng(master + '/palette'), …
 * Each subsystem has its own stream, so changing one part of the code never
 * reshuffles the others (important for keeping past pieces reproducible).
 *
 * - cyrb128 / sfc32 : string hash + small fast PRNG
 * - makeRng(key)    : PRNG with helpers (range, int, chance, weighted)
 * - sha256Hex(str)  : master seed from the visitor's inputs (async, WebCrypto)
 * - vnoise / tn     : smooth seeded value noise, used for anything that must
 *                     change gradually with the TIME phase φ
 */
(function (BL) {
  'use strict';
  const { lerp } = BL.math;

  /** 128-bit string hash (seeds sfc32). */
  function cyrb128(str) {
    let h1 = 1779033703,
      h2 = 3144134277,
      h3 = 1013904242,
      h4 = 2773480762;
    for (let i = 0, k; i < str.length; i++) {
      k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= h2 ^ h3 ^ h4;
    h2 ^= h1;
    h3 ^= h1;
    h4 ^= h1;
    return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
  }
  /** Small Fast Counter PRNG → float in [0, 1). */
  function sfc32(a, b, c, d) {
    return function () {
      a |= 0;
      b |= 0;
      c |= 0;
      d |= 0;
      let t = (((a + b) | 0) + d) | 0;
      d = (d + 1) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    };
  }
  /* Named sub-stream: rng(master + '/spine') etc. Changing one subsystem never reshuffles another. */
  function makeRng(key) {
    const r = sfc32(...cyrb128(key));
    for (let i = 0; i < 15; i++) r();
    return {
      next: r,
      range: (a, b) => a + (b - a) * r(),
      int: (a, b) => a + Math.floor(r() * (b - a + 1)),
      chance: (p) => r() < p,
      weighted: (w) => {
        let t = 0;
        for (const x of w) t += x;
        let q = r() * t;
        for (let i = 0; i < w.length; i++) {
          q -= w[i];
          if (q <= 0) return i;
        }
        return w.length - 1;
      },
    };
  }
  /** SHA-256 of a UTF-8 string as lowercase hex (master seed). */
  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  /* Smooth seeded noise in φ: same seed + same φ = same value; nearby φ = nearby value */
  function hashF(seed, a, b) {
    let h = (seed ^ Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x632be5ab, 0x85ebca77)) | 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    h ^= h >>> 16;
    return ((h >>> 0) / 4294967296) * 2 - 1;
  }
  /** 1D smooth value noise in [-1, 1] for (seed, channel, index) at position x. */
  function vnoise(seed, ch, idx, x) {
    const key = ch * 10007 + idx,
      xo = x + (hashF(seed, key, 999) + 1) * 3.7;
    const i = Math.floor(xo),
      f = xo - i,
      u = f * f * (3 - 2 * f);
    return lerp(hashF(seed, key, i), hashF(seed, key, i + 1), u);
  }
  /** Two-octave noise at the TIME coordinate T.x (T = {seed, x}): how a parameter drifts with φ. */
  function tn(T, ch, idx) {
    return vnoise(T.seed, ch, idx, T.x) * 0.75 + vnoise(T.seed, ch + 50, idx, T.x * 2.3) * 0.25;
  }
  const timeCoord = (phi) => (phi + 10) * 0.17;

  BL.random = {
    cyrb128,
    sfc32,
    makeRng,
    sha256Hex,
    hashF,
    vnoise,
    tn,
    timeCoord,
  };
})((window.BL = window.BL || {}));
