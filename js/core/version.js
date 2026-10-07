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
 */
(function (BL) {
  'use strict';
  BL.version = '2.3';
})((window.BL = window.BL || {}));
