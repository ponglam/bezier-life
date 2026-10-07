/**
 * Bezier Life — spine families (archetypes)
 * js/model/archetypes.js
 *
 * v3.1: the spine grammar (straights + n/8 arcs) is driven by a FAMILY, studied from
 * reference paintings. Each family is a set of planner parameters:
 *
 *   pS[ph]        chance of a straight in each phase (approach / middle / departure)
 *   sLen[i]       straight length range [outer phases, middle phase]
 *   nW[ph]        weights of arc size n = 1…8 (n/8 of a circle) per phase
 *   r[i]          arc radius range [outer phases, middle phase]
 *   alt           chance the next arc turns the OTHER way from the last one
 *                 (1 = strict S-curves, 0 = always the same way → coils)
 *   knotW         pull toward a knot centre in the middle of the journey
 *   corridorW     pull toward a corridor (a column or a band); corridorWidth = its width (share of frame)
 *   axis          'vertical' | 'horizontal' | null — corridor direction and entry/exit sides
 *   headW         preference for headings along the cross axis (switchback sweeps)
 *   Lmul          journey length vs. the default
 *
 * makeArchetype(master): the seed picks a main family, a second family and a blend
 * (0–35 % of the second), then jitters every number by up to ±12 %. So each visitor
 * gets their own variant, e.g. "Serpent with a touch of Drape".
 */
(function (BL) {
  'use strict';
  const { clamp, lerp } = BL.math;
  const { makeRng } = BL.random;

  // nW helpers: weights for n = 1…8
  const SMALL = [3, 3, 2, 1, 0.5, 0.3, 0.15, 0.1],
    MIXED = [0.6, 1, 1.3, 1.8, 2, 1.8, 1.4, 1.1],
    HALF = [0.2, 0.8, 2, 3, 2, 0.8, 0.3, 0.1],
    BIG = [0.1, 0.2, 0.6, 1.5, 2.6, 2.8, 2, 1],
    LOOP = [0.1, 0.1, 0.2, 0.4, 0.8, 1.6, 2.6, 3],
    GENTLE = [3, 3, 1.4, 0.4, 0.1, 0.05, 0.02, 0.01],
    HAIRPIN = [0.1, 0.2, 0.8, 4, 0.8, 0.2, 0.1, 0.05];

  /** The families. ref = which reference painting it was studied from. */
  const FAMILIES = {
    knot: {
      zh: '結',
      en: 'Knot',
      ref: 'v1–v3.0 default: approach, a dense knot, departure',
      pS: [0.42, 0.14, 0.32],
      sLen: [
        [120, 360],
        [60, 220],
      ],
      nW: [SMALL, MIXED, SMALL],
      r: [
        [100, 300],
        [60, 190],
      ],
      alt: 0.5,
      knotW: 1,
      corridorW: 0,
      corridorWidth: 0.4,
      axis: null,
      headW: 0,
      Lmul: 1,
    },
    scroll: {
      zh: '卷',
      en: 'Scroll',
      ref: 'wide open C / U sweeps that reverse, ribbon ends curling (teal & violet)',
      pS: [0.2, 0.12, 0.2],
      sLen: [
        [80, 220],
        [60, 160],
      ],
      nW: [HALF, HALF, HALF],
      r: [
        [140, 320],
        [110, 260],
      ],
      alt: 0.75,
      knotW: 0.3,
      corridorW: 0,
      corridorWidth: 0.5,
      axis: null,
      headW: 0,
      Lmul: 1.05,
    },
    drape: {
      zh: '垂',
      en: 'Drape',
      ref: 'one long falling sweep, a soft valley, almost no loops (blue wave)',
      pS: [0.3, 0.25, 0.3],
      sLen: [
        [120, 320],
        [100, 260],
      ],
      nW: [GENTLE, GENTLE, GENTLE],
      r: [
        [150, 300],
        [140, 280],
      ],
      alt: 0.85,
      knotW: 0,
      corridorW: 0,
      corridorWidth: 0.5,
      axis: null,
      headW: 0,
      Lmul: 0.6,
    },
    serpent: {
      zh: '蛇行',
      en: 'Serpent',
      ref: 'big loops stacked in a column, each turning the other way (grooved knot)',
      pS: [0.12, 0.05, 0.15],
      sLen: [
        [80, 200],
        [40, 120],
      ],
      nW: [HALF, BIG, HALF],
      r: [
        [100, 190],
        [90, 170],
      ],
      alt: 0.95,
      knotW: 0,
      corridorW: 1.2,
      corridorWidth: 0.4,
      axis: 'vertical',
      headW: 0,
      Lmul: 1.15,
    },
    meander: {
      zh: '蜿蜒',
      en: 'Meander',
      ref: 'many small alternating bends, wandering like smoke (green contours)',
      pS: [0.15, 0.1, 0.15],
      sLen: [
        [60, 160],
        [40, 120],
      ],
      nW: [GENTLE, SMALL, GENTLE],
      r: [
        [80, 180],
        [70, 160],
      ],
      alt: 0.72,
      knotW: 0.5,
      corridorW: 0,
      corridorWidth: 0.5,
      axis: null,
      headW: 0,
      Lmul: 1.35,
    },
    vortex: {
      zh: '漩',
      en: 'Vortex',
      ref: 'a rising column of tight same-way swirls, a coil (white on blue)',
      pS: [0.1, 0.04, 0.2],
      sLen: [
        [80, 200],
        [40, 100],
      ],
      nW: [HALF, LOOP, HALF],
      r: [
        [60, 140],
        [45, 110],
      ],
      alt: 0.15,
      knotW: 0,
      corridorW: 1.5,
      corridorWidth: 0.28,
      axis: 'vertical',
      headW: 0,
      Lmul: 1.25,
    },
    switchback: {
      zh: '折返',
      en: 'Switchback',
      ref: 'long side-to-side sweeps folded by hairpin turns, stacked (violet)',
      pS: [0.5, 0.6, 0.45],
      sLen: [
        [150, 340],
        [140, 320],
      ],
      nW: [HAIRPIN, HAIRPIN, HAIRPIN],
      r: [
        [50, 110],
        [40, 100],
      ],
      alt: 0.95,
      knotW: 0,
      corridorW: 0,
      corridorWidth: 0.5,
      axis: 'vertical',
      headW: 1.6,
      Lmul: 1.15,
    },
    glyph: {
      zh: '字',
      en: 'Glyph',
      ref: 'a short calligraphic gesture: a drop, a loop, a flick (olive)',
      pS: [0.35, 0.25, 0.3],
      sLen: [
        [100, 260],
        [60, 180],
      ],
      nW: [MIXED, MIXED, SMALL],
      r: [
        [70, 210],
        [60, 180],
      ],
      alt: 0.5,
      knotW: 0.6,
      corridorW: 0,
      corridorWidth: 0.5,
      axis: null,
      headW: 0,
      Lmul: 0.55,
    },
    hook: {
      zh: '鉤',
      en: 'Hook',
      ref: 'a long descending sweep into one big closed loop (black & white on linen)',
      pS: [0.4, 0.15, 0.4],
      sLen: [
        [140, 360],
        [80, 200],
      ],
      nW: [SMALL, LOOP, SMALL],
      r: [
        [140, 300],
        [120, 240],
      ],
      alt: 0.6,
      knotW: 0.8,
      corridorW: 0,
      corridorWidth: 0.5,
      axis: null,
      headW: 0,
      Lmul: 0.8,
    },
  };
  const KEYS = Object.keys(FAMILIES);

  /** Blend two families (t = share of b) — numbers and number arrays, recursively. */
  function blend(a, b, t) {
    if (typeof a === 'number') return lerp(a, b, t);
    if (Array.isArray(a)) return a.map((x, i) => blend(x, b[i], t));
    return a; // strings / null: keep the main family's
  }
  /** Multiply every number by its own factor in [1 − j, 1 + j]. */
  function jitter(v, R, j) {
    if (typeof v === 'number') return v * R.range(1 - j, 1 + j);
    if (Array.isArray(v)) return v.map((x) => jitter(x, R, j));
    return v;
  }

  /**
   * The visitor's spine family, decided by the seed.
   * @param {string} master
   * @param {string} [force]  family key to force (dev / curation); the blend and jitter still come from the seed
   */
  function makeArchetype(master, force) {
    const R = makeRng(master + '/archetype');
    const main = force && FAMILIES[force] ? force : KEYS[R.int(0, KEYS.length - 1)];
    let second = KEYS[R.int(0, KEYS.length - 1)];
    if (second === main) second = KEYS[(KEYS.indexOf(main) + 1) % KEYS.length];
    const mix = R.range(0, 0.35);
    const A = {};
    for (const k of Object.keys(FAMILIES[main])) {
      const v = blend(FAMILIES[main][k], FAMILIES[second][k], mix);
      A[k] = ['zh', 'en', 'ref', 'axis'].includes(k) ? v : jitter(v, R, 0.12);
    }
    A.pS = A.pS.map((p) => clamp(p, 0.02, 0.8));
    A.alt = clamp(A.alt, 0, 1);
    // how often a TIME mutation may change an arc's size (strict families keep their shape)
    A.nMut = { serpent: 0.12, switchback: 0.08, vortex: 0.2 }[main] ?? 0.4;
    return Object.assign(A, { key: main, second, mix });
  }

  /** "Serpent 蛇行, with a touch of Drape 垂" */
  function describe(A) {
    const s = FAMILIES[A.second];
    const touch =
      A.mix < 0.08
        ? ''
        : A.mix < 0.2
          ? `, with a touch of ${s.en} ${s.zh}`
          : `, blended with ${s.en} ${s.zh}`;
    return `${FAMILIES[A.key].en} ${FAMILIES[A.key].zh}${touch}`;
  }

  BL.archetypes = { FAMILIES, KEYS, makeArchetype, describe };
})((window.BL = window.BL || {}));
