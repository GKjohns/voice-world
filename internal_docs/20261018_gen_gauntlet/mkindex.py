"""Builds the cross-loop comparison page (index.html) from each loopN/timings.json + quality.json.
Run: python3 internal_docs/20261018_gen_gauntlet/mkindex.py (add a CHANGED line and quality.json scores per new loop)."""
import json, html, os, re

ROOT = os.path.dirname(os.path.abspath(__file__))
LOOPS = sorted((d for d in os.listdir(ROOT) if re.fullmatch(r'loop\d+', d)), key=lambda d: int(d[4:]))
CHANGED = {
    'loop0': 'Baseline: Haiku draft, gold ghost, Opus refine after a studio shot, light sweep, Sol polish on hero.',
    'loop1': 'One honest build: no ghost or sweep, Opus starts at the spawn, the Haiku draft streams part by part.',
    'loop2': 'One size decided at the spawn for both models, framing on width and depth, three-quarter yaw.',
    'loop3': 'Refine prompt caching, hero reference image in parallel, Opus polish with a 28 s budget, looser landed framing.',
    'loop4': 'Placement by real height, dolly framing from the 8-corner world box, compact refine flags and palette letters, silhouette-first guidance.',
    'loop5': 'Small floating parts snap onto the body (or drop) instead of rejecting the refine; hard 28 s polish deadline (raced timer) and client fetch timeouts.',
}
# Scores from each loop's stills review (baseline.md / changes.md).
QUALITY = json.load(open(os.path.join(ROOT, 'quality.json')))

data = {}
for l in LOOPS:
    p = os.path.join(ROOT, l, 'timings.json')
    if os.path.exists(p):
        data[l] = json.load(open(p))

ids = [r['id'] for r in data['loop0']['results']]


def get(l, pid):
    for r in data.get(l, {}).get('results', []):
        if r['id'] == pid:
            return r
    return None


def s(ms):
    return '—' if ms is None else f'{ms / 1000:.1f}'


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


rows = []
summary = []
for l in LOOPS:
    if l not in data:
        continue
    res = data[l]['results']
    good = [r for r in res if r['tier'] == 'good']
    hero = [r for r in res if r['tier'] == 'hero']
    q = QUALITY.get(l, {})
    qv = [v for v in q.values()]
    summary.append((l, mean([r['timings'].get('draft') for r in res]), mean([r['timings'].get('firstPart') for r in res]),
                    mean([r['timings'].get('recognizable') for r in res]), mean([r['timings'].get('settled') for r in good]),
                    mean([r['timings'].get('settled') for r in hero]), (sum(qv) / len(qv)) if qv else None,
                    data[l]['cost'].get('gatewayUsedDeltaUsd') or data[l]['cost'].get('trackedUsd')))

for pid in ids:
    r0 = get('loop0', pid)
    cells = []
    for l in LOOPS:
        r = get(l, pid)
        if not r:
            cells.append(f'<figure class="cell"><div class="miss">not run</div><figcaption>{l}</figcaption></figure>')
            continue
        t = r['timings']
        q = QUALITY.get(l, {}).get(pid)
        cells.append(f'''<figure class="cell">
  <video src="{l}/{r['video']}" muted autoplay loop playsinline preload="metadata" controls></video>
  <figcaption><b>{l}</b>{f' · <span class="q">{q}/10</span>' if q is not None else ''}<br>
  draft {s(t.get('draft'))} · first {s(t.get('firstPart'))} · 50% {s(t.get('recognizable'))} · settled {s(t.get('settled'))} s<br>
  <span class="dim">{r.get('outcome', '')} · parts {r.get('draftParts')}→{r.get('finalParts')}</span></figcaption>
</figure>''')
    rows.append(f'''<section class="prompt">
  <h2>{html.escape(pid)} <span class="dim">{r0['tier']} · “{html.escape(r0['text'])}”</span></h2>
  <div class="row">{''.join(cells)}</div>
</section>''')


def f1(x):
    return '—' if x is None else f'{x / 1000:.1f}'


trs = ''.join(f'<tr><td><b>{l}</b></td><td>{f1(a)}</td><td>{f1(b)}</td><td>{f1(c)}</td><td>{f1(d)}</td><td>{f1(e)}</td><td>{"—" if q is None else f"{q:.1f}"}</td><td>{"—" if usd is None else f"${usd:.2f}"}</td><td class="what">{html.escape(CHANGED.get(l, ''))}</td></tr>'
              for (l, a, b, c, d, e, q, usd) in summary)

page = f'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gen Gauntlet Loops</title>
<style>
:root {{ --bg:#f7f6f2; --fg:#1d1d1f; --dim:#6b6b70; --card:#ffffff; --line:#e2e0d8; --acc:#b4561f; }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ --bg:#141416; --fg:#ececef; --dim:#9a9aa2; --card:#1e1e22; --line:#2e2e34; --acc:#f0a060; }} }}
:root[data-theme="dark"] {{ --bg:#141416; --fg:#ececef; --dim:#9a9aa2; --card:#1e1e22; --line:#2e2e34; --acc:#f0a060; }}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--bg); color:var(--fg); font:14px/1.45 system-ui,-apple-system,sans-serif; padding:24px 16px 48px; }}
main {{ max-width:1500px; margin:0 auto; }}
h1 {{ font-size:22px; margin:0 0 4px; }}
h2 {{ font-size:16px; margin:28px 0 10px; }}
.dim {{ color:var(--dim); font-weight:400; }}
.wrap {{ overflow-x:auto; border:1px solid var(--line); border-radius:8px; background:var(--card); }}
table {{ border-collapse:collapse; width:100%; font-variant-numeric:tabular-nums; }}
th,td {{ padding:7px 10px; border-bottom:1px solid var(--line); text-align:right; white-space:nowrap; }}
th:first-child,td:first-child,td.what,th.what {{ text-align:left; }}
td.what {{ white-space:normal; min-width:280px; color:var(--dim); }}
tr:last-child td {{ border-bottom:0; }}
.row {{ display:grid; grid-template-columns:repeat({len(LOOPS)},minmax(0,1fr)); gap:10px; }}
.cell {{ margin:0; background:var(--card); border:1px solid var(--line); border-radius:8px; overflow:hidden; }}
.cell video {{ width:100%; display:block; aspect-ratio:16/9; background:#000; }}
.cell figcaption {{ padding:6px 8px 8px; font-size:12px; font-variant-numeric:tabular-nums; }}
.q {{ color:var(--acc); font-weight:600; }}
.miss {{ aspect-ratio:16/9; display:grid; place-items:center; color:var(--dim); }}
@media (max-width:900px) {{ .row {{ grid-template-columns:repeat(2,minmax(0,1fr)); }} }}
@media (max-width:560px) {{ .row {{ grid-template-columns:1fr; }} }}
</style></head><body><main>
<h1>Generation gauntlet, loops 0–{len(LOOPS) - 1}</h1>
<p class="dim">2026-10-18 · 6 prompts, each in a fresh world · times are seconds from pressing Enter · quality is the 0–10 score from each loop's stills review · each loop's own page: {' '.join(f'<a href="{l}/index.html">{l}</a>' for l in LOOPS if l in data)}</p>
<h2>Means per loop</h2>
<div class="wrap"><table>
<tr><th>loop</th><th>draft</th><th>first refined</th><th>50% parts</th><th>settled good</th><th>settled hero</th><th>avg quality</th><th>run $</th><th class="what">what changed</th></tr>
{trs}
</table></div>
{''.join(rows)}
</main></body></html>
'''
open(os.path.join(ROOT, 'index.html'), 'w').write(page)
print('ok', [x[0] for x in summary])
