/**
 * Bezier Life — version
 * js/core/version.js
 *
 * Bump when the artwork algorithm changes: the same seed can look different between versions.
 * Store this with any saved piece so it can be reproduced with the matching code.
 *   1.0  first modular release
 *   2.0  bristle layout (core + far strands, splay), per-bristle timing for fade/thickness,
 *        Ink without the shared wash (no simultaneous cuts)
 *   2.1  Ink splashes: each drop is built from tiny merging specks
 *   2.2  3D: the cast shadow fades in along the journey (no sudden solid start)
 *   2.3  smooth bends: curvature eased at joints, soft inner-side offsets, smoothed bristle paths
 *   2.4  hand tremor: smooth sideways wobble per strand, in all styles
 *   3.0  Life journeys: same beginning at every TIME; futures drift apart through the years
 *   3.1  spine families studied from reference paintings; the seed picks, blends and varies them
 *   3.2  rebel strands: 2–4 % of the sub-strokes leave the stroke at their own point and run their own path
 */
(function (BL) {
  'use strict';
  BL.version = '3.2';
})((window.BL = window.BL || {}));
