/**
 * Bezier Life — 2D renderer (Canvas 2D)
 * js/render/render2d.js
 *
 * Draws in logical frame units; the caller sets the context transform
 * (screen scale, or tile offset + scale when exporting).
 *   draw(ctx, S, {view, style, progress, stride})
 *     view 'journey' → drawJourney (debug: segments, pressure, points)
 *     style 'ink'     → drawInk  (paper, bristles, dry gaps, splashes)
 *     'graphic' / 'painterly' → flat fallbacks when WebGL2 is not available
 * progress 0..1 reveals the stroke along its journey; stride > 1 skips bristles (fast preview).
 */
(function (BL) {
  'use strict';
  const { clamp } = BL.math;
  const { makeRng, vnoise } = BL.random;
  const { mix, css } = BL.color;
  const { LANES, LANES_INK } = BL.styles;
  const { laneV } = BL.profile;
  const F = BL.frame;

  const { offsetAt, pointAt } = BL.spine; // v2.3: smooth inner-side compression (see spine.js)
  /** Painterly background: base colour + soft glow. */
  function drawBackground(ctx, pal) {
    ctx.fillStyle = css(pal.bg);
    ctx.fillRect(0, 0, F.W, F.H);
    const g = ctx.createRadialGradient(
      pal.glowPos.x,
      pal.glowPos.y,
      0,
      pal.glowPos.x,
      pal.glowPos.y,
      F.H * 0.9
    );
    g.addColorStop(0, css(pal.glow, pal.glowAmt));
    g.addColorStop(1, css(pal.glow, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, F.W, F.H);
  }
  /** Flat Painterly (fallback without WebGL2): ribbon body + bristle lanes in chunks along the journey. */
  function drawPainterly(ctx, S, upto, stride) {
    const { sp, pr, pal } = S,
      CH = Math.round(22 * S.dens),
      n = Math.max(2, Math.floor(upto * sp.n)),
      lx = -0.55,
      ly = -0.83;
    const P = (k, v) => offsetAt(sp, k, v * pr.hw[k] * pr.cth[k]);
    drawBackground(ctx, pal);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    for (let a = 0; a < n - 1; a += CH) {
      const b = Math.min(n - 1, a + CH),
        m = (a + b) >> 1,
        c = pr.cth[m],
        front = c >= 0,
        u = sp.u[m];
      ctx.beginPath();
      for (let k = a; k <= b; k++) {
        const q = P(k, -1);
        k === a ? ctx.moveTo(q[0], q[1]) : ctx.lineTo(q[0], q[1]);
      }
      for (let k = b; k >= a; k--) {
        const q = P(k, 1);
        ctx.lineTo(q[0], q[1]);
      }
      ctx.closePath();
      ctx.fillStyle = css(front ? pal.mid : pal.dark, 0.25 + 0.7 * pr.load[m], front ? 0.8 : 0.7);
      ctx.fill();
      const tilt = Math.sqrt(Math.max(0, 1 - c * c)) * Math.sign(c || 1);
      const lam = 0.5 + 0.5 * (sp.nx[m] * lx + sp.ny[m] * ly) * tilt,
        rim = Math.pow(1 - Math.abs(c), 3);
      ctx.lineWidth = Math.max(0.5, ((2 * pr.hw[m] * Math.abs(c)) / LANES) * stride * 1.7);
      for (let j = 0; j < LANES; j += stride) {
        const L = pal.lanes[j];
        if (u > 1 - pr.fray * (0.03 + 0.09 * L.fray)) continue;
        const dn = vnoise(pal.drySeed, 20, j, u * 38) * 0.5 + 0.5;
        const al = clamp((pr.load[m] * L.cap - dn * 0.55) * 3 + 0.35, 0, 1);
        if (al < 0.03) continue;
        const v = laneV(pal.layout, j, sp.u[m] * sp.len); // v2: bristle layout (core + far strands)
        let k = (0.82 + 0.32 * lam + 0.25 * rim) * (1 + 0.12 * vnoise(pal.drySeed, 21, j, u * 60));
        if (!front) k *= 0.55;
        ctx.strokeStyle = css(L.c, al, k);
        ctx.beginPath();
        for (let i = a; i <= b; i++) {
          const q = P(i, v);
          i === a ? ctx.moveTo(q[0], q[1]) : ctx.lineTo(q[0], q[1]);
        }
        ctx.stroke();
      }
    }
  }
  /** Flat Graphic (fallback without WebGL2): each line as a filled polygon, chunk by chunk. */
  function drawGraphic(ctx, S, upto) {
    const { sp, pr, GG, gfx } = S,
      n = Math.max(2, Math.floor(upto * sp.n)),
      CH = Math.max(3, Math.round(6 * S.dens));
    ctx.fillStyle = css(GG.bg);
    ctx.fillRect(0, 0, F.W, F.H);
    for (let a = 0; a < n - 1; a += CH) {
      const b = Math.min(n - 1, a + CH + 1),
        m = Math.min(n - 1, a + (CH >> 1)),
        front = pr.cth[m] >= 0; // +1 overlap hides seams
      for (let li = 0; li < GG.lines.length; li++) {
        const L = GG.lines[li],
          g = gfx[li];
        if (g.w[m] < 0.12) continue;
        ctx.beginPath();
        for (let k = a; k <= b; k++) {
          const q = pointAt(sp, k, g.ip[k] - g.w[k] * 0.5);
          k === a ? ctx.moveTo(q[0], q[1]) : ctx.lineTo(q[0], q[1]);
        }
        for (let k = b; k >= a; k--) {
          const q = pointAt(sp, k, g.ip[k] + g.w[k] * 0.5);
          ctx.lineTo(q[0], q[1]);
        }
        ctx.closePath();
        const col = front ? L.col : mix(L.col, GG.bg, 0.45);
        ctx.fillStyle = css(mix(GG.bg, col, 0.06 + 0.94 * g.f[m]));
        ctx.fill();
      }
    }
  }
  /** Ink paper: base colour + seeded fibres. */
  function drawPaper(ctx, IG) {
    ctx.fillStyle = css(IG.paper);
    ctx.fillRect(0, 0, F.W, F.H);
    const R = makeRng(IG.paperSeed),
      dark = IG.paper.map((x) => x * 0.82);
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 900; i++) {
      const x = R.range(0, F.W),
        y = R.range(0, F.H),
        a = R.range(0, Math.PI),
        l = R.range(6, 34),
        bend = R.range(-6, 6);
      ctx.strokeStyle = css(R.chance(0.7) ? dark : [255, 255, 255], R.range(0.05, 0.14));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(
        x + Math.cos(a) * l * 0.5 - Math.sin(a) * bend,
        y + Math.sin(a) * l * 0.5 + Math.cos(a) * bend,
        x + Math.cos(a) * l,
        y + Math.sin(a) * l
      );
      ctx.stroke();
    }
  }
  /** One ink splash event: "fling" droplets off a turn, or "spray" where the stroke turns into dots. */
  /**
   * One ink drop (v2.1), built from tiny specks that merge, the way real ink spatters:
   * dense in the middle (specks overlap into a solid pool), granular at the rim, with a few
   * specks thrown just past the edge. Drops smaller than ~1 unit stay a single speck.
   * rx, ry = radii along / across the drop's direction `ang`; G = grain RNG.
   */
  function inkDrop(ctx, G, x, y, rx, ry, ang, alpha) {
    const r = Math.max(rx, ry);
    if (r < 1.1) {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.3, r * 0.9), 0, 6.283);
      ctx.fill();
      return;
    }
    const ca = Math.cos(ang),
      sa = Math.sin(ang);
    const count = Math.round(6 + rx * ry * 3.2); // ~3–4× overlap: specks merge in the middle
    const speck = Math.min(1.6, 0.6 + r * 0.12); // bigger drops → slightly bigger specks
    for (let i = 0; i < count; i++) {
      // distance from the centre (0…1 = inside the drop); a few land just outside the rim
      const t = Math.pow(G.next(), 0.6) * (G.chance(0.08) ? G.range(1.05, 1.5) : 1);
      const a = G.next() * 6.283;
      const lx = Math.cos(a) * t * rx,
        ly = Math.sin(a) * t * ry;
      const dr = G.range(0.35, 1) * (0.6 + 0.6 * Math.max(0, 1 - t)) * speck;
      ctx.globalAlpha = alpha * G.range(0.5, 0.95);
      ctx.beginPath();
      ctx.arc(x + lx * ca - ly * sa, y + lx * sa + ly * ca, dr, 0, 6.283);
      ctx.fill();
    }
  }
  function drawSplash(ctx, S, ev) {
    const { sp, ink, IG } = S,
      n = sp.n,
      R = makeRng(ev.key),
      G = makeRng(ev.key + '/grain'); // separate stream: drop positions stay as in v2
    let k0 = 0;
    while (k0 < n - 1 && sp.u[k0] < ev.u) k0++;
    ctx.fillStyle = css(IG.ink, 1);
    if (ev.type === 'fling') {
      // droplets flung away from the turn (or sideways on a straight), a little forward
      const kk = sp.k[k0],
        sd = kk !== 0 ? -Math.sign(kk) : ev.side,
        hw = Math.max(ink.width[k0], 6);
      const tx = sp.ny[k0],
        ty = -sp.nx[k0]; // forward along the stroke
      const dx0 = sp.nx[k0] * sd * 0.8 + tx * 0.6,
        dy0 = sp.ny[k0] * sd * 0.8 + ty * 0.6;
      const base = Math.atan2(dy0, dx0);
      for (let i = 0; i < ev.count; i++) {
        const a = base + (R.next() - 0.5) * 1.3,
          dist = hw * (0.9 + ev.reach * -Math.log(1 - R.next() * 0.98) * 0.6);
        const x = sp.xs[k0] + Math.cos(a) * dist,
          y = sp.ys[k0] + Math.sin(a) * dist;
        const r = (0.5 + 9 * Math.pow(R.next(), 4)) * (1.25 - Math.min(1, dist / (hw * 4)) * 0.6),
          el = R.chance(0.35) ? R.range(1.3, 2.4) : 1;
        inkDrop(ctx, G, x, y, r * el, r, a, R.range(0.75, 1));
      }
    } else {
      // the stroke dissolves into a spray of dots along its own path
      let ka = k0,
        kb = k0;
      while (ka > 0 && sp.u[ka] > ev.u - ev.w * 0.5) ka--;
      while (kb < n - 1 && sp.u[kb] < ev.u + ev.w * 0.5) kb++;
      for (let i = 0; i < ev.count * 2; i++) {
        const k = ka + Math.floor(R.next() * (kb - ka + 1)),
          v = (R.next() * 2 - 1) * 1.15,
          off = v * ink.width[k];
        const q = offsetAt(sp, k, off),
          r = 0.4 + 3.2 * Math.pow(R.next(), 3),
          ang = Math.atan2(sp.nx[k], -sp.ny[k]);
        const alpha = R.range(0.5, 0.95);
        inkDrop(ctx, G, q[0], q[1], r * R.range(1, 1.8), r, ang, alpha);
      }
    }
    ctx.globalAlpha = 1;
  }
  /**
   * Ink style (v2): no shared wash. Every bristle is drawn on its own from the per-bristle arrays
   * in S.ink.lanes (offset v, ink a, thickness t), as runs of equal ink + thickness, so bristles
   * fade, thin and return at their own points. Chunks follow the journey so later parts of the
   * stroke lie on top of earlier ones; splashes are drawn in journey order too.
   */
  function drawInk(ctx, S, upto, stride) {
    const { sp, IG, ink } = S,
      n = Math.max(2, Math.floor(upto * sp.n)),
      CH = Math.round(16 * S.dens),
      Q = 12,
      base = 2.1 / IG.layout.nCore; // line width per unit of stroke width (core spacing, overlapped)
    drawPaper(ctx, IG);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    const evK = IG.events.map((ev) => {
      let k = 0;
      while (k < sp.n - 1 && sp.u[k] < ev.u) k++;
      return k;
    });
    for (let a = 0; a < n - 1; a += CH) {
      const b = Math.min(n - 1, a + CH),
        m = (a + b) >> 1;
      const wUnit = 2 * ink.width[m] * base * stride;
      for (let j = 0; j < LANES_INK; j += stride) {
        const Ln = ink.lanes[j];
        const P = (k) => [Ln.x[k], Ln.y[k]];
        let r0 = a;
        while (r0 < b) {
          const q = Ln.a[r0],
            th = Ln.t[r0];
          let r1 = r0 + 1;
          while (r1 < b && Ln.a[r1] === q && Ln.t[r1] === th) r1++;
          if (q > 0) {
            ctx.strokeStyle = css(IG.ink, q / Q);
            ctx.lineWidth = Math.max(0.35, wUnit * (th / 8));
            ctx.beginPath();
            for (let i = r0; i <= r1; i++) {
              const p = P(i);
              i === r0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1]);
            }
            ctx.stroke();
          }
          r0 = r1;
        }
      }
      IG.events.forEach((ev, i) => {
        if (evK[i] >= a && evK[i] < b && evK[i] < n) drawSplash(ctx, S, ev);
      });
    }
  }
  function arcColor(n) {
    return `hsl(${215 - (n - 1) * 27},62%,42%)`;
  }
  /** Debug view of the spine: segments by type, brush pressure, sample points, normals, entry/exit. */
  function drawJourney(ctx, S, upto) {
    const { sp, G, pal } = S,
      ghost = Math.abs(S.phi) > 0.04 ? S.sp0 : null;
    ctx.fillStyle = css(mix(pal.bg, [255, 255, 255], 0.45));
    ctx.fillRect(0, 0, F.W, F.H);
    const ink = 'rgba(30,29,43,';
    const edge = (side, dash) => {
      ctx.save();
      ctx.setLineDash(dash);
      ctx.lineWidth = 10;
      ctx.strokeStyle = ink + '0.55)';
      ctx.beginPath();
      const p = [
        [0, 0, F.W, 0],
        [F.W, 0, F.W, F.H],
        [0, F.H, F.W, F.H],
        [0, 0, 0, F.H],
      ][side];
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(p[2], p[3]);
      ctx.stroke();
      ctx.restore();
    };
    edge(G.entrySide, []);
    edge(G.exitSide, [18, 12]);
    if (ghost) {
      ctx.strokeStyle = ink + '0.14)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < ghost.n; i++)
        i ? ctx.lineTo(ghost.xs[i], ghost.ys[i]) : ctx.moveTo(ghost.xs[i], ghost.ys[i]);
      ctx.stroke();
    }
    const n = Math.max(2, Math.floor(upto * sp.n));
    ctx.lineCap = 'round';
    let i = 0;
    while (i < n - 1) {
      const s = sp.seg[i];
      let j = i;
      while (j < n - 1 && sp.seg[j + 1] === s) j++;
      j = Math.min(j + 1, n - 1);
      const sg = sp.segs[s];
      ctx.strokeStyle = sg.type === 'S' ? ink + '0.8)' : arcColor(sg.n);
      ctx.beginPath();
      ctx.moveTo(sp.xs[i], sp.ys[i]);
      for (let k = i + 1; k <= j; k++) ctx.lineTo(sp.xs[k], sp.ys[k]);
      ctx.lineWidth = 4;
      ctx.stroke();
      i = j;
    }
    // pressure: where the brush presses at harsh turns
    ctx.fillStyle = 'rgba(200,60,40,0.18)';
    for (let k = 0; k < n; k += Math.max(1, Math.round(6 * S.dens))) {
      const t = S.turn[k];
      if (t > 0.35) {
        ctx.beginPath();
        ctx.arc(sp.xs[k], sp.ys[k], 4 + t * 10, 0, 6.283);
        ctx.fill();
      }
    }
    ctx.fillStyle = ink + '0.55)';
    for (let k = 0, st = Math.max(10, Math.round(3 * S.dens)); k < n; k += st) {
      ctx.beginPath();
      ctx.arc(sp.xs[k], sp.ys[k], 1.2, 0, 6.283);
      ctx.fill();
    }
    ctx.strokeStyle = ink + '0.35)';
    ctx.lineWidth = 1;
    const tick = Math.round(40 * S.dens);
    for (let k = 0; k < n; k += tick) {
      ctx.beginPath();
      ctx.moveTo(sp.xs[k], sp.ys[k]);
      ctx.lineTo(sp.xs[k] + sp.nx[k] * 14, sp.ys[k] + sp.ny[k] * 14);
      ctx.stroke();
    }
    ctx.font = '600 24px "Hanken Grotesk",system-ui,sans-serif';
    ctx.fillStyle = ink + '0.85)';
    const lab = (i, t) => {
      const x = clamp(sp.xs[i], 40, F.W - 90),
        y = clamp(sp.ys[i], 50, F.H - 30);
      ctx.fillText(t, x, y);
    };
    lab(Math.min(sp.n - 1, Math.round(25 * S.dens)), 'In');
    lab(Math.max(0, sp.n - Math.round(26 * S.dens)), 'Out');
    ctx.font = '400 20px "Hanken Grotesk",system-ui,sans-serif';
    let lx = 34,
      ly = F.H - 38;
    ctx.fillStyle = ink + '0.8)';
    ctx.fillRect(lx, ly - 8, 26, 6);
    ctx.fillText('Straight', lx + 34, ly);
    lx += 140;
    ctx.fillText('Arc, n/8 turn:', lx, ly);
    lx += 140;
    for (let k = 1; k <= 8; k++) {
      ctx.fillStyle = arcColor(k);
      ctx.fillRect(lx, ly - 8, 26, 6);
      ctx.fillStyle = ink + '0.8)';
      ctx.fillText(k, lx + 30, ly);
      lx += 58;
    }
    ctx.fillStyle = 'rgba(200,60,40,0.35)';
    ctx.beginPath();
    ctx.arc(46, F.H - 80, 9, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = ink + '0.8)';
    ctx.fillText('Brush pressure at turns', 66, F.H - 73);
  }

  /** Route to the right drawing for the current view/style. */
  function draw(ctx, S, o) {
    if (o.view === 'journey') drawJourney(ctx, S, o.progress);
    else if (o.style === 'graphic') drawGraphic(ctx, S, o.progress);
    else if (o.style === 'ink') drawInk(ctx, S, o.progress, o.stride);
    else drawPainterly(ctx, S, o.progress, o.stride);
  }

  BL.render2d = {
    draw,
    offsetAt,
    drawBackground,
    drawPainterly,
    drawGraphic,
    drawInk,
    drawSplash,
    drawJourney,
  };
})((window.BL = window.BL || {}));
