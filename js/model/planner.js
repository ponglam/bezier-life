/**
 * Bezier Life — journey planner (genome)
 * js/model/planner.js
 *
 * Plans the visitor's "Stroke Journey" once per seed + format:
 *   entry side/point, exit side/point, and the sequence of S / A segments.
 *
 * Phases along the length budget: approach → knot (dense loops) → departure.
 * Each step generates 10 candidate segments, scores them (stay in frame,
 * gather near the knot centre, then home in on the exit) and samples one.
 *
 * planGenome() also checks the genome at φ = −10, −5, 0, 5, 10 so the piece
 * works across the whole TIME range; failed attempts re-plan on a new
 * deterministic sub-stream (attempt number is part of the stream key).
 */
(function (BL) {
  'use strict';
  const { clamp, smooth } = BL.math;
  const { makeRng, cyrb128 } = BL.random;
  const F = BL.frame;
  const { edgePoint, INWARD } = BL.frame;
  const { segLength, walkSeg, buildSpine } = BL.spine;

  /** One random candidate segment for the current phase of the journey (frac = s / budget). */
  /**
   * One random candidate segment for the current phase (frac = s / budget), drawn from the
   * spine family A (v3.1). lastDir = turn direction of the previous arc (0 = none yet):
   * A.alt decides whether the next arc turns the other way (S-curves) or the same way (coils).
   */
  function randomSeg(R, frac, A, lastDir = 0) {
    A = A || BL.archetypes.FAMILIES.knot;
    const ph = frac < 0.2 ? 0 : frac < 0.78 ? 1 : 2; // approach / middle / departure
    const mid = ph === 1 ? 1 : 0;
    if (R.chance(A.pS[ph])) return { type: 'S', len: R.range(A.sLen[mid][0], A.sLen[mid][1]) };
    const n = 1 + R.weighted(A.nW[ph]);
    const r = R.range(A.r[mid][0], A.r[mid][1]);
    let dir;
    if (lastDir === 0) dir = R.chance(0.5) ? 1 : -1;
    else dir = R.chance(A.alt) ? -lastDir : lastDir;
    return { type: 'A', n, r, dir, sweep: (n * Math.PI) / 4 };
  }
  /** Plan one journey genome for a given attempt number (deterministic per master + attempt). */
  function planOnce(master, attempt) {
    const R = makeRng(master + '/spine/' + attempt);
    const entrySide = R.int(0, 3);
    const exitSide = R.weighted(
      [0, 1, 2, 3].map((s) => (s === entrySide ? 0.8 : s === (entrySide + 2) % 4 ? 2.6 : 2))
    );
    const entryT = R.range(0.2, 0.8);
    let exitT = R.range(0.2, 0.8);
    if (exitSide === entrySide && Math.abs(exitT - entryT) < 0.35)
      exitT = entryT < 0.5 ? Math.min(0.85, entryT + 0.45) : Math.max(0.15, entryT - 0.45);
    const knot = { x: F.W * R.range(0.38, 0.62), y: F.H * R.range(0.4, 0.6) };
    const L = R.range(3.0, 4.6) * 1.118 * Math.sqrt(F.W * F.H);
    const start = edgePoint(entrySide, entryT),
      E = edgePoint(exitSide, exitT);
    const h0 = INWARD[entrySide] + R.range(-0.45, 0.45);
    let p = { x: start.x, y: start.y },
      h = h0,
      s = 0,
      last = null;
    const segs = [];
    const m = 110;
    while (segs.length < 70 && s < 1.8 * L) {
      const frac = s / L,
        dE = Math.hypot(E.x - p.x, E.y - p.y);
      if (frac > 0.82 && dE < 180) break;
      const homing = smooth(0.68, 1, frac),
        knotW = smooth(0.12, 0.3, frac) * (1 - smooth(0.7, 0.85, frac));
      const cands = [],
        scores = [];
      for (let k = 0; k < 10; k++) {
        const c = randomSeg(R, frac);
        let sc = 0;
        const end = walkSeg(c, p, h, 18, (x, y, hh, kk, ls) => {
          if (s + ls < 160) return;
          const ox = Math.max(m - x, 0, x - (F.W - m)),
            oy = Math.max(m - y, 0, y - (F.H - m));
          sc -= (ox + oy) * 0.012 * (1 - homing * 0.9);
        });
        const len = segLength(c);
        sc -= (knotW * Math.hypot(end.x - knot.x, end.y - knot.y)) / 190;
        const dE2 = Math.hypot(E.x - end.x, E.y - end.y),
          angTo = Math.atan2(E.y - end.y, E.x - end.x);
        sc += homing * (((dE - dE2) / Math.max(len, 1)) * 1.6 + Math.cos(angTo - end.h) * 1.2);
        if (last && last.type === c.type && (c.type === 'S' || last.n === c.n)) sc -= 0.45;
        cands.push({ c, end });
        scores.push(sc);
      }
      const mx = Math.max(...scores);
      const pick = cands[R.weighted(scores.map((v) => Math.exp((v - mx) / 0.28)))];
      pick.c.i = segs.length;
      segs.push(pick.c);
      last = pick.c;
      s += segLength(pick.c);
      p = { x: pick.end.x, y: pick.end.y };
      h = pick.end.h;
    }
    const proj = (E.x - p.x) * Math.cos(h) + (E.y - p.y) * Math.sin(h);
    segs.push({ type: 'S', len: clamp(proj, 60, 700), i: segs.length });
    return {
      entrySide,
      exitSide,
      entryT,
      exitT,
      h0,
      segs,
      knot,
      timeSeed: cyrb128(master + '/time')[0] | 0,
    };
  }
  /* Spine at time φ: genome + smooth φ-expression, then a similarity fit
   that pins the start/end to the entry/exit edges. */
  /* ---- v3.0 "Life" journeys -------------------------------------------------------------
   * One shared beginning, futures that drift apart through TIME.
   * - The opening of the journey (the "prologue", 3–6% of a typical length: just the start) is planned once
   *   and is identical at every φ.
   * - The future at φ = 0 is planned from there (knot, exit) like a v1 journey.
   * - Futures for later and earlier years are a CHAIN of small mutations: each anchor year
   *   (every 1.25 years out to ±10) changes 3–4 segments of its neighbour's future (a turn a
   *   bit wider or tighter, a loop one eighth longer or shorter, a straight longer or shorter). Neighbouring
   *   years stay close, so the morph is gradual; changes accumulate, so −10 and +10 end
   *   up as different lives, leaving the frame at different places.
   * spine.buildLifeSpine() blends the anchor futures along the TIME slider.
   */
  const LIFE_STEP = 1.25; // anchor years every 1.25 years: 17 futures from −10 to +10
  const LIFE_ANCHORS = Array.from({ length: 17 }, (_, i) => -10 + i * LIFE_STEP);
  /** Share of a future's middle that strays outside the frame margin (walks the segments). */
  function futureOut(G, segs) {
    let p = { x: G.start.x, y: G.start.y },
      h = G.h0,
      s = 0,
      out = 0,
      cnt = 0;
    const L = segs.reduce((a, g) => a + segLength(g), 0);
    for (const g of segs) {
      const s0 = s;
      p = walkSeg(g, p, h, 12, (x, y, hh, kk, ls) => {
        const sa = s0 + ls;
        if (sa < 220 || sa > L - 220) return;
        cnt++;
        if (x < 75 || x > F.W - 75 || y < 75 || y > F.H - 75) out++;
      });
      h = p.h;
      s += segLength(g);
    }
    return out / Math.max(cnt, 1);
  }
  /** One mutation step of a future: 2–4 segments after the prologue change a little. */
  function mutate(segs, from, R, nMut = 0.4) {
    const out = segs.map((g) => ({ ...g }));
    const nAfter = out.length - from;
    if (nAfter <= 0) return out;
    const m = R.int(3, 4);
    for (let q = 0; q < m; q++) {
      const i = from + Math.min(nAfter - 1, Math.floor(R.next() * nAfter)); // anywhere after the beginning
      const g = out[i];
      if (g.type === 'S') g.len = Math.max(30, g.len * R.range(0.65, 1.45));
      else {
        if (R.chance(nMut)) g.n = clamp(g.n + (R.chance(0.5) ? 1 : -1), 1, 8);
        else g.r = clamp(g.r * R.range(0.7, 1.4), 35, 320);
        // (no turning the other way: flipping a loop would swing everything after it in one go)
        g.sweep = (g.n * Math.PI) / 4;
      }
    }
    return out;
  }
  /** Grow a journey from state st ({p, h, s, segs, last}) with the v1 scoring, until it nears E or s ≥ stopAt. */
  function grow(R, st, o) {
    const { E, knot, L } = o,
      A = o.A || BL.archetypes.FAMILIES.knot,
      cor = o.corridor, // { axis, c, half } in frame units, or null
      stopAt = o.stopAt || Infinity,
      m = 110;
    let { p, h, s, last } = st;
    let lastDir = st.lastDir || 0;
    const segs = st.segs;
    while (segs.length < 70 && s < 1.8 * L && s < stopAt) {
      const frac = s / L,
        dE = Math.hypot(E.x - p.x, E.y - p.y);
      if (frac > 0.82 && dE < 180) break;
      const homing = smooth(0.68, 1, frac),
        knotW = smooth(0.12, 0.3, frac) * (1 - smooth(0.7, 0.85, frac));
      const cands = [],
        scores = [];
      for (let k = 0; k < 10; k++) {
        const c = randomSeg(R, frac, A, lastDir);
        let sc = 0;
        const end = walkSeg(c, p, h, 18, (x, y, hh, kk, ls) => {
          if (s + ls < 160) return;
          const ox = Math.max(m - x, 0, x - (F.W - m)),
            oy = Math.max(m - y, 0, y - (F.H - m));
          sc -= (ox + oy) * 0.012 * (1 - homing * 0.9);
          // v3.1: stay inside the family's corridor (a column or a band)
          if (cor) {
            const d = cor.axis === 'vertical' ? Math.abs(x - cor.c) : Math.abs(y - cor.c);
            sc -= (Math.max(0, d - cor.half) * 0.006 * A.corridorW) / (1 + homing);
          }
        });
        const len = segLength(c);
        sc -= (A.knotW * knotW * Math.hypot(end.x - knot.x, end.y - knot.y)) / 190;
        // v3.1: switchback-like families prefer sweeping across the axis
        if (A.headW > 0) {
          const across = A.axis === 'horizontal' ? Math.abs(Math.cos(end.h)) : Math.abs(Math.sin(end.h));
          sc -= A.headW * across * (1 - homing);
        }
        const dE2 = Math.hypot(E.x - end.x, E.y - end.y),
          angTo = Math.atan2(E.y - end.y, E.x - end.x);
        sc += homing * (((dE - dE2) / Math.max(len, 1)) * 1.6 + Math.cos(angTo - end.h) * 1.2);
        if (last && last.type === c.type && (c.type === 'S' || last.n === c.n)) sc -= 0.45;
        cands.push({ c, end });
        scores.push(sc);
      }
      const mx = Math.max(...scores);
      const pick = cands[R.weighted(scores.map((v) => Math.exp((v - mx) / 0.28)))];
      pick.c.i = segs.length;
      segs.push(pick.c);
      last = pick.c;
      if (pick.c.type === 'A') lastDir = pick.c.dir;
      s += segLength(pick.c);
      p = { x: pick.end.x, y: pick.end.y };
      h = pick.end.h;
    }
    Object.assign(st, { p, h, s, last, lastDir });
    return st;
  }
  /** Plan one Life genome: shared prologue + five anchor futures (deterministic per master + attempt). */
  function planLife(master, attempt, A) {
    A = A || BL.archetypes.FAMILIES.knot;
    const R = makeRng(master + '/life/' + attempt);
    const Lbase = R.range(3.0, 4.6) * 1.118 * Math.sqrt(F.W * F.H) * A.Lmul;
    // v3.1: families with an axis enter and leave along it (a column enters at the top or bottom)
    const entrySide =
      A.axis === 'vertical'
        ? R.chance(0.5)
          ? 0
          : 2
        : A.axis === 'horizontal'
          ? R.chance(0.5)
            ? 1
            : 3
          : R.int(0, 3);
    const corC = R.range(0.35, 0.65);
    const entryT = A.corridorW > 0 ? clamp(corC + R.range(-0.08, 0.08), 0.15, 0.85) : R.range(0.2, 0.8),
      h0 = INWARD[entrySide] + R.range(-0.45, 0.45);
    const corridor =
      A.corridorW > 0 && A.axis
        ? {
            axis: A.axis,
            c: corC * (A.axis === 'vertical' ? F.W : F.H),
            half: 0.5 * A.corridorWidth * (A.axis === 'vertical' ? F.W : F.H),
          }
        : null;
    const start = edgePoint(entrySide, entryT);
    const prologueLen = R.range(0.03, 0.06) * Lbase;
    // the shared beginning: approach-phase scoring toward a provisional centre
    const st0 = { p: { x: start.x, y: start.y }, h: h0, s: 0, segs: [], last: null };
    grow(R, st0, {
      E: { x: F.W / 2, y: F.H / 2 },
      knot: { x: F.W / 2, y: F.H / 2 },
      L: Lbase,
      stopAt: prologueLen,
      A,
      corridor,
    });
    // the future at φ = 0
    const R0 = makeRng(master + '/life/' + attempt + '/0');
    const opposite = (entrySide + 2) % 4;
    const exitSide = R0.weighted(
      [0, 1, 2, 3].map((s) =>
        A.axis ? (s === opposite ? 6 : s === entrySide ? 0.3 : 0.8) : s === entrySide ? 0.6 : 2
      )
    );
    let exitT = R0.range(0.15, 0.85);
    if (exitSide === entrySide && Math.abs(exitT - entryT) < 0.35)
      exitT = entryT < 0.5 ? Math.min(0.85, entryT + 0.45) : Math.max(0.15, entryT - 0.45);
    if (corridor && exitSide === opposite) exitT = clamp(corC + R0.range(-0.12, 0.12), 0.12, 0.88);
    const E = edgePoint(exitSide, exitT),
      knot = { x: F.W * R0.range(0.33, 0.67), y: F.H * R0.range(0.35, 0.65) },
      L0 = Math.max(st0.s * 1.6, Lbase * R0.range(0.85, 1.2));
    const st = {
      p: { ...st0.p },
      h: st0.h,
      s: st0.s,
      segs: st0.segs.map((g) => ({ ...g })),
      last: st0.last,
      lastDir: st0.lastDir,
    };
    grow(R0, st, { E, knot, L: L0, A, corridor });
    const proj = (E.x - st.p.x) * Math.cos(st.h) + (E.y - st.p.y) * Math.sin(st.h);
    st.segs.push({ type: 'S', len: clamp(proj, 60, 700), i: st.segs.length });
    const from = st0.segs.length,
      Gs = { start, h0 };
    const futures = { 0: st.segs };
    // chains of small mutations toward the later and the earlier years
    for (const dir of [1, -1]) {
      let prev = st.segs;
      for (let y = LIFE_STEP; y <= 10; y += LIFE_STEP) {
        const year = dir * y,
          Rm = makeRng(master + '/life/' + attempt + '/' + year);
        let best = null;
        for (let tries = 0; tries < 12; tries++) {
          const cand = mutate(prev, from, Rm, A.nMut),
            o = futureOut(Gs, cand);
          if (!best || o < best.o) best = { cand, o };
          if (o < 0.02) break;
        }
        futures[year] = best.cand;
        prev = best.cand;
      }
    }
    const anchors = LIFE_ANCHORS.map((year) => ({
      year,
      segs: futures[year],
      L: futures[year].reduce((a, g) => a + segLength(g), 0),
    }));
    return {
      mode: 'life',
      archetype: A,
      entrySide,
      entryT,
      h0,
      start,
      prologueLen: st0.s,
      anchors,
      segs: futures[0], // the φ = 0 future (used for counts)
      exitSide,
      timeSeed: cyrb128(master + '/time')[0] | 0,
    };
  }

  function evaluate(G) {
    let worst = 0;
    const phis =
      G.mode === 'life'
        ? [-10, -8.75, -7.5, -6.25, -5, -3.75, -2.5, -1.25, 0, 1.25, 2.5, 3.75, 5, 6.25, 7.5, 8.75, 10]
        : [-10, -5, 0, 5, 10];
    for (const phi of phis) {
      const sp = buildSpine(G, phi, 10);
      if (G.mode !== 'life' && (sp.kf < 0.68 || sp.kf > 1.45 || Math.abs(sp.rot) > 0.7))
        return { ok: false, bad: 10 + Math.abs(sp.rot) };
      let out = 0,
        cnt = 0;
      for (let i = 0; i < sp.n; i++) {
        const sa = sp.u[i] * sp.len;
        if (sa < 220 || sa > (G.mode === 'life' ? sp.visibleEnd : sp.len) - 220) continue;
        cnt++;
        const x = sp.xs[i],
          y = sp.ys[i];
        if (x < 75 || x > F.W - 75 || y < 75 || y > F.H - 75) out++; // keep room for the brush width
      }
      // v3.0: if a Life journey ends outside the frame, its straight run-out must not come back in
      if (G.mode === 'life') {
        const e = Math.min(sp.n - 1, Math.round((sp.visibleEnd / sp.len) * (sp.n - 1))),
          ex = sp.xs[e],
          ey = sp.ys[e];
        if (ex < 0 || ex > F.W || ey < 0 || ey > F.H)
          for (let i = e; i < sp.n; i++) {
            const x = sp.xs[i],
              y = sp.ys[i];
            if (x > 75 && x < F.W - 75 && y > 75 && y < F.H - 75) return { ok: false, bad: 5 };
          }
      }
      worst = Math.max(worst, out / Math.max(cnt, 1));
    }
    return { ok: worst < 0.03, bad: worst };
  }
  /** Plan the journey: first attempt that passes evaluate(), else the best one. */
  function planGenome(master, mode = BL.planner.MODE) {
    let best = null;
    const tries = mode === 'life' ? 60 : 120;
    // v3.1: the seed picks the spine family (BL.planner.forceFamily overrides the main family)
    const A = BL.archetypes.makeArchetype(master, BL.planner.forceFamily);
    for (let a = 0; a < tries; a++) {
      const G = mode === 'life' ? planLife(master, a, A) : planOnce(master, a);
      G.attempt = a;
      const ev = evaluate(G);
      if (ev.ok) return G;
      if (!best || ev.bad < best.bad) best = { G, bad: ev.bad };
    }
    // v3.1: nothing fitted: re-plan with the family scaled down a little
    if (mode === 'life' && best.bad > 0.03) return planShrunk(master, A, best);
    return best.G;
  }
  /** Re-plan with a family scaled to 85% and 72% size; returns the first genome that passes, or null. */
  function planShrunk(master, A0, best) {
    for (const k of [0.85, 0.72]) {
      const A = Object.assign({}, A0, {
        r: A0.r.map((p) => p.map((v) => v * k)),
        sLen: A0.sLen.map((p) => p.map((v) => v * k)),
      });
      for (let a = 0; a < 30; a++) {
        const G = planLife(master, 1000 + a, A);
        G.attempt = 1000 + a;
        const ev = evaluate(G);
        if (ev.ok) return G;
        if (ev.bad < best.bad) best = { G, bad: ev.bad };
      }
    }
    return best.G;
  }

  /** Journey mode: 'life' (v3: one beginning, futures that diverge through TIME) or 'classic' (v1–v2.4). */
  const MODE = 'life';
  BL.planner = { planGenome, planOnce, planLife, evaluate, LIFE_ANCHORS, MODE, forceFamily: null };
})((window.BL = window.BL || {}));
