/**
 * Bezier Life — large image export
 * js/export/export.js
 *
 * renderLarge(S, {longSide, view}) renders the piece in 2048 px tiles and streams
 * them into a PNG (see png-stream.js), so 8192 × 8192 works without a giant canvas.
 *   3D styles: a second, off-screen WebGL renderer with camera.setViewOffset() per tile
 *              and an 8192 shadow map (where the GPU allows).
 *   2D (Ink, Journey, flat fallbacks): the Canvas 2D drawing is re-run per tile with an
 *              offset transform; drawing is deterministic so tiles line up exactly.
 * Output sizes: long side 2048 / 4096 / 8192 in the current format (3:4, 1:1, 4:3).
 *
 * BACKEND NOTE: for server-side rendering, run this page in headless Chrome
 * (e.g. Puppeteer) and call BL.exporter.renderLarge(); it returns a PNG Blob.
 */
(function (BL) {
  'use strict';
  const { sleep } = BL.math;
  const F = BL.frame;
  const { computeAt } = BL.piece;
  const R3 = BL.render3d;
  const TILE = 2048;

  /** Output pixel size for a long side in the current format. */
  function outputSize(longSide) {
    return F.W >= F.H
      ? { OW: longSide, OH: Math.round((longSide * F.H) / F.W) }
      : { OW: Math.round((longSide * F.W) / F.H), OH: longSide };
  }

  /** Default file name: seed code, style, size and time phase. */
  function filenameFor(S, OW, OH) {
    const ph = (S.phi >= 0 ? '+' : '') + S.phi.toFixed(1);
    return `bezier-life-v${BL.version}-BL-${S.master.slice(0, 10)}-${S.style}-${OW}x${OH}-t${ph}.png`;
  }

  /**
   * @param {object} S                 a computed piece
   * @param {object} o
   * @param {number} o.longSide        2048 | 4096 | 8192 …
   * @param {string} [o.view='art']    'art' | 'journey'
   * @param {(p:number)=>void} [o.onProgress]  0…1
   * @returns {Promise<{blob:Blob, OW:number, OH:number}>}
   */
  async function renderLarge(S, o) {
    const view = o.view || 'art';
    const onProgress = o.onProgress || (() => {});
    const { OW, OH } = outputSize(o.longSide);
    computeAt(S, { exporting: true }); // full density for every style

    const GL = R3.get();
    const use3D = !!GL && view === 'art' && S.style !== 'ink';
    const tc = document.createElement('canvas');
    tc.width = TILE;
    tc.height = TILE;
    const tctx = tc.getContext('2d', { willReadFrequently: true });

    let er = null,
      cam = null,
      oldMap = 4096;
    if (use3D) {
      if (S.glDirty) R3.syncGL(S);
      for (const m of GL.meshes) m.geometry.setDrawRange(0, Infinity);
      er = new THREE.WebGLRenderer({ antialias: true });
      R3.setupRenderer(er);
      er.setPixelRatio(1);
      er.shadowMap.autoUpdate = false; // the shadow map is rendered once and reused by every tile
      er.shadowMap.needsUpdate = true;
      const ms = Math.min(8192, er.capabilities.maxTextureSize);
      oldMap = GL.key.shadow.mapSize.x;
      GL.key.shadow.mapSize.set(ms, ms);
      GL.key.shadow.radius = (3 * ms) / 4096;
      if (GL.key.shadow.map) {
        GL.key.shadow.map.dispose();
        GL.key.shadow.map = null;
      }
      cam = GL.camera.clone();
    }

    const png = new BL.PngStream(OW, OH);
    try {
      for (let y0 = 0; y0 < OH; y0 += TILE) {
        const bh = Math.min(TILE, OH - y0);
        const band = new Uint8Array(OW * bh * 3);
        for (let x0 = 0; x0 < OW; x0 += TILE) {
          const bw = Math.min(TILE, OW - x0);
          tctx.setTransform(1, 0, 0, 1, 0, 0);
          tctx.clearRect(0, 0, TILE, TILE);
          if (use3D) {
            er.setSize(bw, bh, false);
            cam.setViewOffset(OW, OH, x0, y0, bw, bh);
            cam.updateProjectionMatrix();
            er.render(GL.scene, cam);
            tctx.drawImage(er.domElement, 0, 0);
          } else {
            tctx.setTransform(OW / F.W, 0, 0, OW / F.W, -x0, -y0);
            BL.render2d.draw(tctx, S, {
              view,
              style: S.style,
              progress: 1,
              stride: 1,
            });
          }
          const px = tctx.getImageData(0, 0, bw, bh).data;
          for (let r = 0; r < bh; r++) {
            for (let x = 0; x < bw; x++) {
              const si = (r * bw + x) * 4,
                di = (r * OW + x0 + x) * 3;
              band[di] = px[si];
              band[di + 1] = px[si + 1];
              band[di + 2] = px[si + 2];
            }
          }
          onProgress((y0 * OW + (x0 + bw) * bh) / (OW * OH));
          await sleep(0); // keep the page responsive
        }
        png.band(band, bh);
      }
    } finally {
      if (er) {
        er.dispose();
        er.forceContextLoss();
        GL.key.shadow.mapSize.set(oldMap, oldMap);
        GL.key.shadow.radius = 3;
        if (GL.key.shadow.map) {
          GL.key.shadow.map.dispose();
          GL.key.shadow.map = null;
        }
      }
      computeAt(S, {}); // back to the preview density
    }
    return { blob: png.finish(), OW, OH };
  }

  BL.exporter = { renderLarge, outputSize, filenameFor };
})((window.BL = window.BL || {}));
