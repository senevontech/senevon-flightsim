// Evaluated in the page by tools/shot.mjs: samples rAF frame times for 6 s, returns stats as JSON.
(async () => {
  const sk = window.__skyward;
  document.querySelector(".menu .primary, #startBtn, button.primary")?.click();
  await new Promise((r) => setTimeout(r, 1500));
  const t = [];
  let prev = performance.now();
  await new Promise((done) => {
    const end = prev + 6000;
    const f = (now) => { t.push(now - prev); prev = now; now < end ? requestAnimationFrame(f) : done(); };
    requestAnimationFrame(f);
  });
  t.sort((a, b) => a - b);
  const avg = t.reduce((a, b) => a + b, 0) / t.length;
  const info = sk.scene.renderer.info.render;
  return JSON.stringify({
    frames: t.length, fps: +(1000 / avg).toFixed(1), p50: +t[t.length >> 1].toFixed(1),
    p95: +t[Math.floor(t.length * 0.95)].toFixed(1), max: +t[t.length - 1].toFixed(1),
    calls: info.calls, tris: info.triangles, px: sk.scene.renderer.getPixelRatio(), perf: sk.scene.perf,
    size: [innerWidth, innerHeight], heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
  });
})()
