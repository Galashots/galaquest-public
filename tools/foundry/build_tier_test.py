"""Build the one-second tier test as a single self-contained HTML file.

  python tools/foundry/build_tier_test.py <out.html> <tier:label:png> ...

The spec has asked for this test since the proportion lock was written and it has never been run:
"show the children all four tiers at actual size for one second, hide them, and ask which looked
strongest and what changed". Every tier decision so far has been made by two language models and
the owner, which is exactly the wrong panel.

Two things make this an instrument rather than a slideshow. The renders are shown at EXACTLY 90 CSS
pixels, which is the size the hero occupies on the testers' iPads -- scaling to fit a nice big screen
would answer a question nobody asked. And the order is shuffled per run, because a child shown
Tier 1, 2, 3 in order will say the last one is strongest whatever it looks like.

Images are inlined as base64 so the file works over AirDrop, from a mail attachment, or off a USB
stick, with no server and no network.
"""

import base64
import os
import sys

args = sys.argv[1:]
if len(args) < 2:
    sys.exit(__doc__)
out_path, specs = args[0], args[1:]

cards = []
for spec in specs:
    tier, label, png = spec.split(":", 2)
    with open(png, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    size = os.path.getsize(png)
    cards.append({"tier": tier, "label": label, "b64": b64})
    print(f"  tier {tier} '{label}' <- {png} ({size:,} bytes)")

items = ",\n".join(
    f'  {{tier:{c["tier"]}, label:{c["label"]!r}, src:"data:image/png;base64,{c["b64"]}"}}'
    for c in cards
)

html = f"""<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
<title>GalaQuest tier test</title>
<style>
  :root {{ color-scheme: light; }}
  body {{ margin:0; font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
         background:#f4f2ee; color:#2b2b2b; -webkit-text-size-adjust:100%; }}
  main {{ max-width:34rem; margin:0 auto; padding:1.5rem 1.25rem 4rem; }}
  h1 {{ font-size:1.25rem; margin:0 0 .25rem; }}
  p.sub {{ margin:0 0 1.5rem; color:#6b6b6b; font-size:.9rem; }}
  .stage {{ display:flex; align-items:center; justify-content:center;
            height:200px; background:#d8d5d0; border-radius:12px; margin:1rem 0; }}
  /* EXACTLY 90 CSS px. This is the whole point of the test; do not make it bigger. */
  .stage img {{ width:90px; height:90px; image-rendering:auto; }}
  button {{ font:inherit; font-weight:600; padding:.85rem 1.1rem; border-radius:10px;
            border:1px solid #b9b4ac; background:#fff; margin:.25rem .25rem .25rem 0;
            -webkit-tap-highlight-color:transparent; }}
  button.primary {{ background:#3f5c86; color:#fff; border-color:#3f5c86; }}
  button:disabled {{ opacity:.4; }}
  .q {{ margin:1.25rem 0 .5rem; font-weight:600; }}
  ol {{ padding-left:1.2rem; }}
  #log {{ white-space:pre-wrap; font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;
          background:#fff; border:1px solid #ddd8d0; border-radius:10px; padding:.75rem; }}
  .hint {{ color:#6b6b6b; font-size:.85rem; }}
</style>
<main>
<h1>GalaQuest — the one-second test</h1>
<p class="sub">Each armour set is shown for one second at the size it really is in the game.
Shuffled every run.</p>

<div id="phase-intro">
  <p>For the grown-up: sit with one child at a time. Tap <b>Show</b>, let them look for one
  second, then ask the two questions. Do not tell them the tier names or the order.</p>
  <button class="primary" onclick="start()">Start</button>
</div>

<div id="phase-show" hidden>
  <p class="q"><span id="counter"></span></p>
  <div class="stage"><img id="shot" alt=""></div>
  <button class="primary" id="showBtn" onclick="flash()">Show for 1 second</button>
  <button id="nextBtn" onclick="next()" disabled>Next</button>
  <p class="hint">Watch their face, not the screen.</p>
</div>

<div id="phase-ask" hidden>
  <p class="q">Now ask, in this order, and write what they actually say:</p>
  <ol>
    <li>Which one looked the strongest?</li>
    <li>What was different about it?</li>
  </ol>
  <p class="hint">If the answer to 2 is about COLOUR rather than the shield, helmet, shoulders or
  sword, the silhouette investment is wrong and the tier ladder needs rewriting. That is the
  result we are actually testing for.</p>
  <button class="primary" onclick="reveal()">Reveal the order</button>
  <div id="log" hidden></div>
</div>
</main>
<script>
const TIERS = [
{items}
];
let order = [], i = 0;
function shuffle(a) {{ for (let j=a.length-1;j>0;j--) {{ const k=Math.floor(Math.random()*(j+1)); [a[j],a[k]]=[a[k],a[j]]; }} return a; }}
function start() {{
  order = shuffle(TIERS.slice());
  i = 0;
  document.getElementById('phase-intro').hidden = true;
  document.getElementById('phase-show').hidden = false;
  paint();
}}
function paint() {{
  document.getElementById('counter').textContent = `Set ${{i+1}} of ${{order.length}}`;
  const img = document.getElementById('shot');
  img.removeAttribute('src');
  document.getElementById('nextBtn').disabled = true;
  document.getElementById('showBtn').disabled = false;
}}
function flash() {{
  const img = document.getElementById('shot');
  img.src = order[i].src;
  document.getElementById('showBtn').disabled = true;
  setTimeout(() => {{
    img.removeAttribute('src');
    document.getElementById('nextBtn').disabled = false;
  }}, 1000);
}}
function next() {{
  i += 1;
  if (i < order.length) return paint();
  document.getElementById('phase-show').hidden = true;
  document.getElementById('phase-ask').hidden = false;
}}
function reveal() {{
  const log = document.getElementById('log');
  log.hidden = false;
  log.textContent = order.map((t, n) => `shown ${{n+1}}:  Tier ${{t.tier}} — ${{t.label}}`).join('\\n');
}}
</script>
"""

with open(out_path, "w", encoding="utf8") as f:
    f.write(html)
print(f"wrote {out_path} ({os.path.getsize(out_path):,} bytes, self-contained)")
