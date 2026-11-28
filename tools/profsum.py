"""Summarise a CPU profile saved by tools/shot.mjs (PROFILE=...): top functions by self time,
and the longest main-thread busy stretches with what ran in them."""
import json, sys
from collections import defaultdict
prof = json.load(open(sys.argv[1], encoding="utf-8"))
nodes = {n["id"]: n for n in prof["nodes"]}
parent = {}
for n in prof["nodes"]:
    for c in n.get("children", []): parent[c] = n["id"]
def name(n):
    cf = n["callFrame"]; u = cf["url"].split("/")[-1].split("?")[0]
    return f'{cf["functionName"] or "(anon)"} {u}:{cf["lineNumber"]+1}'
self_t = defaultdict(float)
samples, deltas = prof["samples"], prof["timeDeltas"]
t = prof["startTime"]; times = []
for sid, d in zip(samples, deltas):
    t += d; times.append(t)
for i, sid in enumerate(samples):
    dt = (times[i+1] - times[i]) / 1000 if i + 1 < len(times) else 0
    self_t[sid] += dt
by = defaultdict(float)
for sid, v in self_t.items(): by[name(nodes[sid])] += v
total = sum(by.values())
print(f"total sampled {total:.0f} ms")
for k, v in sorted(by.items(), key=lambda x: -x[1])[:int(sys.argv[2]) if len(sys.argv) > 2 else 25]:
    print(f"{v:8.1f} ms  {k}")
# long busy stretches: consecutive non-idle samples
idle = {i for i, n in nodes.items() if n["callFrame"]["functionName"] in ("(idle)", "(program)", "(garbage collector)")}
runs, cur = [], None
for i, sid in enumerate(samples):
    busy = sid not in idle or nodes[sid]["callFrame"]["functionName"] == "(garbage collector)"
    if busy and cur is None: cur = [times[i], defaultdict(float)]
    if busy:
        dt = (times[i+1] - times[i]) / 1000 if i + 1 < len(times) else 0
        # attribute to the top-most app frame (below the root)
        chain, n = [], sid
        while n in nodes: chain.append(n); n = parent.get(n)
        tops = [name(nodes[c]) for c in chain if nodes[c]["callFrame"]["url"] and "node_modules" not in nodes[c]["callFrame"]["url"]]
        cur[1][tops[0] if tops else name(nodes[sid])] += dt
    elif cur is not None:
        runs.append((times[i] - cur[0], cur)); cur = None
runs.sort(key=lambda r: -r[0])
print("\nlongest busy stretches:")
for dur, (start, parts) in runs[:8]:
    top = sorted(parts.items(), key=lambda x: -x[1])[:4]
    print(f"{dur/1000:7.1f} ms at +{(start - prof['startTime'])/1e6:5.1f}s: " + "; ".join(f"{k} {v:.0f}" for k, v in top))
