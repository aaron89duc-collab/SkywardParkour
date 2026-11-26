const { chromium } = require('playwright');
// contact sheet of GLB models: 4 views each (front +z, side +x, top, iso) with size labels
// usage: node devtools/out/glbsheet.cjs <files served under /_preview/> <out.png>
(async () => {
const files = process.argv.slice(2, -1), out = process.argv.at(-1);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1240, height: 330 * files.length } });
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto('http://127.0.0.1:5173/_preview/index.html');
await p.evaluate(async (files) => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const { GLTFLoader } = await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
  document.body.innerHTML = '';
  const loader = new GLTFLoader();
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); r.setSize(300, 300); r.setClearColor(0xdde3ea);
  r.outputColorSpace = THREE.SRGBColorSpace;
  for (const f of files) {
    const row = document.createElement('div'); row.style.cssText = 'width:1240px;height:330px;position:relative;font:15px sans-serif;border-bottom:1px solid #999';
    document.body.appendChild(row);
    const g = await loader.loadAsync('/_preview/' + f);
    const obj = g.scene; const box = new THREE.Box3().setFromObject(obj); const sz = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const lab = document.createElement('div'); lab.style.cssText = 'position:absolute;left:4px;top:2px;z-index:2;background:#fffc;font-weight:bold';
    lab.textContent = `${f.slice(6, 14)}   size x ${sz.x.toFixed(2)}  y ${sz.y.toFixed(2)}  z ${sz.z.toFixed(2)}`; row.appendChild(lab);
    const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2.2)); const d = new THREE.DirectionalLight(0xffffff, 1.5); d.position.set(3, 5, 4); sc.add(d);
    sc.add(obj);
    const views = [[0, 0, 1, 'front (+z)'], [1, 0, 0, 'side (+x)'], [0, 1, 0.0001, 'top (x right, z down)'], [1, 0.8, 1, 'iso']];
    for (const [vx, vy, vz, name] of views) {
      const R = Math.max(sz.x, sz.y, sz.z) * 0.6;
      const cam = new THREE.OrthographicCamera(-R, R, R, -R, -100, 100);
      cam.position.set(c.x + vx * 10, c.y + vy * 10, c.z + vz * 10); cam.lookAt(c);
      r.render(sc, cam);
      const img = document.createElement('img'); img.src = r.domElement.toDataURL(); img.style.cssText = 'width:300px;height:300px;margin:24px 4px 0 4px';
      row.appendChild(img);
      const t = document.createElement('span'); t.textContent = name; t.style.cssText = `position:absolute;left:${8 + views.findIndex((v) => v[3] === name) * 308}px;top:300px`; row.appendChild(t);
    }
    sc.remove(obj);
  }
}, files);
await p.waitForTimeout(800);
await p.screenshot({ path: out, fullPage: true });
await b.close();
})();
