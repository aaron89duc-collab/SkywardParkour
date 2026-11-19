const { chromium } = require('playwright');
(async () => {
  const [,, file, view, out] = process.argv;
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  await page.goto('http://localhost:8765/devtools/viewer.html');
  await page.waitForFunction(() => window.ready);
  const img = await page.evaluate(async ([file, view, process_lod]) => {
    const THREE = window.THREE;
    const g = await loadGLB(file);
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x222222);
    scene.add(new THREE.AmbientLight(0xffffff, 2.5));
    const obj = g.scene; obj.children.forEach(c => c.visible = (process_lod ? /lod1/.test(c.name) : !/lod1/.test(c.name))); scene.add(obj);
    const cam = new THREE.OrthographicCamera(-0.7, 0.7, 1.15, -0.25, 0.01, 10);
    if (view === 'front') { cam.position.set(0, 0, 5); cam.lookAt(0, 0, 0); }
    if (view === 'side') { cam.position.set(5, 0, 0); cam.lookAt(0, 0, 0); }
    if (view === 'top') { cam.position.set(0, 5, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); cam.top = 0.7; cam.bottom = -0.7; cam.updateProjectionMatrix(); }
    // grid lines every 0.1
    const mat = new THREE.LineBasicMaterial({ color: 0xff3366 });
    const pts = [];
    for (let i = -7; i <= 7; i++) { const v = i / 10; if (view==='top') { pts.push(new THREE.Vector3(v, 2, -1), new THREE.Vector3(v, 2, 1), new THREE.Vector3(-1, 2, v), new THREE.Vector3(1, 2, v)); } else if (view==='front') { pts.push(new THREE.Vector3(v, -1, 2), new THREE.Vector3(v, 2, 2)); } else { pts.push(new THREE.Vector3(2, -1, v), new THREE.Vector3(2, 2, v)); } }
    if (view !== 'top') for (let i = -2; i <= 11; i++) { const v = i / 10; if (view==='front') pts.push(new THREE.Vector3(-1, v, 2), new THREE.Vector3(1, v, 2)); else pts.push(new THREE.Vector3(2, v, -1), new THREE.Vector3(2, v, 1)); }
    const lg = new THREE.BufferGeometry().setFromPoints(pts);
    const lines = new THREE.LineSegments(lg, mat); lines.material.transparent = true; lines.material.opacity = 0.45; scene.add(lines);
    const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); r.setSize(800, 800); r.outputColorSpace = THREE.SRGBColorSpace;
    r.render(scene, cam); return r.domElement.toDataURL('image/png');
  }, [file, view, process.env.LOD === '1']);
  require('fs').writeFileSync(out, Buffer.from(img.split(',')[1], 'base64'));
  await browser.close();
})();
