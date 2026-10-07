/**
 * Bezier Life — style genomes
 * js/model/styles.js
 *
 * Seed-decided parameters for each brush style, coloured by the five-element palette (FP):
 *   makePalette(master, FP) → Painterly: bristle lanes (colour, paint capacity)
 *   makeGraphic(master, FP) → Graphic: 9–24 clean lines; graphicAt() = widths/fades per sample
 *   makeInk(master, FP)     → Ink: bristles, dry gaps, splash events; inkAt() = ink level + width
 *   makeDepth / depthAt     → 3D depth of the spine (z) and ribbon cup
 *   makeLight               → light direction and colours for the 3D renderer
 */
(function (BL) {
  'use strict';
  const { clamp, smooth } = BL.math;
  const { makeRng, cyrb128, vnoise, tn, timeCoord } = BL.random;
  const { hsl, mix, jit, lumOf } = BL.color;
  const {
    dropTh,
    dropAt,
    makeLayout,
    laneV,
    laneThick,
    blurArr,
    makeTremor,
    tremorAt,
    makeRebels,
    rebelIndex,
    rebelPath,
  } = BL.profile;
  const { smoothOffsets, pointAt } = BL.spine;
  const F = BL.frame;

  /* Painterly palette */
  const LANES = 110;
  /** Painterly genome: colours from the element palette FP + 110 bristle lanes. */
  function makePalette(master, FP) {
    const R = makeRng(master + '/palette');
    const pal = {
      bg: jit(FP.bg, R, 5, 0.03),
      glow: jit(FP.glow, R, 8, 0.03),
      glowPos: { x: R.range(0, 1) * F.W, y: R.range(0, 1) * F.H },
      glowAmt: R.range(0.15, 0.45),
      light: jit(FP.light, R, 6, 0.02),
      mid: jit(FP.mid, R, 6, 0.04),
      dark: jit(FP.dark, R, 6, 0.03),
      accent: R.chance(0.55) ? jit(FP.accent, R, 6, 0.03) : null,
      lightEdge: R.chance(0.5) ? 1 : -1,
      drySeed: cyrb128(master + '/bristles')[0] | 0,
      dropFrac: R.range(0.07, 0.14),
      lanes: [],
    };
    pal.layout = makeLayout(makeRng(master + '/layout/painterly'), LANES, {
      reach: 1.9,
    });
    pal.tremor = makeTremor(makeRng(master + '/tremor/painterly'));
    pal.rebels = makeRebels(makeRng(master + '/rebels/painterly'), LANES); // v3.2
    for (let j = 0; j < LANES; j++) {
      const v = clamp(pal.layout.lanes[j].v0, -1, 1);
      const t = clamp((v * pal.lightEdge + 1) / 2 + R.range(-0.18, 0.18), 0, 1);
      let c = t < 0.5 ? mix(pal.dark, pal.mid, t * 2) : mix(pal.mid, pal.light, (t - 0.5) * 2);
      const b = R.range(0.8, 1.15);
      c = c.map((x) => x * b);
      if (pal.accent && v * pal.lightEdge < -0.55 && R.chance(0.6))
        c = mix(c, pal.accent, R.range(0.4, 0.85));
      pal.lanes.push({
        c,
        cap: R.range(0.55, 1.15) * (pal.layout.lanes[j].far ? 0.8 : 1),
        fray: R.next(),
      });
    }
    return pal;
  }

  /* Graphic style: clean parallel lines, each thick–thin–fade–solid, peers alike but not identical */
  function makeGraphic(master, FP) {
    const R = makeRng(master + '/graphic');
    let bg, line, accent;
    if (R.weighted([5, 2]) === 0) {
      bg = jit(FP.bg, R, 4, 0.02);
      line = lumOf(bg) < 0.45 ? jit(FP.light, R, 4, 0.02) : jit(FP.dark, R, 4, 0.02);
    } else {
      bg = jit(FP.paper, R, 4, 0.015);
      line = jit(FP.ink, R, 4, 0.02);
    }
    accent = jit(FP.accent, R, 6, 0.03);
    const nL = R.int(9, 24),
      lines = [];
    for (let i = 0; i < nL; i++)
      lines.push({
        i,
        v: -1 + (2 * (i + 0.5)) / nL + R.range(-0.25, 0.25) / nL,
        w0: R.range(0.75, 1.25),
        phase: R.range(-0.035, 0.035),
        u0: R.range(0, 0.03),
        u1: 1 - R.range(0, 0.05),
        col: R.chance(0.13) ? accent : line,
        dropP: R.range(140, 420),
      });
    // v2: positions from the layout (close bundle + far strands), more timing spread per line
    const layout = makeLayout(makeRng(master + '/layout/graphic'), nL, {
      coreMin: 0.5,
      coreMax: 0.85,
      reach: 2.2,
    });
    const LR = makeRng(master + '/layout/graphic-timing');
    lines.forEach((L, i) => {
      L.v = layout.lanes[i].v0;
      L.phase += LR.range(-0.03, 0.03);
    });
    return {
      bg,
      line,
      accent,
      lines,
      layout,
      tremor: makeTremor(makeRng(master + '/tremor/graphic')),
      rebels: makeRebels(makeRng(master + '/rebels/graphic'), nL), // v3.2
      gw: R.range(1.4, 3.4),
      spread: R.range(0.8, 1.25),
      wFreq: R.range(4, 9),
      fFreq: R.range(3, 6),
      fTh: R.range(0.3, 0.55),
      dropTh: dropTh(R.range(0.07, 0.14)),
      seed: cyrb128(master + '/graphic-noise')[0] | 0,
    };
  }
  /** Per-line width w and fade f for every sample (shared rhythm + own variation + dropout). */
  function graphicAt(S) {
    const { sp, turn, GG } = S,
      n = sp.n;
    return GG.lines.map((L) => {
      const w = new Float32Array(n),
        f = new Float32Array(n),
        v = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        const u = sp.u[k],
          uu = u + L.phase;
        const thick = clamp(
          0.5 + 0.5 * vnoise(GG.seed, 30, 0, uu * GG.wFreq) + 0.22 * vnoise(GG.seed, 31, L.i, u * 9),
          0.02,
          1
        );
        const env = smooth(L.u0, L.u0 + 0.015, u) * (1 - smooth(L.u1 - 0.025, L.u1, u));
        const dr = dropAt(GG.seed, 34, L.i, u * sp.len, L.dropP, GG.dropTh);
        w[k] =
          GG.gw * L.w0 * (0.25 + 2.4 * Math.pow(thick, 1.6)) * (1 + 0.5 * turn[k]) * env * (0.02 + 0.98 * dr);
        const F = 0.5 + 0.5 * vnoise(GG.seed, 32, 0, uu * GG.fFreq) + 0.12 * vnoise(GG.seed, 33, L.i, u * 7);
        f[k] = smooth(GG.fTh - 0.12, GG.fTh + 0.12, F) * dr;
        v[k] = laneV(GG.layout, L.i, u * sp.len);
      }
      // v2.3: line centre offsets, eased into and out of tight arcs (no sudden bends)
      const ctr = new Float32Array(n),
        raw = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        ctr[k] = v[k] * S.pr.hw[k] * GG.spread; // offset along the ribbon width (3D)
        raw[k] = ctr[k] * S.pr.cth[k]; // its in-plane part (what 2D sees)
      }
      const ip = smoothOffsets(sp, raw),
        tx = timeCoord(S.phi);
      for (let k = 0; k < n; k++) ip[k] += tremorAt(GG.tremor, L.i, sp.u[k] * sp.len, tx); // v2.4 hand tremor
      // v3.2: the line's 2D path (and normals); a rebel line leaves the stroke at its own point
      const cx = new Float32Array(n),
        cy = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        cx[k] = sp.xs[k] + sp.nx[k] * ip[k];
        cy[k] = sp.ys[k] + sp.ny[k] * ip[k];
      }
      let rebelFrom = n;
      const rb = GG.rebels.byLane[L.i];
      if (rb) {
        const kr = rebelIndex(sp, rb);
        if (kr > 2 && kr < n - 3) {
          const h0 = Math.atan2(cy[kr + 1] - cy[kr - 1], cx[kr + 1] - cx[kr - 1]),
            ds = sp.len / (n - 1);
          const own = rebelPath(
            rb,
            cx[kr],
            cy[kr],
            h0,
            ds,
            (i) => sp.k[Math.min(n - 1, kr + i)],
            Math.sign(v[kr]) || rb.side
          );
          const w0 = Math.max(w[kr], GG.gw * L.w0),
            f0 = Math.max(f[kr], 0.6);
          for (let k = kr; k < n; k++) {
            const i = k - kr;
            if (i < own.n) {
              cx[k] = own.x[i];
              cy[k] = own.y[i];
              w[k] = w0 * own.taper(i);
              f[k] = f0;
            } else {
              w[k] = 0; // finished: rest at its end point
              cx[k] = own.x[own.n - 1];
              cy[k] = own.y[own.n - 1];
            }
          }
          rebelFrom = kr;
        }
      }
      const pnx = new Float32Array(n),
        pny = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        const a = Math.max(0, k - 1),
          b = Math.min(n - 1, k + 1),
          tx2 = cx[b] - cx[a],
          ty2 = cy[b] - cy[a],
          l = Math.hypot(tx2, ty2) || 1;
        pnx[k] = -ty2 / l;
        pny[k] = tx2 / l;
      }
      return { w, f, v, ctr, ip, cx, cy, pnx, pny, rebelFrom };
    });
  }

  /* Ink style: one ink, tone on tone; flying white and dry gaps; pressure at harsh turns */
  const LANES_INK = 150;
  /** Ink genome: ink/paper from FP, dry gaps (brush lifts), 150 bristles, splash events. */
  function makeInk(master, FP) {
    const R = makeRng(master + '/ink');
    const base = {
      ink: jit(FP.ink, R, 4, 0.02),
      paper: jit(FP.paper, R, 3, 0.012),
    };
    const gaps = [],
      ng = R.weighted([1, 2, 2, 1]);
    for (let i = 0; i < ng; i++) gaps.push({ c: R.range(0.15, 0.9), w: R.range(0.015, 0.06) });
    gaps.sort((a, b) => a.c - b.c);
    const lanes = [];
    for (let j = 0; j < LANES_INK; j++) {
      const v = -1 + (2 * (j + 0.5)) / LANES_INK;
      lanes.push({
        tone: R.range(0.5, 0.95) + (Math.abs(v) > 0.82 ? 0.15 : 0),
        cap: R.range(0.5, 1.2),
        dropP: R.range(120, 380),
      });
    }
    const events = [],
      ne = R.weighted([1, 2, 2, 1.2, 0.6]);
    for (let i = 0; i < ne; i++)
      events.push({
        type: R.chance(0.55) ? 'fling' : 'spray',
        u: R.range(0.12, 0.92),
        w: R.range(0.015, 0.045),
        count: R.int(30, 120),
        reach: R.range(0.8, 2.6),
        side: R.chance(0.5) ? 1 : -1,
        key: master + '/splash/' + i,
      });
    return {
      ...base,
      gaps,
      lanes,
      baseHW: R.range(26, 48),
      press: R.range(0.5, 0.9),
      span: R.range(0.35, 0.7),
      minLoad: R.range(0.12, 0.25),
      straightDry: R.range(0.7, 0.88),
      drySeed: cyrb128(master + '/ink-dry')[0] | 0,
      paperSeed: master + '/paper',
      side: R.chance(0.5) ? 1 : -1,
      events,
      dropTh: dropTh(R.range(0.07, 0.14)),
      layout: makeLayout(makeRng(master + '/layout/ink'), LANES_INK, {
        coreMin: 0.7,
        coreMax: 0.92,
        reach: 2.0,
      }),
      tremor: makeTremor(makeRng(master + '/tremor/ink')),
      rebels: makeRebels(makeRng(master + '/rebels/ink'), LANES_INK), // v3.2
    };
  }
  /** Ink level and stroke width per sample (gaps, re-dip after lifts, pressure at turns, spray). */
  // v2.3: smooth versions of abs/min, so widths (and the bristles riding on them) never get a corner
  const softAbs = (x) => (Math.sqrt(x * x + 0.0144) - 0.12) / (Math.sqrt(1.0144) - 0.12); // ≈|x| on −1…1, round at 0
  const softplus = (z) => (z > 20 ? z : Math.log1p(Math.exp(z)));
  const softMin = (x, m) => x - softplus(8 * (x - m)) / 8; // ≈min(x, m), round at the knee
  function inkAt(S) {
    const { sp, pr, turn, IG } = S,
      n = sp.n,
      T = { seed: S.G.timeSeed ^ 0x27d4eb2d, x: timeCoord(S.phi) };
    const gaps = IG.gaps.map((g, i) => ({
      c: g.c + 0.02 * tn(T, 40, i),
      w: g.w,
    }));
    const level = new Float32Array(n),
      width = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const u = sp.u[k];
      let g = 1,
        last = 0;
      for (const gp of gaps) {
        g *= smooth(gp.w * 0.5, gp.w * 0.5 + 0.03, Math.abs(u - gp.c));
        if (u > gp.c + gp.w * 0.5) last = Math.max(last, gp.c + gp.w * 0.5);
      }
      for (const ev of IG.events)
        if (ev.type === 'spray') g *= smooth(ev.w * 0.35, ev.w * 0.5 + 0.008, Math.abs(u - ev.u));
      const load = Math.max(IG.minLoad, 1 - Math.pow(Math.max(0, u - last) / IG.span, 1.5)); // re-dipped after each lift
      level[k] = load * g * (sp.k[k] === 0 ? IG.straightDry : 1) * (1 + 0.35 * turn[k]);
      const head = 1 + 0.25 * (1 - smooth(0, 0.04, u)),
        tail = 1 - 0.55 * smooth(0.9, 1, u);
      width[k] =
        IG.baseHW *
        (pr.hw[k] / (0.5 * S.P.baseW)) *
        (1 + IG.press * softMin(turn[k], 1.2)) *
        (0.45 + 0.55 * softAbs(pr.cth[k])) *
        head *
        tail;
    }
    return { level, width, lanes: inkLanes(S, level, width) };
  }

  /**
   * Per-bristle ink (v2). For every bristle and sample:
   *   v  offset across the stroke (layout + splay)
   *   a  ink 0…12 (quantized): stroke level read with the bristle's own time lag, so bristles
   *      fade out / dry / return at different points instead of all at once; plus dryness and dropout
   *   t  thickness 0…16 (quantized, /8): shared thick–thin rhythm with own timing
   *   x, y  the bristle's path, smoothed (v2.3)
   */
  function inkLanes(S, level, width) {
    const { sp, IG } = S,
      n = sp.n,
      Lay = IG.layout,
      ds = sp.len / Math.max(1, n - 1);
    const out = [];
    for (let j = 0; j < LANES_INK; j++) {
      const L = IG.lanes[j],
        LL = Lay.lanes[j];
      const lagK = Math.round((LL.lag * 70) / ds); // ±70 units of own timing
      const v = new Float32Array(n),
        a = new Uint8Array(n),
        t = new Uint8Array(n);
      let x = new Float32Array(n),
        y = new Float32Array(n);
      for (let k = 0; k < n; k++) {
        const s = sp.u[k] * sp.len,
          u = sp.u[k];
        const lev = level[Math.min(n - 1, Math.max(0, k + lagK))] * (LL.far ? 0.75 : 1);
        const dn = vnoise(IG.drySeed, 40, j, u * 55) * 0.5 + 0.5;
        const dr = dropAt(IG.drySeed, 46, j, s, L.dropP, IG.dropTh);
        const tone = 0.88 + 0.12 * vnoise(IG.drySeed, 41, 0, u * 8);
        const al = clamp((lev * L.cap * dr - dn * 0.7) * 4 + 0.25, 0, 1) * L.tone * tone * dr;
        a[k] = Math.round(Math.min(1, al) * 12);
        v[k] = laneV(Lay, j, s);
        t[k] = Math.min(16, Math.round(laneThick(Lay, j, s) * 8));
        x[k] = v[k] * width[k]; // offset; turned into a position below
      }
      // v2.3: ease the offset into and out of tight arcs, then place the bristle
      const d = smoothOffsets(sp, x),
        tx = timeCoord(S.phi),
        tk = LL.far ? 1.6 : 1; // far strands shake a little more
      for (let k = 0; k < n; k++) d[k] += tk * tremorAt(IG.tremor, j, sp.u[k] * sp.len, tx); // v2.4 hand tremor
      for (let k = 0; k < n; k++) {
        const q = pointAt(sp, k, d[k]);
        x[k] = q[0];
        y[k] = q[1];
      }
      // v3.2: a rebel bristle leaves the stroke at its own point and runs its own path
      const rebel = IG.rebels.byLane[j];
      if (rebel) {
        const kr = rebelIndex(sp, rebel);
        if (kr > 2 && kr < n - 3) {
          const h0 = Math.atan2(y[kr + 1] - y[kr - 1], x[kr + 1] - x[kr - 1]);
          const own = rebelPath(
            rebel,
            x[kr],
            y[kr],
            h0,
            ds,
            (i) => sp.k[Math.min(n - 1, kr + i)],
            Math.sign(v[kr]) || rebel.side
          );
          const a0 = Math.max(a[kr], 7); // the ink it carries away
          for (let k = kr; k < n; k++) {
            const i = k - kr;
            if (i < own.n) {
              x[k] = own.x[i];
              y[k] = own.y[i];
              const dn = vnoise(IG.drySeed, 44, j, i * ds * 0.02) * 0.5 + 0.5;
              a[k] = Math.round(a0 * own.taper(i) * (0.7 + 0.3 * dn));
              t[k] = Math.min(16, Math.round(t[k] * 1.4)); // a rebel reads a little bolder
            } else {
              a[k] = 0; // finished: rest at its end point
              x[k] = own.x[own.n - 1];
              y[k] = own.y[own.n - 1];
            }
          }
        }
      }
      // v2.3: light smoothing of the bristle path itself (≈3 units), a last guard against corners
      const rb = Math.max(1, Math.round(1.5 / ds));
      x = blurArr(blurArr(x, rb), rb);
      y = blurArr(blurArr(y, rb), rb);
      out.push({ v, a, t, x, y });
    }
    return out;
  }

  /** 3D depth amplitude/period of the spine and the ribbon cup. */
  function makeDepth(master) {
    const R = makeRng(master + '/depth');
    return {
      amp: R.range(50, 170),
      period: R.range(260, 520),
      cup: R.range(0.05, 0.18),
      seed: cyrb128(master + '/depth-noise')[0] | 0,
    };
  }
  /** 3D light rig parameters (direction, intensities, warm key colour). */
  function makeLight(master) {
    const R = makeRng(master + '/light');
    return {
      a: R.chance(0.5) ? R.range(1.9, 2.6) : R.range(0.55, 1.25),
      kz: R.range(0.9, 1.5),
      keyI: R.range(1.5, 2.1),
      rimI: R.range(0.6, 1.2),
      warm: hsl(R.range(25, 45), R.range(0.2, 0.45), R.range(0.82, 0.92)),
    };
  }
  /** z per sample (depth toward/away from the viewer), drifting with φ. */
  function depthAt(S) {
    const { sp } = S,
      D = S.depth,
      n = sp.n,
      z = new Float32Array(n),
      T = timeCoord(S.phi);
    for (let k = 0; k < n; k++) {
      const s = sp.u[k] * sp.len;
      z[k] =
        D.amp *
        (0.8 * vnoise(D.seed, 60, 0, s / D.period + T * 0.6) +
          0.2 * vnoise(D.seed, 61, 0, s / (D.period * 0.37)));
    }
    return z;
  }

  BL.styles = {
    LANES,
    LANES_INK,
    makePalette,
    makeGraphic,
    graphicAt,
    makeInk,
    inkAt,
    makeDepth,
    makeLight,
    depthAt,
  };
})((window.BL = window.BL || {}));
