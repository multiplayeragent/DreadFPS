// Shared state, rendering setup, pixel font and asset loading.
import * as THREE from 'three';
export { THREE };

export const CS = 2;                 // world units per map cell
export const LOW_H = 240, BAR = 36;  // internal resolution height / status bar height
export const G = { LW: 427, VH: LOW_H - BAR, time: 0, state: 'loading' };

export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = arr => arr[(Math.random() * arr.length) | 0];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
export function mulberry(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
export function canvasTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- renderer: scene -> low-res target -> palette/dither pass -> canvas ----------
export const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
document.body.appendChild(renderer.domElement);
export const ui = cv(G.LW, LOW_H);
ui.id = 'ui';
document.body.appendChild(ui);
export const ctx = ui.getContext('2d');

export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(80, G.LW / G.VH, 0.05, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);

const rt = new THREE.WebGLRenderTarget(G.LW, G.VH, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, type: THREE.HalfFloatType });
const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
export const postMat = new THREE.ShaderMaterial({
  uniforms: { tDiffuse: { value: rt.texture }, levels: { value: 24 }, tint: { value: new THREE.Vector4() } },
  depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float levels; uniform vec4 tint; varying vec2 vUv;
    const float B[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
    void main(){
      vec3 c = pow(max(texture2D(tDiffuse, vUv).rgb, 0.0), vec3(1.0/2.2));
      c = mix(c, tint.rgb, tint.a);
      ivec2 p = ivec2(mod(gl_FragCoord.xy, 4.0));
      c = floor(c * levels + 0.5 + (B[p.x + p.y * 4] / 16.0 - 0.47) * 0.85) / levels;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
});
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));

export const onResize = [];
export function resize() {
  G.LW = Math.max(240, Math.round(LOW_H * innerWidth / innerHeight));
  G.VH = LOW_H - BAR;
  renderer.setSize(G.LW, LOW_H, false);
  ui.width = G.LW; ui.height = LOW_H;
  ctx.imageSmoothingEnabled = false;
  rt.setSize(G.LW, G.VH);
  camera.aspect = G.LW / G.VH;
  camera.updateProjectionMatrix();
  onResize.forEach(f => f());
}
addEventListener('resize', resize);
// compile every shader the scene needs up front (async where supported), against the same render target we draw into
export function compileScene() {
  renderer.setRenderTarget(rt);
  const p = renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve(renderer.compile(scene, camera));
  renderer.setRenderTarget(null);
  return p;
}
export function renderFrame() {
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.setViewport(0, BAR, G.LW, G.VH);
  renderer.render(postScene, postCam);
}

// ---------- 5x7 bitmap font ----------
const FONT = {
  '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.', '1': '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  '2': '.###.|#...#|....#|...#.|..#..|.#...|#####', '3': '#####|...#.|..#..|...#.|....#|#...#|.###.',
  '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.', '5': '#####|#....|####.|....#|....#|#...#|.###.',
  '6': '..##.|.#...|#....|####.|#...#|#...#|.###.', '7': '#####|....#|...#.|..#..|.#...|.#...|.#...',
  '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.', '9': '.###.|#...#|#...#|.####|....#|...#.|.##..',
  'A': '.###.|#...#|#...#|#####|#...#|#...#|#...#', 'B': '####.|#...#|#...#|####.|#...#|#...#|####.',
  'C': '.###.|#...#|#....|#....|#....|#...#|.###.', 'D': '###..|#..#.|#...#|#...#|#...#|#..#.|###..',
  'E': '#####|#....|#....|####.|#....|#....|#####', 'F': '#####|#....|#....|####.|#....|#....|#....',
  'G': '.###.|#...#|#....|#.###|#...#|#...#|.####', 'H': '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  'I': '.###.|..#..|..#..|..#..|..#..|..#..|.###.', 'J': '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  'K': '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#', 'L': '#....|#....|#....|#....|#....|#....|#####',
  'M': '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#', 'N': '#...#|#...#|##..#|#.#.#|#..##|#...#|#...#',
  'O': '.###.|#...#|#...#|#...#|#...#|#...#|.###.', 'P': '####.|#...#|#...#|####.|#....|#....|#....',
  'Q': '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#', 'R': '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  'S': '.####|#....|#....|.###.|....#|....#|####.', 'T': '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  'U': '#...#|#...#|#...#|#...#|#...#|#...#|.###.', 'V': '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  'W': '#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.', 'X': '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  'Y': '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..', 'Z': '#####|....#|...#.|..#..|.#...|#....|#####',
  '%': '##..#|##..#|...#.|..#..|.#...|#..##|#..##', '/': '....#|....#|...#.|..#..|.#...|#....|#....',
  '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..', '.': '.....|.....|.....|.....|.....|.##..|.##..',
  ':': '.....|.##..|.##..|.....|.##..|.##..|.....', '-': '.....|.....|.....|#####|.....|.....|.....',
  '+': '.....|..#..|..#..|#####|..#..|..#..|.....', "'": '..#..|..#..|.#...|.....|.....|.....|.....',
  '?': '.###.|#...#|....#|...#.|..#..|.....|..#..', ',': '.....|.....|.....|.....|.##..|..#..|.#...',
  '<': '...#.|..#..|.#...|#....|.#...|..#..|...#.', '>': '.#...|..#..|...#.|....#|...#.|..#..|.#...',
  '(': '...#.|..#..|.#...|.#...|.#...|..#..|...#.', ')': '.#...|..#..|...#.|...#.|...#.|..#..|.#...',
};
const FCH = Object.keys(FONT), FIDX = {};
FCH.forEach((c, i) => FIDX[c] = i);
const fontCache = {};
function fontAtlas(color) {
  if (fontCache[color]) return fontCache[color];
  const c = cv(FCH.length * 6, 7), g = c.getContext('2d');
  g.fillStyle = color;
  FCH.forEach((ch, i) => FONT[ch].split('|').forEach((row, y) => { for (let x = 0; x < 5; x++) if (row[x] === '#') g.fillRect(i * 6 + x, y, 1, 1); }));
  return fontCache[color] = c;
}
export const textW = (s, sc = 1) => String(s).length * 6 * sc - sc;
export function drawText(s, x, y, color, sc = 1, align = 'left', shadow = '#000', g = ctx) {
  s = String(s).toUpperCase();
  const w = textW(s, sc);
  if (align === 'center') x -= w / 2; else if (align === 'right') x -= w;
  x = Math.round(x); y = Math.round(y);
  const put = (col, ox, oy) => {
    const at = fontAtlas(col);
    for (let i = 0; i < s.length; i++) { const k = FIDX[s[i]]; if (k !== undefined) g.drawImage(at, k * 6, 0, 5, 7, ox + i * 6 * sc, oy, 5 * sc, 7 * sc); }
  };
  if (shadow) { const o = Math.max(1, sc >> 1); put(shadow, x + o, y + o); }
  put(color, x, y);
}

// ---------- assets (produced by art/process.py) ----------
export const ART = { sprites: {}, tex: {}, sky: {}, title: null };
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('failed to load ' + src)); i.src = src; });
export async function loadAssets(progress) {
  const m = await (await fetch('assets/manifest.json')).json();
  const jobs = [];
  let done = 0, total = 0;
  const add = p => { total++; jobs.push(p.then(v => { done++; progress && progress(done / total); return v; })); };
  // sprite frames are packed into atlas PNGs; slice each frame back out into its own canvas
  const atlases = m.atlases.map(f => { const p = loadImg('assets/' + f); add(p); return p; });
  for (const [name, frames] of Object.entries(m.sprites)) {
    ART.sprites[name] = frames.map(fr => {
      const o = { w: fr.w, h: fr.h, ax: fr.ax, img: null, tex: null };
      jobs.push(atlases[fr.a].then(sheet => {
        const c = cv(fr.w, fr.h);
        c.getContext('2d').drawImage(sheet, fr.x, fr.y, fr.w, fr.h, 0, 0, fr.w, fr.h);
        o.img = c;
        o.tex = canvasTex(c);
      }));
      return o;
    });
  }
  for (const [name, f] of Object.entries(m.textures)) add(loadImg('assets/' + f).then(img => {
    const t = new THREE.Texture(img);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestMipmapLinearFilter;
    t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
    ART.tex[name] = t;
  }));
  for (const [name, f] of Object.entries(m.skies)) add(loadImg('assets/' + f).then(img => {
    const t = new THREE.Texture(img);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
    ART.sky[name] = t;
  }));
  if (m.title) add(loadImg('assets/' + m.title).then(img => { ART.title = img; }));
  await Promise.all(jobs);
}
