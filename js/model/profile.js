/**
 * Bezier Life — stroke profile
 * js/model/profile.js
 *
 * Character of the stroke along its journey (functions of u):
 *   hw   half width        cth/sth  cos/sin of the ribbon twist θ
 *   load paint remaining   turn     brush pressure at harsh turns
 * makeProfile() = genome (keyframes per segment joint, from the seed);
 * profileAt()   = expression at TIME phase φ (smoothly varying).
 * dropAt()      = per-bristle dropout: each bristle runs dry for ~7–14% of its
 *                 length on its own schedule and fades back in gradually.
 */
(function (BL) {
  'use strict';
  const { lerp, smooth } = BL.math;
  const { makeRng, vnoise, tn, timeCoord } = BL.random;

  /** Width and twist keyframes at each segment joint (genome). */
  function makeProfile(master, G) {
    const R = makeRng(master + '/profile');
    const kw = [],
      kt = [];
    let th = R.range(-0.5, 0.5);
    for (let i = 0; i <= G.segs.length; i++) {
      kw.push(R.range(0.72, 1.25));
      const sg = G.segs[i - 1];
      if (sg && sg.type === 'A' && sg.n >= 4 && R.chance(0.32))
        th += (R.chance(0.5) ? 1 : -1) * Math.PI; // a fold
      else th += R.range(-0.7, 0.7);
      kt.push(th);
    }
    return {
      baseW: R.range(130, 215),
      kw,
      kt,
      loadExp: R.range(1.6, 3.2),
      loadMin: R.range(0.08, 0.25),
      fray: R.range(0.5, 1),
    };
  }
  /** Profile at φ: half width hw, twist cos/sin, paint load, per sample. */
  function profileAt(sp, P, G, phi) {
    const T = { seed: G.timeSeed ^ 0x5bd1e995, x: timeCoord(phi) },
      n = sp.n;
    const hw = new Float32Array(n),
      cth = new Float32Array(n),
      sth = new Float32Array(n),
      load = new Float32Array(n);
    const w = P.kw.map((v, i) => v * (1 + 0.15 * tn(T, 10, i))),
      t = P.kt.map((v, i) => v + 0.6 * tn(T, 11, i));
    for (let i = 0; i < n; i++) {
      const s = sp.seg[i],
        f = sp.f[i],
        e = f * f * (3 - 2 * f),
        u = sp.u[i];
      const env = (0.75 + 0.25 * smooth(0, 0.03, u)) * (1 - 0.3 * smooth(0.86, 1, u));
      hw[i] = 0.5 * P.baseW * lerp(w[s], w[s + 1], e) * env * sp.kf;
      const th = lerp(t[s], t[s + 1], e);
      cth[i] = Math.cos(th);
      sth[i] = Math.sin(th);
      load[i] = Math.max(P.loadMin, 1 - Math.pow(u, P.loadExp));
    }
    return { hw, cth, sth, load, fray: P.fray };
  }
  /* Turn signal: high on tight arcs and where curvature jumps (segment joints).
   Used as brush pressure: the stroke presses and widens at harsh turns. */
  function blurArr(a, r) {
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
  /** Brush pressure per sample: high on tight arcs and where curvature jumps at joints. */
  function turnSignal(sp) {
    const n = sp.n,
      ds = sp.ds * sp.kf;
    let t = new Float32Array(n);
    for (let i = 0; i < n; i++) t[i] = Math.min(1.4, Math.abs(sp.k[i]) * 85);
    const sig = Math.max(2, Math.round(22 / ds));
    for (let i = 1; i < n; i++)
      if (sp.seg[i] !== sp.seg[i - 1]) {
        const dk = Math.min(1.6, Math.abs(sp.k[i] - sp.k[i - 1]) * 110);
        for (let j = Math.max(0, i - 2 * sig); j < Math.min(n, i + 2 * sig); j++) {
          const d = (j - i) / sig;
          t[j] += dk * Math.exp(-d * d);
        }
      }
    const r = Math.max(1, Math.round(14 / ds));
    return blurArr(blurArr(t, r), r);
  }
  /* Bristle dropout: each bristle/line runs dry on its own for a share of its length, then ink returns gradually */
  const dropTh = (frac) => -0.803 + (frac - 0.05) * 2.21; // noise quantile for that share
  /** Dropout factor 0…1 for bristle j at arc length s (0 = this bristle has no ink here). */
  function dropAt(seed, ch, j, s, period, th) {
    return smooth(th - 0.06, th + 0.16, vnoise(seed, ch, j, s / period));
  }

  /* ---- Bristle layout (v2) -------------------------------------------------------------
   * Where each bristle / line sits across the stroke, in half-widths (−1…1 = the stroke body).
   * - A dense core covers the body (62–90% of the bristles, spacing as in v1).
   * - The rest form "satellites": tight bundles and single strays further out (|v| up to `reach`),
   *   so some strands run close and some far away from the main stroke.
   * - Every bristle also splays in and out along the journey: a shared rhythm, each bristle
   *   with its own timing (lag) and amount.
   * Uses its own stream (master + '/layout/<style>') so v1 parameters of other streams are unchanged.
   */
  function makeLayout(R, count, o = {}) {
    const reach = o.reach || R.range(1.5, 2.4);
    const nCore = Math.round(count * R.range(o.coreMin || 0.62, o.coreMax || 0.9));
    const lanes = [];
    for (let i = 0; i < nCore; i++) lanes.push(-1 + (2 * (i + 0.5)) / nCore + R.range(-0.4, 0.4) / nCore);
    const rest = count - nCore,
      bundles = [];
    const nb = R.int(1, 4);
    for (let b = 0; b < nb; b++)
      bundles.push({
        c: (R.chance(0.5) ? 1 : -1) * R.range(1.12, reach),
        s: R.range(0.015, 0.1),
      });
    for (let i = 0; i < rest; i++) {
      if (R.chance(0.25))
        lanes.push((R.chance(0.5) ? 1 : -1) * R.range(1.05, reach + 0.3)); // single stray
      else {
        const b = bundles[R.int(0, nb - 1)];
        lanes.push(b.c + (R.next() + R.next() - 1) * b.s);
      }
    }
    const spacing = 2 / nCore;
    return {
      nCore,
      spacing,
      period: R.range(260, 620),
      seed: R.int(1, 1e9),
      lanes: lanes.map((v0) => ({
        v0,
        far: Math.abs(v0) > 1.02, // a satellite strand
        splay: Math.abs(v0) > 1.02 ? R.range(0.15, 0.45) : R.range(0.02, 0.12), // far strands wander more
        lag: R.range(-1, 1), // own timing relative to the shared rhythm
        w: R.range(0.8, 1.3), // own thickness
      })),
    };
  }
  /** Offset of bristle j (in half-widths) at arc length s: home position × splay over the journey. */
  function laneV(Lay, j, s) {
    const L = Lay.lanes[j];
    const sh =
      0.7 * vnoise(Lay.seed, 48, 0, s / Lay.period + L.lag * 0.35) +
      0.3 * vnoise(Lay.seed, 49, j, s / (Lay.period * 0.45));
    return L.v0 * (1 + L.splay * sh);
  }
  /** Thickness factor of bristle j at arc length s: shared thick–thin rhythm, own timing. */
  function laneThick(Lay, j, s) {
    const L = Lay.lanes[j];
    const t =
      0.65 * vnoise(Lay.seed, 50, 0, s / (Lay.period * 0.8) + L.lag * 0.4) +
      0.35 * vnoise(Lay.seed, 51, j, s / (Lay.period * 0.35));
    // the core keeps the body solid (0.7…1.4); far strands thin right down and swell (0.35…1.65)
    return L.far ? L.w * (0.35 + 1.3 * (0.5 + 0.5 * t)) : L.w * (0.7 + 0.7 * (0.5 + 0.5 * t));
  }
  /** Largest |offset| any bristle can reach (sizes the 3D ribbon mesh). */
  const layoutReach = (Lay) => Math.max(1, ...Lay.lanes.map((L) => Math.abs(L.v0) * (1 + L.splay)));

  BL.profile = {
    makeProfile,
    profileAt,
    blurArr,
    turnSignal,
    dropTh,
    dropAt,
    makeLayout,
    laneV,
    laneThick,
    layoutReach,
  };
})((window.BL = window.BL || {}));
