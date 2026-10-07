/**
 * Bezier Life — composition frame
 * js/core/frame.js
 *
 * The artwork is composed in a logical frame whose short side is 1000 units.
 * F.W / F.H change with the format (3:4, 1:1, 4:3). Everything is drawn in
 * these units and scaled to the screen or to the export resolution.
 */
(function (BL) {
  'use strict';

  const ASPECTS = {
    '3:4': [1000, 4000 / 3],
    '1:1': [1000, 1000],
    '4:3': [4000 / 3, 1000],
  };
  /** The live frame. Read F.W / F.H at call time (they change with the format). */
  const F = { W: 1000, H: 4000 / 3, aspect: '3:4' };
  function setAspect(a) {
    F.aspect = a;
    [F.W, F.H] = ASPECTS[a];
  }
  const SIDES = ['top', 'right', 'bottom', 'left'];
  const INWARD = [Math.PI / 2, Math.PI, -Math.PI / 2, 0];
  /** Point on a frame edge (side 0 top, 1 right, 2 bottom, 3 left), t along it, `out` units outside. */
  function edgePoint(side, t, out = 40) {
    switch (side) {
      case 0:
        return { x: t * F.W, y: -out };
      case 1:
        return { x: F.W + out, y: t * F.H };
      case 2:
        return { x: t * F.W, y: F.H + out };
      default:
        return { x: -out, y: t * F.H };
    }
  }

  BL.frame = Object.assign(F, { ASPECTS, setAspect, SIDES, INWARD, edgePoint });
})((window.BL = window.BL || {}));
