# Bezier Life · v3.2

A generative artwork. Each visitor enters a **name**, a **birth date** and a **birth time**. These
become a unique seed, and the seed decides one continuous brush stroke: its journey across the canvas,
its brush character, its colours and its lighting. The visitor's Chinese **five element (五行)** sets
the palette, and a **TIME** slider (±10 years) slowly reshapes the same stroke.

## Studio interface

This edition preserves the Geo Art / The Silence interface: locally bundled Cormorant Garamond, paper/tint/dark/system appearance, responsive three-column layout, and expandable Studio controls. The v3.2 engine is imported from the OPUS reference without algorithm changes. Choose a spine family in Studio controls, or leave “From the seed” selected.

## What changed in v3.2: rebel strands

**What happens.** 2–4% of the sub-strokes stop following the stroke at their own **rebellion point** (15–85% along the journey) and run a path of their own. The sub-strokes are the Ink bristles, the Graphic lines and the Painterly bristles.

**How a rebel leaves.** It departs smoothly, from the same position and heading.
- For about 120 units it still bends with the stroke.
- Then it swerves out to its own side and wanders on its own curvature.
- It thins out and ends after 300–1,200 units.
- The seed decides which strands rebel, where, how far they run and how they wander (streams `/rebels/<style>`).

**Per style:**
- **Ink.** The bristle carries its ink away, reads a little bolder, and tapers to nothing.
- **Graphic.** In 2D the line follows its own path; in 3D its tube continues from the exact point where it left. A piece has about 0–1 rebel lines (9–24 lines × 2–4%).
- **Painterly 3D.** The shader hides the bristle on the ribbon after its rebellion point. It continues as its own thin lit tube in the bristle's colour, which also casts shadows, and appears in the reveal animation once the stroke reaches it.

**Code.** `makeRebels`, `rebelIndex` and `rebelPath` are in `profile.js`.

## What changed in v3.1: spine families

The spine grammar (straights + n/8 arcs) is now driven by a **spine family** studied from reference paintings (`js/model/archetypes.js`):

| Family | Studied from | Character |
|---|---|---|
| Knot 結 | v1–v3.0 default | approach, a dense knot, departure |
| Scroll 卷 | teal & violet ribbons | wide open C / U sweeps that reverse |
| Drape 垂 | blue wave | one long falling sweep, almost no loops |
| Serpent 蛇行 | grooved knot | big loops stacked in a column, alternating |
| Meander 蜿蜒 | green contours | many small alternating bends |
| Vortex 漩 | white on blue column | tight same-way swirls rising in a column |
| Switchback 折返 | violet ribbon | long side-to-side sweeps with hairpin turns |
| Glyph 字 | olive calligraphy | a short gesture: a drop, a loop, a flick |
| Hook 鉤 | black & white on linen | a long sweep into one big closed loop |

**What each family sets.** A family is a set of planner parameters:
- how often straights appear, and their lengths;
- arc sizes (n) and radii;
- the chance that the next arc turns the other way: S-curves, or the same way for coils;
- the pull toward a knot;
- a corridor (a column) and an axis, which also decides the entry and exit edges;
- a preference for sideways sweeps;
- the journey length.

**How the seed picks a variant.** The seed picks the main family, a second family and a blend of 0–35% of the second. It then jitters every number by up to ±12%, so each visitor gets their own variant, for example "Serpent 蛇行, with a touch of Drape 垂".

**Strict families keep their shape across TIME.** Serpent, Switchback and Vortex rarely change arc sizes when the TIME futures mutate, so they stay recognisable.

**Spine family picker.** The panel has a picker. "From the seed" is the default; choosing a family forces the main family, while the blend and jitter still come from the seed. This is meant for curation and testing. In code it is `BL.planner.forceFamily`.

**Results.** On test seeds, 2–4 of every 4 pieces per family pass all checks at the first good attempt; the rest use the best of 60 attempts. No sharp bends were introduced (sharpest turn ≤ ~32°).

## What changed in v3.0: Life journeys (TIME = a life that drifts)

In v1–v2.4, TIME only stretched one fixed journey a little. In v3.0, every TIME gives **the same beginning and a different life**: the stroke starts identically, and the further it travels, the further it drifts from the other years. By ±10 years the knots, the loops and the exit edge are all different. Moving the slider (or letting time drift) shows the change happening gradually.

**How it works:**
- **Planning** (`planner.planLife`):
  - **Shared start.** The prologue, the first 3–6% of the journey, is planned once.
  - **The φ = 0 future.** It is planned from there like a v1 journey: knot, exit, homing.
  - **Other years.** Futures for the other years are a chain of small mutations, one anchor year every 1.25 years out to ±10 (17 futures). Each step changes 3–4 segments of its neighbour: a turn wider or tighter, a loop one eighth longer or shorter, a straight longer or shorter. There are no flips of turn direction, which would swing everything after them at once.
  - **In-frame check.** Every mutation is checked to stay in the frame.
- **Drawing** (`spine.buildLifeSpine`):
  - The futures are blended with Catmull-Rom weights across the anchor years, by curvature along the arc length.
  - The spine is then integrated from the shared start point and heading, and eased as in v2.3.
  - It is extended straight until it has surely left the frame. That run-out is never trimmed, so nothing jumps when the end crosses an edge.
- **Stroke profile.** Width and twist keyframes are now spaced by arc length (every 170 units), because segments differ between futures.
- **Journey view.** It draws all the anchor futures faintly, labelled with their year, so you can see the spread.

**Checks.** `planner.evaluate` checks 17 TIME values for frame margins, and that no run-out comes back into the frame. On 20 test seeds:
- Every genome passed.
- At −10 versus +10, the second half of the journey lies 200–2,100 units apart, and the exit edge usually differs.
- The visible stroke moves at most about 50–175 units per 0.05 years of TIME.

**Settings.** `BL.planner.MODE = 'life'`. Set it to `'classic'` to get the v2.4 journey behaviour back.

## What changed in v2.4: hand tremor

- **Gentle sideways wobble.** Every strand now wobbles slightly sideways, in all three styles, so lines can be shaky and bumpy while their direction still changes smoothly.
- **Added after the v2.3 smoothing.** The tremor is applied after `smoothOffsets`. Its amplitude is at most about 3 units over periods of 50–140 units, so every wobble stays a soft curve, never a corner.
- **Each piece has its own steadiness.** The seed sets an amplitude of 0.4–2.2 units. Each strand has its own timing, there is also a shared slow sway, and the tremor drifts slowly with the TIME phase.
  - **Ink:** per bristle; far strands shake 1.6× more.
  - **Graphic:** per line.
  - **Painterly 3D:** the whole ribbon sways, and its edges wobble more than its middle. This is a smooth function across the ribbon, so mesh columns never cross.
- **Code.** `makeTremor` and `tremorAt` are in `profile.js`, with new streams `/tremor/<style>`.
- **Checked.** `kinkReport` shows no new sharp bends.

## What changed in v2.3: smooth bends

Lines no longer bend suddenly. They can still wobble, but every change of direction is gradual. There are four fixes, all applied before drawing:

1. **Eased joints.** Where a straight meets an arc, curvature used to jump from 0 to 1/r. It is now blurred over about 45 units and the spine rebuilt from it, so every joint gets a short easing curve. Each segment still turns by the same total amount. (`spine.js`: `easeCurvature`, `SMOOTH_JOINT`)
2. **Soft inner limit.** On the inside of a tight arc, bristles used to be clamped hard to the radius, which made a corner where the arc began. They are now compressed smoothly, and stay within 70% of the radius. (`softOffset`, `INNER_LIMIT`)
3. **Eased offsets.** Each bristle's or line's distance from the spine is eased into and out of every squeeze over about 60 units, so it never has to move sideways quickly. (`smoothOffsets`) This is used by Ink bristles, Graphic lines (2D and 3D) and every column of the Painterly 3D ribbon.
4. **Last guards.** Ink bristle paths get a final light smoothing of about 3 units. The Ink width now uses rounded versions of `abs` and `min`, which had made corners where the ribbon turned edge-on.

**Check it yourself.** `BL.diagnostics.kinkReport(piece)` reports the sharpest turn of the spine and of the Ink bristles over 3 units, and counts turns above 30°. On 12 test seeds the sharpest turn went from:
- Ink bristles: up to 173° in v2.2 → at most about 33° in v2.3.
- Graphic lines: up to 150° → about 34°.

The few turns that remain above 30° are smooth tight curves, not corners. To loosen or tighten the smoothing, change `SMOOTH_JOINT`, `INNER_LIMIT` and the `blurLen` of `smoothOffsets`.

## What changed in v2.2

- **The 3D cast shadow fades in.** Over the first 900 units of the journey the shadow grows gradually instead of starting as a solid dark block. This applies to both the backdrop shadow and the stroke's shadow on itself, in Painterly and Graphic. The length is the `SHADOW_FADE` constant in `render3d.js`.

## What changed in v2.1

- **Ink splashes are built from tiny specks.** A large drop is made of many tiny specks: they merge into a solid pool in the middle, stay grainy at the rim, and a few land just past the edge. Drops keep the same positions as in v2.0, because the specks come from a separate stream (`/splash/<i>/grain`).

## What changed in v2.0

**1. Bristle layout** (`BL.profile.makeLayout`, used by all three styles).
- **Core.** A dense core of bristles or lines covers the stroke body.
- **Far strands.** The rest form satellite bundles and single strays further out, so some strands run close to the body and some far away.
- **Splay.** Every strand splays in and out along the journey. The rhythm is shared, but each strand follows it with its own timing (`lag`).

**2. Per-bristle timing.**
- Each bristle or line has its own fade points and its own thick–thin control (`laneThick`). They follow the peers' rhythm, but at different times.
- **Ink** reads the stroke's ink level with each bristle's own time lag.
- **Painterly 3D** reads the paint load the same way, with lag in the shader. Its bristles also narrow and widen on their own, opening and closing gaps.

**3. Ink has no shared wash any more.**
- v1 laid a solid ink fill under all the bristles, and when it ran out every bristle stopped at the same point. That produced the straight cuts across the stroke.
- Now every bristle is drawn on its own, from per-bristle arrays computed in `styles.inkAt → inkLanes`.

**Compatibility.** The new layout uses new random streams (`/layout/<style>`), so v1 streams are untouched. Even so, pieces look different from v1 for the same seed: keep v1 to reproduce v1 pieces. The version is in `js/core/version.js` and in saved file names.

## Run it

Open `index.html` in a recent desktop browser (Chrome, Edge, Firefox or Safari).
- **No build step and no server.** Double-clicking the file works, because the scripts are classic `<script>` files rather than ES modules.
- **Offline.** three.js and fflate are bundled in `vendor/`. Cormorant Garamond is bundled locally in `fonts/`, including its SIL Open Font License.
- **WebGL2 needed for 3D.** The 3D styles need WebGL2. Without it, Painterly and Graphic are drawn flat.

## Folder structure

```
index.html              page markup + script order
css/styles.css          page styles (light/dark tokens; --piece is set by JS)
vendor/three.min.js     three.js r149 (MIT): 3D rendering
vendor/fflate.umd.js    fflate 0.8.2 (MIT): zlib for the PNG encoder
js/core/
  version.js            BL.version (stored in file names; bump when the art changes)
  math.js               clamp, lerp, smooth, sleep
  random.js             seeded PRNG streams, SHA-256, smooth noise
  color.js              colour helpers (rgb arrays, HSL, palette jitter)
  frame.js              logical frame (F.W × F.H), formats 3:4 / 1:1 / 4:3, frame edges
js/model/
  five-elements.js      birth moment → day master → element → palette (20 palettes)
  archetypes.js         spine families from reference paintings; seed picks + blends + jitters
  spine.js              segment grammar (straight + n/8 arcs), exact sampler, edge fit
  planner.js            journey planner: entry/exit sides, approach → knot → departure
  profile.js            width, twist, paint load, brush pressure, bristle dropout
  styles.js             genomes for Painterly / Graphic / Ink, 3D depth and lights
  piece.js              a piece = genome + expression at time φ (buildPiece, computeAt)
js/render/
  render2d.js           Canvas 2D: Ink, Journey view, flat fallbacks
  render3d.js           three.js: lit ribbon / tubes, custom GLSL, shadows
js/export/
  png-stream.js         streaming PNG encoder (band by band)
  export.js             tiled rendering up to 8192 px → PNG Blob
js/app/
  seed.js               inputs → seed string → SHA-256 master; "A life A moment"
  diagnostics.js        kinkReport(): finds sudden bends in drawn paths
  main.js               UI controller: form, controls, render loop, saving
```

Every file attaches its public functions to one global namespace, `window.BL`, for example
`BL.random.makeRng` or `BL.piece.computeAt`. Files must load in the order listed in `index.html`.

## Pipeline

```
name + date + time
   │  BL.seed.createSeed()                      seedString = "name|YYYYMMDD|HHMM"
   ▼                                            master = SHA-256(seedString)
master  +  reading (BL.fiveElements)            reading → palette
   │  BL.piece.buildPiece(master, reading)      GENOME (fixed by seed + format)
   │     planner → journey (segments, entry/exit sides)
   │     profile, styles, depth, light → keyframes, bristles, colours
   ▼
piece
   │  BL.piece.computeAt(piece, {phi, style, density})   EXPRESSION at time φ
   │     spine samples, width/twist/paint, pressure, depth, style data
   ▼
render2d.draw() / render3d.renderGL()   on screen
exporter.renderLarge()                  PNG up to 8192 px
```

### Determinism rules

1. **No `Math.random()` in the artwork.** All randomness comes from `BL.random.makeRng(master + '/<name>')`.
   - Each subsystem has its own named stream (`/spine/<attempt>`, `/profile`, `/palette`, `/graphic`, `/ink`, `/depth`, `/light`, `/splash/<i>` …).
   - Adding a new stream does not change existing pieces. Changing how an existing stream is consumed does.
2. **Anything that varies with TIME uses smooth noise.** It goes through `tn(T, channel, index)` from `BL.random`, so the same φ always gives the same image, and nearby φ give nearby images.
3. **The only non-deterministic code is `BL.seed.randomMoment()`.** It just fills the form ("A life A moment").
4. **The format changes the genome.** The journey is re-planned for the 3:4, 1:1 or 4:3 frame. Store the format with a piece if you need it reproduced exactly.

To reproduce a piece exactly, you need: **master** (or name + date + time), **format**, **style**,
**φ**, and the **code version**. Keep old versions of this folder when you change the algorithms.

## Five elements (五行)

- **Day master (日主).** This is the heavenly stem of the birth day's pillar. The day index is `(JDN + 49) mod 60`, where 0 = 甲子. It is verified against 1949-10-01 = 甲子 and 2000-01-01 = 戊午.
- **Late-night births.** From 23:00, the 子 hour belongs to the next day.
- **Stem → element.** 甲乙 Wood · 丙丁 Fire · 戊己 Earth · 庚辛 Metal · 壬癸 Water.
- **Palette.** Each element has 4 palettes. The index is yang/yin of the day stem combined with born by day (卯–申, 05:00–17:00) or by night:
  - 0 = yang, day
  - 1 = yang, night
  - 2 = yin, day
  - 3 = yin, night
- **Palette fields.** `bg, glow, light, mid, dark, accent, paper, ink`. Each visitor gets the palette with a small seeded shift in hue and lightness.
- **Limits.** The birth time is used as entered: there is no time-zone or true-solar-time correction, and the month and year pillars are not computed.

## Backend integration

**Seed (identical on any platform):**

```js
// Node
crypto.createHash('sha256').update(`${name}|${yyyymmdd}|${hhmm}`, 'utf8').digest('hex')
```
```python
# Python
hashlib.sha256(f"{name}|{yyyymmdd}|{hhmm}".encode("utf-8")).hexdigest()
```

The name is normalized first: trimmed, inner spaces collapsed to single spaces, Unicode NFC (see `BL.seed.normName`).
The shareable code is `'BL-' + master.slice(0, 10)`. It identifies the piece without revealing the birthday.

**Hooks in `js/app/main.js`** (search for `BACKEND`):
- **`onPieceCreated(seed)`** — called once per new piece, with `{inputs, seedString, master, code, reading}`. It also fires a `bezierlife:piece` DOM event.
- **`deliver(blob, filename)`** — receives the saved PNG. It currently downloads the file; replace or extend it to upload instead.

**Rendering without the UI** (e.g. headless Chrome / Puppeteer for server-side images):

```js
BL.frame.setAspect('1:1');
const seed  = await BL.seed.createSeed({ name: '陳志明', date: '1977-07-03', time: '02:04' });
const piece = BL.piece.buildPiece(seed.master, seed.reading);
BL.render3d.init(document.createElement('canvas'));            // for Painterly / Graphic in 3D
BL.piece.computeAt(piece, { phi: 0, style: 'painterly', density: 3 });
const { blob } = await BL.exporter.renderLarge(piece, { longSide: 8192 });
```

**Things to note:**
- **Personal data.** The inputs (name + birth date and time) are personal data. Prefer storing `master`, the reading and the code rather than the raw inputs.
- **Export cost.** An 8K export is CPU and GPU heavy: 10–60 s depending on hardware, with PNG sizes of roughly 20–150 MB.

## Extending

- **New palette.** Add or edit entries in `PALETTES` (`js/model/five-elements.js`).
- **New brush style.** Add a genome function and a per-φ data function in `styles.js`, compute the data in `piece.js → computeAt`, then add a drawing in `render2d.js` and/or a mesh in `render3d.js → syncGL`, plus a radio button in `index.html`.
- **Planner feel.** Segment probabilities and radii live in `randomSeg()`, and the scoring weights in `planOnce()` (`planner.js`).
- **Bristle spacing and strands.** These are set in `makeLayout()` (core share, satellite reach, splay) and `laneThick()` in `profile.js`.
- **Brush detail (3D).** The GLSL strings `STROKE_DRY` / `STROKE_MAIN` are in `render3d.js`.

## Licences

three.js and fflate are MIT licensed (see their headers in `vendor/`). Cormorant Garamond is bundled under the SIL Open Font License (see `fonts/OFL.txt`).
