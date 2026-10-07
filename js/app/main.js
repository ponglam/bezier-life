/**
 * Bezier Life — app controller (UI)
 * js/app/main.js
 *
 * Wires the page (index.html) to the engine:
 *   form / "A life A moment" → BL.seed.createSeed → BL.piece.buildPiece → computeAt → render
 * Render loop: requestAnimationFrame only when something changed (reveal animation,
 * live TIME drift, slider drag, resize). 3D styles draw on #gl (three.js), Ink and the
 * Journey view draw on #art (Canvas 2D).
 *
 * BACKEND INTEGRATION POINTS (search for "BACKEND"):
 *   - onPieceCreated(): send/record the seed + reading for a visitor
 *   - deliver():       where saved images go (now: browser download)
 */
(function (BL) {
  'use strict';
  const { clamp, sleep } = BL.math;
  const { css, lumOf } = BL.color;
  const F = BL.frame;
  const { ELEMENTS } = BL.fiveElements;
  const { buildPiece, computeAt, pointCount } = BL.piece;
  const R3 = BL.render3d;

  // ---- DOM ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const canvas = $('art');
  const ctx = canvas.getContext('2d');
  const glCanvas = $('gl');
  const phiEl = $('phi');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- UI state ----------------------------------------------------------------------
  const ui = {
    piece: null, // current piece (see model/piece.js)
    seed: null, // { inputs, master, code, reading }
    view: 'art', // 'art' | 'journey'
    style: 'painterly', // 'painterly' | 'graphic' | 'ink'
    density: 1, // 1 | 2 | 3 | 5 | 10
    exportSize: 8192,
    live: false, // TIME drifts by itself
    liveDir: 1,
    lowQ: false, // fast preview while dragging
    anim: null, // reveal animation { t0, dur }
    busy: false, // typing a random moment or exporting
    raf: 0,
    lastT: 0,
  };
  const use3D = () => !!R3.get() && ui.view === 'art' && ui.style !== 'ink';

  // ---- Layout ------------------------------------------------------------------------
  /** Fit both canvases into the stage at the frame's aspect ratio. */
  function sizeCanvas() {
    const st = $('stage');
    const cs = getComputedStyle(st);
    const aw = st.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const ah = Math.max(260, Math.min(720, window.innerHeight * 0.70));
    const w = Math.max(1, Math.min(aw, (ah * F.W) / F.H));
    const h = (w * F.H) / F.W;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [canvas, glCanvas]) {
      c.style.width = w + 'px';
      c.style.height = h + 'px';
    }
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(canvas.width / F.W, 0, 0, canvas.width / F.W, 0, 0);
    const GL = R3.get();
    if (GL) {
      GL.renderer.setPixelRatio(dpr);
      GL.renderer.setSize(w, h, false);
    }
    request();
  }

  // ---- Rendering ---------------------------------------------------------------------
  function drawEmpty() {
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--field');
    ctx.fillRect(0, 0, F.W, F.H);
  }
  /** Draw one frame. progress 0…1 reveals the stroke; stride > 1 = faster, coarser bristles. */
  function render(progress, stride) {
    const S = ui.piece;
    if (!S) {
      glCanvas.hidden = true;
      canvas.hidden = false;
      drawEmpty();
      return;
    }
    const g = use3D();
    glCanvas.hidden = !g;
    canvas.hidden = g;
    if (g) R3.renderGL(S, progress);
    else
      BL.render2d.draw(ctx, S, {
        view: ui.view,
        style: ui.style,
        progress,
        stride,
      });
  }
  function request() {
    if (!ui.raf) ui.raf = requestAnimationFrame(frame);
  }
  function frame(t) {
    ui.raf = 0;
    if (ui.anim) {
      const p = clamp((t - ui.anim.t0) / ui.anim.dur, 0, 1);
      render(p, 3);
      if (p < 1) ui.raf = requestAnimationFrame(frame);
      else {
        ui.anim = null;
        render(1, 1);
      }
      return;
    }
    if (ui.live && ui.piece) {
      const dt = ui.lastT ? Math.min(0.05, (t - ui.lastT) / 1000) : 0;
      ui.lastT = t;
      let ph = ui.piece.phi + ui.liveDir * dt * 0.6; // 0.6 years per second
      if (ph > 10) {
        ph = 10;
        ui.liveDir = -1;
      }
      if (ph < -10) {
        ph = -10;
        ui.liveDir = 1;
      }
      setPhi(ph, true);
      render(1, 3);
      ui.raf = requestAnimationFrame(frame);
      return;
    }
    render(1, ui.lowQ ? 3 : 1);
  }

  // ---- Piece state -------------------------------------------------------------------
  /** Re-evaluate the piece with the current UI settings. lo = fast preview. */
  function recompute(lo) {
    computeAt(ui.piece, { style: ui.style, density: ui.density, lo });
    updateInfo();
  }
  function setPhi(v, lo) {
    phiEl.value = v;
    $('phiOut').textContent = (v > 0.0049 ? '+' : '') + v.toFixed(1) + ' years';
    if (ui.piece) {
      ui.piece.phi = v;
      recompute(lo);
    }
  }
  /** Rebuild the genome (new seed or new format). */
  function rebuild() {
    R3.disposePiece(ui.piece);
    const phi = ui.piece ? ui.piece.phi : 0;
    ui.piece = buildPiece(ui.seed.master, ui.seed.reading);
    ui.piece.phi = phi;
    recompute(false);
  }

  // ---- Info panel --------------------------------------------------------------------
  /** UI accent colour follows the piece. */
  function pieceColor() {
    const S = ui.piece;
    if (!S) return;
    const pc = ui.style === 'graphic' ? S.GG.accent : ui.style === 'ink' ? S.IG.ink : S.pal.mid;
    document.documentElement.style.setProperty('--piece', css(pc));
    document.documentElement.style.setProperty('--atmo', `color-mix(in srgb, ${css(pc)} 12%, #eae7df)`);
    document.documentElement.style.setProperty('--piece-ink', lumOf(pc) > 0.55 ? '#1E1D2B' : '#FFFFFF');
  }
  function updateInfo() {
    const S = ui.piece;
    if (!S) return;
    const G = S.G;
    const arcs = G.segs.filter((s) => s.type === 'A').length;
    $('journeyInfo').textContent =
      `Enters from the ${F.SIDES[G.entrySide]} and leaves from the ${F.SIDES[G.exitSide]}, in ${G.segs.length} segments ` +
      `(${arcs} arcs, ${G.segs.length - arcs} straights) and ${pointCount(S).toLocaleString('en-US')} points.`;
  }
  function showReading() {
    const rd = ui.seed.reading,
      el = ELEMENTS[rd.element],
      fp = ui.piece.FP;
    $('elChar').textContent = el.zh;
    $('elText').textContent =
      `${rd.yin ? 'Yin' : 'Yang'} ${el.en}, day master ${rd.stem}${el.zh} (day pillar ${rd.dayPillar}), ` +
      `born in the ${rd.hour} hour, by ${rd.night ? 'night' : 'day'}.`;
    $('elPal').textContent = `Palette: ${fp.zh} ${fp.en}`;
    $('elementBox').hidden = false;
    $('seedInfo').innerHTML = `Seed code <strong>${ui.seed.code}</strong>`;
  }

  // ---- Generate ----------------------------------------------------------------------
  async function generate() {
    const inputs = {
      name: $('name').value,
      date: $('date').value,
      time: $('time').value,
    };
    const err = BL.seed.validate(inputs);
    $('err').textContent = err || '';
    if (err) return;
    ui.seed = await BL.seed.createSeed(inputs);
    R3.disposePiece(ui.piece);
    ui.piece = buildPiece(ui.seed.master, ui.seed.reading);
    ui.live = false;
    $('live').checked = false;
    setPhi(0, false);
    pieceColor();
    showReading();
    $('exportBtn').disabled = false;
    onPieceCreated(ui.seed);
    ui.anim = reduceMotion ? null : { t0: performance.now(), dur: 2600 };
    request();
  }

  /** BACKEND: called once per generated piece. Post it to your API here if needed. */
  function onPieceCreated(seed) {
    // e.g. fetch('/api/pieces', { method: 'POST', body: JSON.stringify({ master: seed.master, code: seed.code, reading: seed.reading }) })
    document.dispatchEvent(new CustomEvent('bezierlife:piece', { detail: seed }));
  }

  /** "A life A moment": type a random moment into the form, then generate. */
  async function lifeMoment() {
    if (ui.busy) return;
    ui.busy = true;
    $('moment').disabled = $('gen').disabled = true;
    const m = BL.seed.randomMoment();
    const nm = $('name');
    nm.value = '';
    if (reduceMotion) nm.value = m.name;
    else {
      for (const ch of [...m.name]) {
        nm.value += ch;
        await sleep(55);
      }
      await sleep(160);
    }
    $('date').value = m.date;
    if (!reduceMotion) await sleep(160);
    $('time').value = m.time;
    if (!reduceMotion) await sleep(200);
    await generate();
    $('moment').disabled = $('gen').disabled = false;
    ui.busy = false;
  }

  function setAspect(a) {
    F.setAspect(a);
    sizeCanvas();
    if (ui.seed) rebuild();
    request();
  }

  // ---- Save image --------------------------------------------------------------------
  /** BACKEND: replace or extend to upload the PNG instead of (or as well as) downloading. */
  async function deliver(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 4000);
  }
  async function saveImage() {
    if (!ui.piece || ui.busy) return;
    const btn = $('exportBtn'),
      label = btn.textContent;
    ui.busy = true;
    btn.disabled = true;
    ui.live = false;
    $('live').checked = false;
    try {
      const { blob, OW, OH } = await BL.exporter.renderLarge(ui.piece, {
        longSide: ui.exportSize,
        view: ui.view,
        onProgress: (p) => {
          btn.textContent = `Rendering ${Math.round(p * 100)}%`;
        },
      });
      btn.textContent = 'Saving…';
      await deliver(blob, BL.exporter.filenameFor(ui.piece, OW, OH));
    } catch (e) {
      console.error(e);
      $('saveErr').textContent = 'The image could not be rendered at this size. Try 4K.';
    } finally {
      btn.textContent = label;
      btn.disabled = false;
      ui.busy = false;
      updateInfo();
      request();
    }
  }

  // ---- Events ------------------------------------------------------------------------
  const onRadio = (name, fn) =>
    document
      .querySelectorAll(`input[name=${name}]`)
      .forEach((r) => r.addEventListener('change', (e) => fn(e.target.value)));

  $('form').addEventListener('submit', (e) => {
    e.preventDefault();
    generate();
  });
  $('moment').addEventListener('click', lifeMoment);
  phiEl.addEventListener('input', () => {
    if (!ui.piece) return;
    ui.anim = null;
    ui.lowQ = true;
    setPhi(parseFloat(phiEl.value), true);
    request();
  });
  phiEl.addEventListener('change', () => {
    ui.lowQ = false;
    if (ui.piece) setPhi(parseFloat(phiEl.value), false);
    request();
  });
  $('live').addEventListener('change', (e) => {
    ui.live = e.target.checked;
    ui.lastT = 0;
    ui.anim = null;
    ui.lowQ = false;
    if (!ui.live && ui.piece) setPhi(ui.piece.phi, false);
    request();
  });
  onRadio('view', (v) => {
    ui.view = v;
    request();
  });
  onRadio('style', (v) => {
    ui.style = v;
    if (ui.piece) {
      recompute(false);
      pieceColor();
    }
    request();
  });
  onRadio('density', (v) => {
    ui.density = parseInt(v, 10);
    if (ui.piece) recompute(false);
    request();
  });
  onRadio('aspect', (v) => setAspect(v));
  onRadio('size', (v) => {
    ui.exportSize = parseInt(v, 10);
  });
  $('exportBtn').addEventListener('click', () => {
    $('saveErr').textContent = '';
    saveImage();
  });
  $('theme').addEventListener('change', (e) => {
    document.documentElement.dataset.theme = e.target.value;
  });
  new ResizeObserver(sizeCanvas).observe($('stage'));
  $('date').max = new Date().toISOString().slice(0, 10);

  // ---- Start -------------------------------------------------------------------------
  if (!R3.init(glCanvas)) $('glNote').hidden = false; // no WebGL2: flat fallbacks
  F.setAspect('3:4');
  sizeCanvas();
  lifeMoment();

  BL.app = { ui, generate, lifeMoment, setAspect, render }; // handy for debugging in the console
})((window.BL = window.BL || {}));
