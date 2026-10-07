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
  function randomSeg(R, frac) {
    const ph = frac < 0.2 ? 0 : frac < 0.78 ? 1 : 2; // approach / knot / departure
    if (R.chance([0.42, 0.14, 0.32][ph]))
      return {
        type: 'S',
        len: ph === 1 ? R.range(60, 220) : R.range(120, 360),
      };
    const nW = [
      [3, 3, 2, 1, 0.5, 0.3, 0.15, 0.1],
      [0.6, 1, 1.3, 1.8, 2, 1.8, 1.4, 1.1],
      [2.2, 2.6, 2, 1.1, 0.5, 0.25, 0.1, 0.1],
    ][ph];
    const n = 1 + R.weighted(nW);
    return {
      type: 'A',
      n,
      r: ph === 1 ? R.range(60, 190) : R.range(100, 300),
      dir: R.chance(0.5) ? 1 : -1,
      sweep: (n * Math.PI) / 4,
    };
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
  function evaluate(G) {
    let worst = 0;
    for (const phi of [-10, -5, 0, 5, 10]) {
      const sp = buildSpine(G, phi, 10);
      if (sp.kf < 0.68 || sp.kf > 1.45 || Math.abs(sp.rot) > 0.7)
        return { ok: false, bad: 10 + Math.abs(sp.rot) };
      let out = 0,
        cnt = 0;
      for (let i = 0; i < sp.n; i++) {
        const sa = sp.u[i] * sp.len;
        if (sa < 220 || sa > sp.len - 220) continue;
        cnt++;
        const x = sp.xs[i],
          y = sp.ys[i];
        if (x < 75 || x > F.W - 75 || y < 75 || y > F.H - 75) out++; // keep room for the brush width
      }
      worst = Math.max(worst, out / Math.max(cnt, 1));
    }
    return { ok: worst < 0.03, bad: worst };
  }
  /** Plan the journey: first attempt that passes evaluate(), else the best one. */
  function planGenome(master) {
    let best = null;
    for (let a = 0; a < 120; a++) {
      const G = planOnce(master, a);
      G.attempt = a;
      const ev = evaluate(G);
      if (ev.ok) return G;
      if (!best || ev.bad < best.bad) best = { G, bad: ev.bad };
    }
    return best.G;
  }

  BL.planner = { planGenome, planOnce, evaluate };
})((window.BL = window.BL || {}));
