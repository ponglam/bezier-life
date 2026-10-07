/**
 * Bezier Life — streaming PNG encoder
 * js/export/png-stream.js
 *
 * Writes a PNG band by band, so an 8K image never needs one giant canvas
 * (iOS/Safari cannot allocate one). RGB, 8-bit, "Sub" row filter, zlib via fflate.
 *   const png = new PngStream(width, height);
 *   png.band(rgbBytes, rows);  // repeat top → bottom
 *   const blob = png.finish();
 * Requires window.fflate (vendor/fflate.min.js).
 */
(function (BL) {
  'use strict';

  const CRC_T = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  /** CRC-32 over several byte arrays (PNG chunks). */
  function crc32(parts) {
    let c = 0xffffffff;
    for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_T[(c ^ p[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  /** Build one PNG chunk: length, type, data, CRC. */
  function pngChunk(type, data) {
    const tb = new TextEncoder().encode(type),
      out = new Uint8Array(12 + data.length),
      dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(tb, 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32([tb, data]));
    return out;
  }
  class PngStream {
    constructor(w, h) {
      this.w = w;
      this.parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])];
      const ih = new Uint8Array(13),
        dv = new DataView(ih.buffer);
      dv.setUint32(0, w);
      dv.setUint32(4, h);
      ih[8] = 8;
      ih[9] = 2;
      this.parts.push(pngChunk('IHDR', ih));
      this.z = new fflate.Zlib({ level: 4 });
      this.z.ondata = (d) => {
        if (d.length) this.parts.push(pngChunk('IDAT', d));
      };
    }
    band(rgb, rows) {
      // rows of RGB, "Sub" filter for better compression
      const rl = this.w * 3,
        out = new Uint8Array((rl + 1) * rows);
      for (let r = 0; r < rows; r++) {
        const o = r * (rl + 1),
          s = r * rl;
        out[o] = 1;
        for (let i = 0; i < rl; i++) out[o + 1 + i] = (rgb[s + i] - (i >= 3 ? rgb[s + i - 3] : 0)) & 255;
      }
      this.z.push(out, false);
    }
    finish() {
      this.z.push(new Uint8Array(0), true);
      this.parts.push(pngChunk('IEND', new Uint8Array(0)));
      return new Blob(this.parts, { type: 'image/png' });
    }
  }

  BL.PngStream = PngStream;
})((window.BL = window.BL || {}));
