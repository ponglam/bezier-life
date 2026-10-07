/**
 * Bezier Life — 3D renderer (three.js r149, WebGL2)
 * js/render/render3d.js
 *
 * The stroke as a lit 3D ribbon floating in a void.
 * - Painterly: one ribbon mesh (ACROSS segments wide). MeshPhysicalMaterial with
 *   injected GLSL: bristle colour lanes, dry-brush discard, per-bristle dropout,
 *   and an analytic bump gradient for bristle grooves (crisp at 8K).
 *   A matching depth material makes the dry gaps cast correct shadows.
 * - Graphic: one tube mesh per line, vertex-coloured.
 * - Ribbon frame: T along spine, N in picture plane, B toward viewer;
 *   twist θ turns the ribbon width between N (face-on) and B (edge-on).
 * - Lights: warm key (shadow-casting), cool rim, fill, hemisphere; a backdrop
 *   plane with the background texture + a ShadowMaterial plane for the floating shadow.
 * API: init(canvas) → GL | null, get(), syncGL(S), renderGL(S, progress), disposePiece(S), setupRenderer(r)
 * Requires window.THREE (vendor/three.min.js).
 */
(function (BL) {
  'use strict';
  const { clamp, smooth } = BL.math;
  const { tn, timeCoord, vnoise } = BL.random;
  const { tremorAt, rebelIndex, rebelPath } = BL.profile;
  const { mix, css } = BL.color;
  const { LANES } = BL.styles;
  const { dropTh, layoutReach } = BL.profile;
  const { makeRng } = BL.random;
  const { drawBackground } = BL.render2d;
  const F = BL.frame;

  const FOV = 20,
    ZBACK = 380,
    ACROSS = 22;
  let GL = null;
  /** Shared renderer settings (sRGB output, ACES tone mapping, PCF shadows). */
  function setupRenderer(r) {
    r.outputEncoding = THREE.sRGBEncoding;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.95;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
  }
  /** Create the WebGL2 renderer and scene on `canvas`. Returns null when WebGL2 is unavailable. */
  function init(canvas) {
    if (!window.THREE) return null;
    try {
      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        powerPreference: 'high-performance',
      });
      if (!renderer.capabilities.isWebGL2) {
        renderer.dispose();
        return null;
      }
      setupRenderer(renderer);
      const scene = new THREE.Scene(),
        camera = new THREE.PerspectiveCamera(FOV, 1, 10, 40000);
      const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.6);
      scene.add(hemi);
      const key = new THREE.DirectionalLight(0xffffff, 1.7);
      key.castShadow = true;
      key.shadow.mapSize.set(4096, 4096);
      key.shadow.bias = -0.0006;
      key.shadow.normalBias = 0.6;
      key.shadow.radius = 3;
      scene.add(key);
      scene.add(key.target);
      const rim = new THREE.DirectionalLight(0xffffff, 0.9);
      scene.add(rim);
      const fill = new THREE.DirectionalLight(0xffffff, 0.25);
      scene.add(fill);
      const bgMat = new THREE.MeshBasicMaterial({ toneMapped: false });
      const bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMat);
      scene.add(bg);
      const shPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShadowMaterial({ opacity: 0.13 })
      );
      shPlane.receiveShadow = true;
      scene.add(shPlane);
      const group = new THREE.Group();
      scene.add(group);
      GL = {
        renderer,
        scene,
        camera,
        hemi,
        key,
        rim,
        fill,
        bg,
        bgMat,
        shPlane,
        group,
        meshes: [],
      };
      return GL;
    } catch (e) {
      console.warn(e);
      return null;
    }
  }
  /** Camera so the z = 0 plane fills the frame; backdrop and shadow planes; shadow camera bounds. */
  function frameScene() {
    const { camera, bg, shPlane, key } = GL,
      th = Math.tan((FOV * Math.PI) / 360),
      D = F.H / 2 / th;
    camera.aspect = F.W / F.H;
    camera.position.set(0, 0, D);
    camera.lookAt(0, 0, 0);
    camera.near = 10;
    camera.far = D + ZBACK * 4;
    camera.updateProjectionMatrix();
    const bh = 2 * (D + ZBACK) * th * 1.02,
      bw = (bh * F.W) / F.H;
    bg.scale.set(bw, bh, 1);
    bg.position.z = -ZBACK;
    shPlane.scale.set(bw, bh, 1);
    shPlane.position.z = -ZBACK + 1;
    const ext = 0.85 * Math.max(bw, bh),
      sc = key.shadow.camera;
    sc.left = -ext;
    sc.right = ext;
    sc.top = ext;
    sc.bottom = -ext;
    sc.near = 1;
    sc.far = 9000;
    sc.updateProjectionMatrix();
  }
  /** Position and colour the lights for the piece at its current φ and style. */
  function lightsAt(S) {
    const { key, rim, fill, hemi } = GL,
      LR = S.light,
      T = { seed: S.G.timeSeed ^ 0x1b873593, x: timeCoord(S.phi) };
    const a = LR.a + 0.25 * tn(T, 70, 0),
      d = new THREE.Vector3(Math.cos(a), Math.sin(a), LR.kz).normalize();
    key.position.copy(d).multiplyScalar(3000);
    key.intensity = LR.keyI;
    key.color.setRGB(...LR.warm.map((x) => x / 255)).convertSRGBToLinear();
    rim.position.set(-d.x, -d.y, -0.5).multiplyScalar(3000);
    rim.intensity = LR.rimI;
    fill.position.set(0.2, -1, 1).multiplyScalar(3000);
    if (S.style === 'graphic') {
      key.shadow.bias = -0.002;
      key.shadow.normalBias = 1.4;
    } else {
      key.shadow.bias = -0.0006;
      key.shadow.normalBias = 0.6;
    }
    const pal = S.style === 'graphic' ? { l: S.GG.line, d: S.GG.bg } : { l: S.pal.light, d: S.pal.dark };
    rim.color.setRGB(...pal.l.map((x) => x / 255)).convertSRGBToLinear();
    hemi.color.setRGB(...pal.l.map((x) => x / 255)).convertSRGBToLinear();
    hemi.groundColor.setRGB(...pal.d.map((x) => x / 255)).convertSRGBToLinear();
  }
  /** Backdrop texture (2048 px, dithered so it does not band at 8K). */
  function makeBgTexture(S) {
    const cw = 2048,
      ch = Math.round((2048 * F.H) / F.W),
      cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    const c = cv.getContext('2d');
    c.setTransform(cw / F.W, 0, 0, cw / F.W, 0, 0);
    if (S.style === 'graphic') {
      c.fillStyle = css(S.GG.bg);
      c.fillRect(0, 0, F.W, F.H);
      const g = c.createRadialGradient(F.W / 2, F.H / 2, 0, F.W / 2, F.H / 2, Math.max(F.W, F.H) * 0.75);
      g.addColorStop(0, 'rgba(255,255,255,0.06)');
      g.addColorStop(1, 'rgba(0,0,0,0.12)');
      c.fillStyle = g;
      c.fillRect(0, 0, F.W, F.H);
    } else drawBackground(c, S.pal);
    // fine dither so smooth gradients don't band when enlarged to 8K
    const id = c.getImageData(0, 0, cw, ch),
      d = id.data,
      R = makeRng(S.master + '/dither');
    for (let i = 0; i < d.length; i += 4) {
      const e = (R.next() - 0.5) * 3;
      d[i] += e;
      d[i + 1] += e;
      d[i + 2] += e;
    }
    c.putImageData(id, 0, 0);
    const t = new THREE.CanvasTexture(cv);
    t.minFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.encoding = THREE.sRGBEncoding;
    return t;
  }
  const STROKE_PARS = `
uniform sampler2D uLanes;uniform sampler2D uLaneMap;uniform sampler2D uLaneGeo;uniform float uSeed;uniform float uFray;uniform float uBump;uniform float uLaneCount;uniform float uDropTh;uniform float uVMax;uniform float uLoadExp;uniform float uLoadMin;uniform float uShadowFade;uniform sampler2D uLaneRebel;
varying vec4 vStroke;
float h1(float n){return fract(sin(n*12.9898+uSeed)*43758.5453);}
float vn1(float x,float lane){float i=floor(x),f=fract(x);f=f*f*(3.0-2.0*f);return mix(h1(i+lane*157.0),h1(i+1.0+lane*157.0),f);}
vec3 perturbNormalArb2(vec3 surf_pos,vec3 surf_norm,vec2 dHdxy,float faceDir){
  vec3 vSigmaX=dFdx(surf_pos.xyz),vSigmaY=dFdy(surf_pos.xyz),vN=surf_norm;
  vec3 R1=cross(vSigmaY,vN),R2=cross(vN,vSigmaX);float fDet=dot(vSigmaX,R1)*faceDir;
  vec3 vGrad=sign(fDet)*(dHdxy.x*R1+dHdxy.y*R2);return normalize(abs(fDet)*surf_norm-vGrad);}
`;
  /* v2: bristles are laid out by the layout (core + far strands), not evenly across the ribbon.
     uLaneMap (1D, across v) says which bristle covers this v (255 = none → transparent);
     uLaneGeo holds each bristle's centre, half width and own timing (lag). */
  const STROKE_DRY = `
float vv=vStroke.x,sArc=vStroke.y,uu=vStroke.z;
float laneId=texture2D(uLaneMap,vec2(vv/uVMax*0.5+0.5,0.5)).r*255.0;
if(laneId>254.5) discard;                                    // gap between bristles
float lane=floor(laneId+0.5);
if(sArc>texture2D(uLaneRebel,vec2((lane+0.5)/uLaneCount,0.5)).r+25.0) discard;   // v3.2: this bristle has left (see rebel tubes)
vec4 LG=texture2D(uLaneGeo,vec2((lane+0.5)/uLaneCount,0.5));  // centre, half width, lag, far
float lf=(vv-(LG.x-LG.y))/(2.0*LG.y);                         // 0…1 across this bristle
// own thick–thin timing: the bristle narrows and widens, opening gaps that close again
float th=mix(0.74,0.35,LG.w)+mix(0.26,0.65,LG.w)*vn1(sArc/180.0+LG.z*1.7,lane+900.0);
if(abs(lf-0.5)*2.0>th) discard;
vec4 LT=texture2D(uLanes,vec2((lane+0.5)/uLaneCount,0.5));
float cap=LT.a*1.25;
// paint load read with this bristle's own time lag, so bristles run out at different points
float ld=max(uLoadMin,1.0-pow(clamp(uu+LG.z*0.05,0.0,1.0),uLoadExp));
float dn=0.7*vn1(sArc/26.0,lane)+0.3*vn1(sArc/9.0,floor(lf*4.0)+lane*4.0+500.0);   // fibres break at different places
float dr=smoothstep(uDropTh-0.03,uDropTh+0.08,vn1(sArc/(140.0+280.0*h1(lane*5.3)),lane+700.0));   // this bristle runs dry on its own
float paint=ld*cap*dr-dn*0.55;
if(paint<0.0) discard;
if(uu>1.0-uFray*(0.03+0.09*h1(lane*7.7))-LG.z*0.01) discard;
`;
  const STROKE_MAIN =
    STROKE_DRY +
    `
vec3 laneCol=pow(LT.rgb,vec3(2.2));
// analytic bump gradient (no 2x2 derivative blocks): rounded bristle, fine fibres, impasto edges of the core
float bw=2.0*LG.y;
float aa=clamp(1.0-fwidth(vv/bw)*2.0,0.0,1.0),aa2=clamp(1.0-fwidth(vv*4.0/bw)*2.5,0.0,1.0);
float amp=(0.6+0.4*h1(lane*3.1))*mix(0.15,1.0,aa);
float dHdv=(3.14159*cos(lf*3.14159)*amp+0.3*4.0*3.14159*cos(fract(lf*4.0)*3.14159)*aa2)/bw;
float av=abs(vv),te=clamp((av-0.80)/0.18,0.0,1.0)*step(av,1.05);
dHdv+=1.6*6.0*te*(1.0-te)/0.18*sign(vv);
float s0=sArc*0.03;float dHds=0.45*(vn1(s0+0.05,lane)-vn1(s0,lane))/0.05*0.03;
vec2 dHdxy=(dHdv*vec2(dFdx(vv),dFdy(vv))+dHds*vec2(dFdx(sArc),dFdy(sArc)))*uBump;
laneCol*=(0.88+0.24*vn1(sArc*0.015,lane+33.0))*mix(0.8,1.0,clamp(paint*3.0,0.0,1.0));
if(!gl_FrontFacing) laneCol*=0.6;
`;
  /* v2.2: the cast shadow fades in along the journey instead of starting as a solid dark block.
     The shadow map is on/off per texel, so the depth pass drops a growing share of texels
     (stable interleaved-gradient dither in shadow-map space) over the first SHADOW_FADE units of
     arc length; the PCF shadow filter blurs that dither into a smooth ramp. The shadow map is
     rendered once per export and reused by every tile, so tiles stay seamless. */
  const SHADOW_FADE = 900; // logical units of journey over which the shadow fades in
  const SHADOW_FADE_GLSL = (s) => `
float shF=smoothstep(0.0,uShadowFade,${s});shF*=shF;
float ign=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(0.06711056,0.00583715))));
if(ign>shF) discard;
`;
  /** Depth material for the Graphic tubes (shadow casting only), with the same fade-in. */
  function makeLineDepthMat() {
    const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    dm.onBeforeCompile = (sh) => {
      sh.uniforms.uShadowFade = { value: SHADOW_FADE };
      sh.vertexShader =
        'attribute float aS;\nvarying float vS;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvS=aS;');
      sh.fragmentShader =
        'uniform float uShadowFade;\nvarying float vS;\n' +
        sh.fragmentShader.replace(
          '#include <clipping_planes_fragment>',
          '#include <clipping_planes_fragment>\n' + SHADOW_FADE_GLSL('vS')
        );
    };
    dm.customProgramCacheKey = () => 'bezier-line-depth';
    return dm;
  }
  /** Painterly material: MeshPhysicalMaterial + injected GLSL (lanes, dry brush, dropout, bump). */
  function makeStrokeMat(S) {
    const pal = S.pal,
      data = new Uint8Array(LANES * 4);
    pal.lanes.forEach((L, j) => {
      data[j * 4] = clamp(L.c[0], 0, 255);
      data[j * 4 + 1] = clamp(L.c[1], 0, 255);
      data[j * 4 + 2] = clamp(L.c[2], 0, 255);
      data[j * 4 + 3] = clamp((L.cap / 1.25) * 255, 0, 255);
    });
    const tex = new THREE.DataTexture(data, LANES, 1, THREE.RGBAFormat);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    // v2: bristle geometry (centre, half width, lag, far) and the across-ribbon map
    const Lay = pal.layout,
      VM = (S.vmax = layoutReach(Lay) * 1.02);
    const geo = new Float32Array(LANES * 4);
    Lay.lanes.forEach((L, j) => {
      geo[j * 4] = L.v0;
      geo[j * 4 + 1] = 0.5 * Lay.spacing * L.w * (L.far ? 0.8 : 1.15);
      geo[j * 4 + 2] = L.lag;
      geo[j * 4 + 3] = L.far ? 1 : 0;
    });
    const geoTex = new THREE.DataTexture(geo, LANES, 1, THREE.RGBAFormat, THREE.FloatType);
    geoTex.magFilter = geoTex.minFilter = THREE.NearestFilter;
    geoTex.needsUpdate = true;
    const MAPN = 4096,
      map = new Uint8Array(MAPN).fill(255);
    for (let i = 0; i < MAPN; i++) {
      const v = ((i + 0.5) / MAPN) * 2 * VM - VM;
      let best = 255,
        bd = 1e9;
      Lay.lanes.forEach((L, j) => {
        const d = Math.abs(v - L.v0);
        if (d < geo[j * 4 + 1] && d < bd) {
          bd = d;
          best = j;
        }
      });
      map[i] = best;
    }
    // v3.2: arc length where each bristle rebels (1e9 = never); updated per TIME in syncGL
    const rebelTex = new THREE.DataTexture(
      new Float32Array(LANES * 4).fill(1e9),
      LANES,
      1,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    rebelTex.magFilter = rebelTex.minFilter = THREE.NearestFilter;
    rebelTex.needsUpdate = true;
    const mapTex = new THREE.DataTexture(map, MAPN, 1, THREE.RedFormat, THREE.UnsignedByteType);
    mapTex.magFilter = mapTex.minFilter = THREE.NearestFilter;
    mapTex.needsUpdate = true;
    const m = new THREE.MeshPhysicalMaterial({
      roughness: 0.5,
      metalness: 0,
      clearcoat: 0.3,
      clearcoatRoughness: 0.35,
      side: THREE.DoubleSide,
    });
    const uni = {
      uLanes: { value: tex },
      uSeed: { value: (pal.drySeed >>> 0) % 997 },
      uFray: { value: S.P.fray },
      uBump: { value: 0.9 },
      uLaneCount: { value: LANES },
      uDropTh: { value: (dropTh(pal.dropFrac) + 1) / 2 },
      uLaneMap: { value: mapTex },
      uLaneGeo: { value: geoTex },
      uVMax: { value: VM },
      uLoadExp: { value: S.P.loadExp },
      uLoadMin: { value: S.P.loadMin },
      uShadowFade: { value: SHADOW_FADE },
      uLaneRebel: { value: rebelTex },
    };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader =
        'attribute vec4 aStroke;\nvarying vec4 vStroke;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvStroke=aStroke;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + STROKE_PARS)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + STROKE_MAIN)
        .replace(
          'vec4 diffuseColor = vec4( diffuse, opacity );',
          'vec4 diffuseColor = vec4( laneCol, opacity );'
        )
        .replace(
          '#include <normal_fragment_maps>',
          '#include <normal_fragment_maps>\nnormal=perturbNormalArb2(-vViewPosition,normal,dHdxy,faceDirection);'
        );
    };
    m.customProgramCacheKey = () => 'bezier-stroke';
    m.userData.tex = tex;
    m.userData.extra = [geoTex, mapTex, rebelTex];
    m.userData.rebelTex = rebelTex;
    const dm = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      side: THREE.DoubleSide,
    });
    dm.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uni);
      sh.vertexShader =
        'attribute vec4 aStroke;\nvarying vec4 vStroke;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvStroke=aStroke;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + STROKE_PARS)
        .replace(
          '#include <clipping_planes_fragment>',
          '#include <clipping_planes_fragment>\n' + STROKE_DRY + SHADOW_FADE_GLSL('sArc')
        );
    };
    dm.customProgramCacheKey = () => 'bezier-stroke-depth';
    m.userData.depth = dm;
    return m;
  }
  /* Shared ribbon frame: T along the spine, N in the picture plane, B toward the viewer.
   Twist θ turns the ribbon width between N (face-on) and B (edge-on). */
  function ribbonFrame(S, k, f) {
    const { sp, z } = S,
      n = sp.n,
      k0 = Math.max(0, k - 1),
      k1 = Math.min(n - 1, k + 1);
    let tx = sp.xs[k1] - sp.xs[k0],
      ty = -(sp.ys[k1] - sp.ys[k0]),
      tz = z[k1] - z[k0];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    const nx = sp.nx[k],
      ny = -sp.ny[k];
    let bx = -tz * ny,
      by = tz * nx,
      bz = tx * ny - ty * nx;
    if (bz < 0) {
      bx = -bx;
      by = -by;
      bz = -bz;
    }
    const bl = Math.hypot(bx, by, bz) || 1;
    bx /= bl;
    by /= bl;
    bz /= bl;
    const c = S.pr.cth[k],
      s = S.pr.sth[k];
    f.nx = nx;
    f.ny = ny;
    f.bx = bx;
    f.by = by;
    f.bz = bz;
    f.c = c;
    f.s = s;
    f.snx = -nx * s + bx * c;
    f.sny = -ny * s + by * c;
    f.snz = bz * c; // ribbon surface normal
    f.ax = nx * c + bx * s;
    f.ay = ny * c + by * s;
    f.az = bz * s; // ribbon width direction
    f.X = sp.xs[k] - F.W / 2;
    f.Y = F.H / 2 - sp.ys[k];
    f.Z = z[k];
    return f;
  }
  const { smoothOffsets } = BL.spine; // v2.3: offsets eased into tight arcs (see spine.js)
  /** Painterly ribbon mesh: (samples × (across + 1)) grid with aStroke = (v, arc length, u, paint load). */
  function buildRibbonGeom(S, across) {
    const { sp, pr } = S,
      n = sp.n,
      A = across + 1,
      cup = S.depth.cup,
      VM = S.vmax || 1,
      f = {};
    const pos = new Float32Array(n * A * 3),
      st = new Float32Array(n * A * 4),
      idx = new Uint32Array((n - 1) * across * 6);
    // v2.3: in-plane offset of every mesh column, eased into and out of tight arcs
    const cols = [];
    for (let j = 0; j < A; j++) {
      const v = VM * (-1 + (2 * j) / across),
        raw = new Float32Array(n);
      for (let k = 0; k < n; k++) raw[k] = v * pr.hw[k] * pr.cth[k];
      cols.push(smoothOffsets(sp, raw));
    }
    // v2.4 hand tremor: the whole ribbon sways a little and its edges wobble more than its middle
    // (a smooth function of v, so neighbouring columns never cross)
    const Tr = S.pal.tremor,
      tx = timeCoord(S.phi);
    for (let k = 0; k < n; k++) {
      const s = sp.u[k] * sp.len,
        sway = tremorAt(Tr, 0, s, tx),
        edge = tremorAt(Tr, 1, s, tx);
      for (let j = 0; j < A; j++) {
        const v = -1 + (2 * j) / across;
        cols[j][k] += sway + 0.8 * edge * v * Math.abs(v);
      }
    }
    for (let k = 0; k < n; k++) {
      ribbonFrame(S, k, f);
      const hw = pr.hw[k],
        u = sp.u[k],
        sArc = u * sp.len,
        ld = pr.load[k];
      for (let j = 0; j < A; j++) {
        const v = VM * (-1 + (2 * j) / across),
          ip = cols[j][k],
          op = v * hw * f.s,
          cu = cup * hw * (Math.min(v * v, 1.4) - 0.33);
        const o = (k * A + j) * 3;
        pos[o] = f.X + f.nx * ip + f.bx * op + f.snx * cu;
        pos[o + 1] = f.Y + f.ny * ip + f.by * op + f.sny * cu;
        pos[o + 2] = f.Z + f.bz * op + f.snz * cu;
        const q = (k * A + j) * 4;
        st[q] = v;
        st[q + 1] = sArc;
        st[q + 2] = u;
        st[q + 3] = ld;
      }
    }
    let t = 0;
    for (let k = 0; k < n - 1; k++)
      for (let j = 0; j < across; j++) {
        const a = k * A + j,
          b = a + A;
        idx[t++] = a;
        idx[t++] = b;
        idx[t++] = a + 1;
        idx[t++] = a + 1;
        idx[t++] = b;
        idx[t++] = b + 1;
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aStroke', new THREE.BufferAttribute(st, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.userData.step = across * 6;
    return g;
  }
  /** sRGB 0–255 → linear 0–1. */
  function lin(c) {
    return c.map((x) => Math.pow(clamp(x, 0, 255) / 255, 2.2));
  }
  /** Graphic tube mesh for one line (ring stride keeps 10× density within memory). */
  function buildLineGeom(S, li, radial) {
    const { sp, GG, gfx } = S,
      L = GG.lines[li],
      g = gfx[li],
      R = radial + 1,
      f = {};
    const step = Math.max(1, Math.round(S.dens / 3)),
      ks = [];
    for (let k = 0; k < sp.n; k += step) ks.push(k);
    if (ks[ks.length - 1] !== sp.n - 1) ks.push(sp.n - 1);
    const n = ks.length;
    const pos = new Float32Array(n * R * 3),
      arc = new Float32Array(n * R),
      nor = new Float32Array(n * R * 3),
      col = new Float32Array(n * R * 3),
      idx = new Uint32Array((n - 1) * radial * 6);
    const front = lin(L.col),
      back = lin(mix(L.col, GG.bg, 0.45)),
      bg = lin(GG.bg);
    // v3.2 rebel: the 3D point where it leaves the stroke; after that it follows its own 2D path
    const kr = g.rebelFrom;
    let C3 = null;
    if (kr < sp.n) {
      const fr = ribbonFrame(S, kr, {}),
        opr = g.ctr[kr] * fr.s;
      C3 = [fr.X + fr.nx * g.ip[kr] + fr.bx * opr, fr.Y + fr.ny * g.ip[kr] + fr.by * opr, fr.Z + fr.bz * opr];
    }
    for (let ki = 0; ki < n; ki++) {
      const k = ks[ki];
      ribbonFrame(S, k, f);
      const ctr = g.ctr[k],
        ip = g.ip[k], // smoothed in-plane offset (see styles.graphicAt)
        op = ctr * f.s,
        r = g.w[k] * 0.5;
      let cx = f.X + f.nx * ip + f.bx * op,
        cy = f.Y + f.ny * ip + f.by * op,
        cz = f.Z + f.bz * op;
      const rebel = C3 && k >= kr;
      if (rebel) {
        cx = C3[0] + (g.cx[k] - g.cx[kr]);
        cy = C3[1] - (g.cy[k] - g.cy[kr]);
        cz = C3[2];
      }
      const cc = mix(bg, f.c >= 0 || rebel ? front : back, 0.06 + 0.94 * g.f[k]);
      for (let j = 0; j < R; j++) {
        const an = (2 * Math.PI * j) / radial,
          ca = Math.cos(an),
          sa = Math.sin(an);
        // ring basis: the ribbon's width and normal, or for a rebel its own path normal and the view axis
        const dx = rebel ? g.pnx[k] * ca : f.ax * ca + f.snx * sa,
          dy = rebel ? -g.pny[k] * ca : f.ay * ca + f.sny * sa,
          dz = rebel ? sa : f.az * ca + f.snz * sa,
          o = (ki * R + j) * 3;
        pos[o] = cx + dx * r;
        pos[o + 1] = cy + dy * r;
        pos[o + 2] = cz + dz * r;
        nor[o] = dx;
        nor[o + 1] = dy;
        nor[o + 2] = dz;
        arc[ki * R + j] = sp.u[k] * sp.len;
        col[o] = cc[0];
        col[o + 1] = cc[1];
        col[o + 2] = cc[2];
      }
    }
    let t = 0;
    for (let k = 0; k < n - 1; k++)
      for (let j = 0; j < radial; j++) {
        const a = k * R + j,
          b = a + R;
        idx[t++] = a;
        idx[t++] = b;
        idx[t++] = a + 1;
        idx[t++] = a + 1;
        idx[t++] = b;
        idx[t++] = b + 1;
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aS', new THREE.BufferAttribute(arc, 1)); // arc length, for the shadow fade-in
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.userData.step = radial * 6;
    return geo;
  }
  /** Rebuild meshes (and materials/backdrop when style or format changed) for the piece. */
  /**
   * v3.2 Painterly rebels: each rebel bristle leaves the ribbon (the shader hides it after its
   * rebellion point) and continues as its own thin lit tube along rebelPath, thinning to its end.
   */
  function buildRebelTubes(S) {
    const { sp, pr, pal } = S,
      n = sp.n,
      ds = sp.len / Math.max(1, n - 1),
      Lay = pal.layout,
      tex = S.strokeMat.userData.rebelTex,
      out = [];
    tex.image.data.fill(1e9);
    for (const rb of pal.rebels.list) {
      const kr = rebelIndex(sp, rb);
      if (kr <= 2 || kr >= n - 3) continue;
      tex.image.data[rb.j * 4] = sp.u[kr] * sp.len;
      const L = Lay.lanes[rb.j],
        f = ribbonFrame(S, kr, {});
      const v = L.v0,
        ip = BL.spine.softOffset(sp.k[kr], v * pr.hw[kr] * f.c),
        op = v * pr.hw[kr] * f.s;
      const X0 = f.X + f.nx * ip + f.bx * op,
        Y0 = f.Y + f.ny * ip + f.by * op,
        Z0 = f.Z + f.bz * op;
      const x0 = sp.xs[kr] + sp.nx[kr] * ip,
        y0 = sp.ys[kr] + sp.ny[kr] * ip,
        h0 = Math.atan2(-sp.nx[kr], sp.ny[kr]);
      const own = rebelPath(
        rb,
        x0,
        y0,
        h0,
        ds,
        (i) => sp.k[Math.min(n - 1, kr + i)],
        Math.sign(v) || rb.side
      );
      const r0 = Math.max(0.9, 0.5 * Lay.spacing * L.w * pr.hw[kr] * 1.6),
        radial = 6,
        R = radial + 1,
        m = own.n;
      const pos = new Float32Array(m * R * 3),
        nor = new Float32Array(m * R * 3),
        idx = new Uint32Array((m - 1) * radial * 6);
      for (let i = 0; i < m; i++) {
        const cx = X0 + (own.x[i] - x0),
          cy = Y0 - (own.y[i] - y0),
          cz = Z0 + 25 * vnoise(rb.seed, 71, 0, (i * ds) / 300) * smooth(0, 200, i * ds),
          nxw = -Math.sin(own.h[i]),
          nyw = -Math.cos(own.h[i]),
          r = r0 * own.taper(i);
        for (let j = 0; j < R; j++) {
          const an = (2 * Math.PI * j) / radial,
            ca = Math.cos(an),
            sa = Math.sin(an),
            o = (i * R + j) * 3;
          const dx = nxw * ca,
            dy = nyw * ca,
            dz = sa;
          pos[o] = cx + dx * r;
          pos[o + 1] = cy + dy * r;
          pos[o + 2] = cz + dz * r;
          nor[o] = dx;
          nor[o + 1] = dy;
          nor[o + 2] = dz;
        }
      }
      let t = 0;
      for (let i = 0; i < m - 1; i++)
        for (let j = 0; j < radial; j++) {
          const a = i * R + j,
            b = a + R;
          idx[t++] = a;
          idx[t++] = b;
          idx[t++] = a + 1;
          idx[t++] = a + 1;
          idx[t++] = b;
          idx[t++] = b + 1;
        }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.userData.step = radial * 6;
      const col = new THREE.Color()
        .setRGB(...pal.lanes[rb.j].c.map((c) => clamp(c, 0, 255) / 255))
        .convertSRGBToLinear();
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshPhysicalMaterial({
          color: col,
          roughness: 0.45,
          clearcoat: 0.3,
          clearcoatRoughness: 0.35,
        })
      );
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.userData.ownMaterial = true;
      mesh.userData.startU = sp.u[kr]; // revealed once the main stroke gets there
      out.push(mesh);
    }
    tex.needsUpdate = true;
    return out;
  }
  function syncGL(S) {
    if (!GL || !S) return;
    for (const m of GL.meshes) {
      GL.group.remove(m);
      m.geometry.dispose();
      if (m.userData.ownMaterial) m.material.dispose();
    }
    GL.meshes = [];
    if (S.glStyle !== S.style || S.glAspect !== F.W / F.H) {
      // materials + backdrop per piece and style
      if (GL.bgMat.map) GL.bgMat.map.dispose();
      GL.bgMat.map = makeBgTexture(S);
      GL.bgMat.needsUpdate = true;
      if (S.strokeMat) {
        S.strokeMat.userData.tex.dispose();
        S.strokeMat.userData.extra.forEach((t) => t.dispose());
        S.strokeMat.userData.depth.dispose();
        S.strokeMat.dispose();
        S.strokeMat = null;
      }
      if (S.style === 'painterly') S.strokeMat = makeStrokeMat(S);
      if (!S.lineMat) {
        S.lineMat = new THREE.MeshStandardMaterial({
          vertexColors: true,
          roughness: 0.35,
          metalness: 0,
        });
        S.lineMat.userData.depth = makeLineDepthMat();
      }
      S.glStyle = S.style;
      S.glAspect = F.W / F.H;
      frameScene();
    }
    lightsAt(S);
    if (S.style === 'painterly') {
      const m = new THREE.Mesh(
        buildRibbonGeom(S, Math.round((S.lo ? 12 : ACROSS) * (S.vmax || 1))),
        S.strokeMat
      );
      m.customDepthMaterial = S.strokeMat.userData.depth;
      m.castShadow = m.receiveShadow = true;
      GL.meshes.push(m);
      GL.meshes.push(...buildRebelTubes(S)); // v3.2
    } else {
      for (let li = 0; li < S.GG.lines.length; li++) {
        const m = new THREE.Mesh(buildLineGeom(S, li, S.lo ? 5 : 8), S.lineMat);
        m.customDepthMaterial = S.lineMat.userData.depth;
        m.castShadow = m.receiveShadow = true;
        GL.meshes.push(m);
      }
    }
    GL.meshes.forEach((m) => GL.group.add(m));
    S.glDirty = false;
  }
  /** Render the 3D scene; progress < 1 reveals the stroke along its journey. */
  function renderGL(S, progress) {
    if (S.glDirty) syncGL(S);
    for (const m of GL.meshes) {
      const g = m.geometry,
        cnt = g.index.count,
        st = g.userData.step;
      let p = progress;
      if (m.userData.startU !== undefined) p = clamp((progress - m.userData.startU) / 0.15, 0, 1); // rebels start where they left
      g.setDrawRange(0, p >= 1 ? cnt : Math.floor((cnt * p) / st) * st);
    }
    GL.renderer.render(GL.scene, GL.camera);
  }

  /** Free GPU materials owned by a piece (call before replacing it). */
  function disposePiece(S) {
    if (!S) return;
    if (S.strokeMat) {
      S.strokeMat.userData.tex.dispose();
      S.strokeMat.userData.extra.forEach((t) => t.dispose());
      S.strokeMat.userData.depth.dispose();
      S.strokeMat.dispose();
      S.strokeMat = null;
    }
    if (S.lineMat) {
      S.lineMat.userData.depth.dispose();
      S.lineMat.dispose();
      S.lineMat = null;
    }
  }
  const get = () => GL;

  BL.render3d = {
    init,
    get,
    syncGL,
    renderGL,
    disposePiece,
    setupRenderer,
    frameScene,
  };
})((window.BL = window.BL || {}));
