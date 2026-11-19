const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:8765/devtools/viewer.html');
  await page.waitForFunction(() => window.ready);
  for (const f of ['hero-male','hero-female']) {
  const r = await page.evaluate(async (f) => {
    const THREE = window.THREE;
    const g = await loadGLB('/public/assets/characters/'+f+'.glb');
    const obj = g.scene; const mixer = new THREE.AnimationMixer(obj);
    const bones = {}; obj.traverse(o => { if (o.isBone) bones[o.name.replace('mixamorig','')] = o; });
    const get = (clip, t) => { mixer.stopAllAction(); const a = mixer.clipAction(g.animations.find(c=>c.name===clip)); a.reset().play(); mixer.setTime(t); obj.updateMatrixWorld(true);
      const p = n => { const v = new THREE.Vector3(); bones[n].getWorldPosition(v); return v.toArray().map(x=>+x.toFixed(3)); };
      return { hips: p('Hips'), head: p('HeadTop_End'), lh: p('LeftHand'), rh: p('RightHand'), lf: p('LeftToeBase'), rf: p('RightToeBase') }; };
    return { stand: get('Fall4', 3.55), hang0: get('Hang_and_Climb_Left', 0.0), hangPush: get('Hang_and_Push_with_Foot', 0.1), climbStart: get('climbing_up_wall', 0.0), climbEnd: get('climbing_up_wall', 1.85), run0: get('Running',0) };
  }, f);
  console.log(f, JSON.stringify(r, null, 0));
  }
  await browser.close();
})();
