// Plan Laser – vue 3D (three.js, chargée seulement à l'ouverture de la vue).
// Repère : plan (x, y) → monde (x, z) ; la hauteur est l'axe y du monde.
import * as T from './vendor/three-bundle.min.js';

const WALL_T = 0.12;          // épaisseur des murs (m), vers l'extérieur de la pièce
const CUT_H = 1.1;            // hauteur des murs en mode coupe (m)
const GLAZED = { fenetre: 1, baie: 1, portefenetre: 1 };

let view = null;

export function open(container, model, opts = {}) {
  close();
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = T.SRGBColorSpace;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';

  const scene = new T.Scene();
  scene.background = new T.Color(0xeef1f5);
  scene.add(new T.HemisphereLight(0xffffff, 0x8a96a8, 1.6));
  const sun = new T.DirectionalLight(0xffffff, 1.6); sun.position.set(6, 12, 8); scene.add(sun);

  const camera = new T.PerspectiveCamera(50, 1, 0.05, 500);
  const controls = new T.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;  // pas sous le sol

  const mats = {
    wall: new T.MeshStandardMaterial({ color: 0xf2eee7, roughness: 0.92 }),
    floor: new T.MeshStandardMaterial({ color: 0xd8b98c, roughness: 0.8, side: T.DoubleSide }),
    glass: new T.MeshStandardMaterial({ color: 0x86c8ff, roughness: 0.1, transparent: true, opacity: 0.35, depthWrite: false }),
    door: new T.MeshStandardMaterial({ color: 0x9a6a3a, roughness: 0.7 }),
    wallTop: new T.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.9 }),   // dessus des murs, plus foncé
  };

  let group = null;
  view = { renderer, scene, camera, controls, mats, container, raf: 0, ro: null };

  const build = (m, o) => {
    if (group) { scene.remove(group); disposeGroup(group); }
    group = buildModel(m, o, mats);
    scene.add(group);
  };
  const fit = () => {
    const box = new T.Box3().setFromObject(group);
    if (box.isEmpty()) return;
    const c = box.getCenter(new T.Vector3()), s = box.getSize(new T.Vector3());
    const d = Math.max(s.x, s.z, 3) * 1.25;
    controls.target.copy(c);
    camera.position.set(c.x + d * 0.35, c.y + d * 0.95, c.z + d * 0.95);
    controls.update();
  };
  const resize = () => {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  };

  build(model, opts); resize(); fit();
  view.ro = new ResizeObserver(resize); view.ro.observe(container);
  const loop = () => { view.raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); };
  loop();

  return {
    rebuild: (m, o) => build(m, o),
    reset: fit,
    close,
  };
}

export function close() {
  if (!view) return;
  cancelAnimationFrame(view.raf);
  view.ro && view.ro.disconnect();
  view.controls.dispose();
  view.scene.traverse(ob => { if (ob.geometry) ob.geometry.dispose(); });
  Object.values(view.mats).forEach(m => m.dispose());
  view.renderer.dispose();
  view.renderer.domElement.remove();
  view = null;
}

function disposeGroup(g) {
  g.traverse(ob => {
    if (ob.geometry) ob.geometry.dispose();
    if (ob.material && !Array.isArray(ob.material) && ob.material.map) { ob.material.map.dispose(); ob.material.dispose(); }
  });
}

function buildModel(model, opts, mats) {
  const g = new T.Group();
  for (const room of model) {
    const H = room.height;
    const top = opts.cut ? Math.min(H, CUT_H) : H;

    // Sol
    if (room.poly && room.poly.length >= 3) {
      const sh = new T.Shape(room.poly.map(p => new T.Vector2(p.x, p.y)));
      const geo = new T.ShapeGeometry(sh); geo.rotateX(Math.PI / 2);     // (x, y) → (x, 0, y)
      g.add(new T.Mesh(geo, mats.floor));
      // Nom de la pièce
      let cx = 0, cz = 0; room.poly.forEach(p => { cx += p.x; cz += p.y; });
      const label = makeLabel(room.name + (room.area != null ? '\n' + room.area : ''));
      label.position.set(cx / room.poly.length, 0.35, cz / room.poly.length);
      g.add(label);
    }

    // Murs
    for (const w of room.walls) {
      const piece = (a, b, z0, z1, mat, depth = WALL_T, inset = 0) => {
        z1 = Math.min(z1, top); if (b - a < 0.005 || z1 - z0 < 0.005) return;
        const geo = new T.BoxGeometry(b - a, z1 - z0, depth);
        // Faces d'une boîte : +x, -x, +y (dessus), -y, +z, -z → dessus foncé pour les murs
        const mesh = new T.Mesh(geo, mat === mats.wall ? [mat, mat, mats.wallTop, mat, mat, mat] : mat);
        const mid = (a + b) / 2, off = inset + depth / 2;               // centre dans l'épaisseur, côté extérieur
        mesh.position.set(w.x1 + w.ux * mid + w.ox * off, (z0 + z1) / 2, w.y1 + w.uy * mid + w.oy * off);
        mesh.rotation.y = -Math.atan2(w.uy, w.ux);
        g.add(mesh);
      };
      const ops = [...w.openings].sort((p, q) => p.off - q.off);
      let cur = -w.extS;
      for (const o of ops) {
        const a = Math.max(o.off, cur), b = Math.min(o.off + o.w, w.len);
        if (b <= a) continue;
        piece(cur, a, 0, H, mats.wall);                                  // plein de mur avant l'ouverture
        const bottom = Math.max(0, o.sill || 0), upper = Math.min(H, bottom + (o.h || 0));
        if (bottom > 0) piece(a, b, 0, bottom, mats.wall);               // allège
        if (upper < H) piece(a, b, upper, H, mats.wall);                 // linteau
        if (GLAZED[o.type]) piece(a, b, bottom, upper, mats.glass, 0.02, WALL_T / 2 - 0.01);
        if (o.type === 'porte') {                                        // porte fermée (1 ou 2 vantaux)
          const n = o.leaves === 2 ? 2 : 1, lw = (b - a) / n;
          for (let i = 0; i < n; i++) piece(a + i * lw + 0.004, a + (i + 1) * lw - 0.004, 0, upper, mats.door, 0.04, WALL_T / 2 - 0.02);
        }
        cur = b;
      }
      piece(cur, w.len + w.extE, 0, H, mats.wall);
    }
  }
  return g;
}

function makeLabel(text) {
  const lines = text.split('\n'), cv = document.createElement('canvas'), x = cv.getContext('2d');
  cv.width = 512; cv.height = 128 * lines.length;
  x.font = '600 64px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  lines.forEach((l, i) => {
    x.lineWidth = 12; x.strokeStyle = 'rgba(255,255,255,0.9)'; x.strokeText(l, 256, 64 + i * 112);
    x.fillStyle = '#1f2a37'; x.fillText(l, 256, 64 + i * 112);
  });
  const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace;
  const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(1.6, 0.4 * lines.length, 1);
  sp.renderOrder = 10;
  return sp;
}
