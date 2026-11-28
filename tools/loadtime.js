// Evaluated in the page by tools/shot.mjs (use a short wait): resolves when the loading bar is gone,
// returns the time since navigation (ms) — "load to first flight".
new Promise((done) => {
  const t0 = performance.now();
  const check = () => {
    const el = document.querySelector("[data-k=loading]");
    if (el && el.classList.contains("hidden") && performance.now() > 1500) done(JSON.stringify({ ready: Math.round(performance.now()) }));
    else if (performance.now() - t0 > 90000) done(JSON.stringify({ ready: "timeout" }));
    else setTimeout(check, 50);
  };
  check();
})
