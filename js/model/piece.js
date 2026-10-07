/**
 * Bezier Life — piece model
 * js/model/piece.js
 *
 * A "piece" (often called S in the renderers) holds everything for one visitor:
 *
 *   Genome — fixed by the seed (and the format), built once by buildPiece():
 *     master   SHA-256 hex of the visitor's inputs
 *     reading  five-element reading (element, day master, palette index…)
 *     FP       the five-element palette (hex strings)
 *     G        journey genome: entry/exit sides, segment list
 *     P        stroke profile keyframes        pal / GG / IG   painterly / graphic / ink genomes
 *     depth    3D depth + cup                  light           3D light rig
 *     sp0      spine at φ = 0 (ghost in the Journey view)
 *
 *   Expression — recomputed by computeAt() whenever φ, style or density change:
 *     sp       sampled spine          pr      width / twist / paint load
 *     turn     brush pressure         z       3D depth per sample
 *     gfx      graphic line data      ink     ink level + width
 *     phi, style, density (requested), dens (actually used), lo (fast preview)
 *
 * The 3D renderer caches GPU data on the piece (strokeMat, lineMat, glDirty, …).
 */
(function (BL) {
  'use strict';
  const { planGenome } = BL.planner;
  const { buildSpine } = BL.spine;
  const { makeProfile, profileAt, turnSignal } = BL.profile;
  const { makePalette, makeGraphic, graphicAt, makeInk, inkAt, makeDepth, makeLight, depthAt } = BL.styles;
  const { paletteFor } = BL.fiveElements;

  /**
   * Build the genome for a master seed and five-element reading, in the current frame (BL.frame).
   * Re-run it when the format (aspect) changes: the journey is re-planned to fit the frame.
   */
  function buildPiece(master, reading) {
    const G = planGenome(master);
    const FP = paletteFor(reading);
    const S = {
      master,
      reading,
      FP,
      G,
      P: makeProfile(master, G),
      pal: makePalette(master, FP),
      GG: makeGraphic(master, FP),
      IG: makeInk(master, FP),
      depth: makeDepth(master),
      light: makeLight(master),
      phi: 0,
      style: 'painterly',
      density: 1,
    };
    S.sp0 = buildSpine(G, 0, 2);
    return S;
  }

  /**
   * Evaluate the piece at a TIME phase and density.
   * @param {object} S
   * @param {object} o
   * @param {number} [o.phi]        TIME phase in years, −10…+10 (0 = the birth moment)
   * @param {string} [o.style]      'painterly' | 'graphic' | 'ink'
   * @param {number} [o.density]    point density 1…10 (sample spacing = 2 / density units)
   * @param {boolean} [o.lo]        fast preview (density 1) while dragging / animating
   * @param {boolean} [o.exporting] true for saved images: Ink uses the full density
   */
  function computeAt(S, o = {}) {
    if (o.phi !== undefined) S.phi = o.phi;
    if (o.style) S.style = o.style;
    if (o.density) S.density = o.density;
    S.lo = !!o.lo;
    // Ink is drawn as 2D paths: on screen it caps at 3× (finer points are below a pixel).
    S.dens = S.lo ? 1 : S.style === 'ink' && !o.exporting ? Math.min(S.density, 3) : S.density;

    S.sp = buildSpine(S.G, S.phi, 2 / S.dens);
    S.pr = profileAt(S.sp, S.P, S.G, S.phi);
    S.turn = turnSignal(S.sp);
    S.z = depthAt(S);
    S.gfx = S.style === 'graphic' ? graphicAt(S) : null;
    S.ink = S.style === 'ink' ? inkAt(S) : null;
    S.glDirty = true; // 3D meshes must be rebuilt
    return S;
  }

  /** Number of spine points at the requested density (even when the preview uses fewer). */
  const pointCount = (S) => Math.round(((S.sp.n - 1) * S.density) / S.dens + 1);

  BL.piece = { buildPiece, computeAt, pointCount };
})((window.BL = window.BL || {}));
