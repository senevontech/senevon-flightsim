// Visual check (MOBILE=1 for phone emulation): node tools/shot.mjs <url> <out.png> [waitSeconds] [width] [height] [js-to-eval-before-shot]
// Launches headless Chrome (SwiftShader; GPU=1 uses the real GPU for timing), loads the page, waits in real time, prints console errors and
// shader compile errors, then saves a screenshot. Run "npm run dev" first. In dev, window.__skyward exposes
// { scene, world, sim, rig } for the eval step. PROFILE=<file> saves a CPU profile (load → shot). URL options: ?quality=low|high&spawn=approach&time=0..4
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [url, out, wait = "25", w = "1280", h = "720", evalJs = ""] = process.argv.slice(2);
const dir = join(process.env.TEMP ?? ".", "skyward-chrome-" + Date.now());
mkdirSync(dir, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--disable-extensions",
  ...(process.env.GPU ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-frame-rate-limit"]
    : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
  `--user-data-dir=${dir}`, `--window-size=${w},${h}`, `--remote-debugging-port=${port}`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break; } catch {}
  await sleep(200);
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); return; }
  if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
    console.log(`[${m.params.type}]`, m.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 1500));
  }
  if (m.method === "Runtime.exceptionThrown") console.log("[exception]", JSON.stringify(m.params.exceptionDetails).slice(0, 1500));
});
await send("Runtime.enable");
await send("Page.enable");
const mobile = !!process.env.MOBILE;
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: mobile ? 3 : 1, mobile,
  screenWidth: +w, screenHeight: +h, screenOrientation: +w > +h ? { type: "landscapePrimary", angle: 90 } : { type: "portraitPrimary", angle: 0 } });
if (mobile) {
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Emulation.setEmitTouchEventsForMouse", { enabled: true, configuration: "mobile" });
  await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36" });
}
if (process.env.PROFILE) { await send("Profiler.enable"); await send("Profiler.setSamplingInterval", { interval: 200 }); await send("Profiler.start"); }
await send("Page.navigate", { url });
await sleep(+wait * 1000);
if (evalJs) {
  const r = await send("Runtime.evaluate", { expression: evalJs, awaitPromise: true });
  console.log("[eval]", JSON.stringify(r?.result?.value ?? r).slice(0, 500));
  if (process.env.EVALOUT && typeof r?.result?.value === "string") {
    writeFileSync(process.env.EVALOUT, Buffer.from(r.result.value, "base64")); // eval returned base64 data
    console.log("eval output saved", process.env.EVALOUT);
  }
  await sleep(4000);
}
if (process.env.PROFILE) {
  const { profile } = await send("Profiler.stop");
  writeFileSync(process.env.PROFILE, JSON.stringify(profile)); // CPU profile from page load to here
  console.log("profile saved", process.env.PROFILE);
}
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log("saved", out);
ws.close();
chrome.kill();
process.exit(0);
