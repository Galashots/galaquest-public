# Beacon Warden — production brief (A1 asset lane, wave G2–G5)

**Status: BLOCKED before any credit spend. 0 Meshy credits spent.** See
[Execution status](#execution-status--why-no-asset-exists-yet) for the three access blockers. Everything
above that section is the executable plan; nothing in it has been run.

The Beacon Warden is the first fully-shippable new character for the public repo and the mini-boss
the gameplay wave is aimed at:

| Beat | Need |
|---|---|
| G2 | Beacon interaction / breaking the cold seals |
| **G3** | **Beacon Warden encounter — this asset** |
| G4 | Wildwood Blade reward |
| G5 | Blackthorn-gated route opening |

---

## 1. Gameplay role

A corrupted guardian bound to the Old Beacon. It is the first enemy a child meets that is **not**
a wolf: bigger, slower, deliberate, and clearly *important*. It guards the Beacon and must be beaten
(or driven off) for G3 to resolve into the G4 reward.

Readability requirement, which outranks every aesthetic choice below: at gameplay camera distance
(`GAMEPLAY_DISTANCE = 16`, `public/src/review/cameraPresets.js`) a child must read **"important
enemy"** in under a second, and must never confuse it with the wolf or with the Keeper.

## 2. Silhouette — the load-bearing decision

Silhouette first, detail last. The Warden must be identifiable as a black shape.

- **Humanoid, but wrong.** Upright, two arms, two legs — so a child reads "it can fight me" — with
  proportions pushed away from human: heavy shoulders and chest, short neck, long arms, narrow legs.
- **One dominant shape, not a pile.** A single tall asymmetric mass: a **brazier/lantern-cage head or
  shoulder-mounted beacon housing**, cold and unlit. This is the thing that must survive being 40 px
  tall on a tablet.
- **One weapon.** A single long haft (maul or sealing-rod), carried, not dual-wielded. No shield, no
  cape, no chains, no floating debris — every one of those muddies the read at distance.
- **Grounded stance.** Feet apart, weight low. It should look planted, not agile.

Anti-goals, stated so they are not rediscovered in review: no hyper-realism, no skull faces, no
generic demon, no ornate filigree, no clutter that reads as noise at 16 m, and nothing that resembles
protected third-party character IP.

## 3. Palette and material language

Restrained, with the cold-Beacon connection doing the work:

- **Base:** weathered dark iron and ash-grey stone, low saturation.
- **Secondary:** aged timber (ties it to the Wildwood and to the Ironwood gear family).
- **Accent — exactly one:** cold beacon-light, pale cyan/blue-white, used **only** in the beacon
  housing and any seams that read as "the cold fire inside it". This is the colour that says *Beacon*.
- No second accent. No warm accent — warm light belongs to the lantern/hearth vocabulary the game
  already uses for friendly things, and the Warden must not borrow it.

Texture complexity: moderate. Flat stylized blocking with painted edge wear, matching the existing
low-poly cast rather than a PBR showpiece.

## 4. Scale in game

The shipped hero is **1.5 m** (`HERO_HEIGHT_METERS`, `public/src/render/heroPreview.js`).

- **Target Warden height: 2.2 m** (≈1.45× hero). Tall enough to be a threat on sight, short enough to
  stay in frame with the hero at gameplay distance and inside the follow camera's pitch.
- Scale is applied the way `public/src/enemies/wolf.js` already does it (`root.scale.setScalar(...)`),
  **not** baked into the GLB.
- **The 2.2 m figure is a target, not an approval.** It is verified by capturing hero + Warden in the
  same running-game frame and looking, per iron rule 4 — never by trusting this number.

## 5. Rig and animation needs

The Meshy API rigging endpoint returns the same 24 joint names the hero uses
(`docs/pipeline/characters-npcs.md`). That is what makes this lane scriptable — and it is
**necessary but not sufficient**:

> Matching joint names do **not** mean a clip transfers. Keeper v1 → v2 shared all 24 names, the same
> hierarchy and the same joint order, and grafting still re-proportioned the body every frame
> (worst bone-length error 1192.97%). The Warden gets its **own** clips from its **own** rig. No clip
> is ever borrowed from the hero, the Keeper, or the wolf.

Mandatory gates before any clip is accepted:

```bash
node tools/foundry/verify_native_clip.mjs --body warden.glb --clip <candidate>.glb   # strict (vendor default)
node tools/foundry/pose_anatomy.mjs <clip>.glb                                       # anatomy score
```

**Minimum clip set** (in priority order — the first three are required for G3 to be buildable):

| Clip | Why | Priority |
|---|---|---|
| `idle` | It exists in the world before the fight | REQUIRED |
| `walk` | It approaches / repositions | REQUIRED |
| `attack` | The threat is real | REQUIRED |
| `hit` | The child learns their hits land | strongly wanted |
| `death`/`defeat` | G3 resolves into the G4 reward | strongly wanted |

Choose each `action_id` by **measuring** it, never by its library name — the lane has no default clip
on purpose, and the recorded 3-credit lesson is that `Idle` (action 0) is an energetic fidget and
`Idle_02` (action 11) is the worst-scoring standing clip in the library.

## 6. Budget targets

| Metric | Target | Basis |
|---|---|---|
| Triangles | ≤ 8,000 | Keeper shipped at 5,258 tri |
| Shipped GLB | ≤ 900 KB | Keeper 662 KB; wolf 970 KB |
| Texture | 1024 recompress | iron rule 5 (1024 for NPCs/landmarks) |

Raw Meshy output never ships:

```bash
python tools/budget/recompress_glb.py tmp/warden-raw.glb public/assets/enemies/beacon_warden.glb --size 1024 --quality 85
node tools/budget/glb_budget.mjs public/assets/enemies/beacon_warden.glb   # every gate PASS or a written ruling
```

## 7. Credit plan — 35 nominal, 60 ceiling, 500 authorized

Measured lane costs (`docs/pipeline/characters-npcs.md`):

| Step | Cost | Note |
|---|---:|---|
| image-to-3D + texture | 15 | one reference image in |
| rig | 5 | `input_task_id` = the model task |
| animation | 3 / motion | 5 motions = 15 |
| **Nominal total** | **35** | |
| Retry allowance | +25 | one re-gen (15) + up to 3 re-picked clips (9) |
| **Ceiling before stopping to report** | **60** | 12% of the 500 authorized |

The 500-credit cap is **not** the binding constraint — the whole asset is ~7% of it. Discipline rule:
if the model is still wrong after **one** re-generation, stop and fix the *reference image* rather than
buying a third roll. A malformed API request costs nothing, so validate request bodies by sending
them and reading the 400.

---

## 8. Phase 2 — the reference request

### 8a. CANONICAL request — production-director wording (use this one)

Distilled and tightened by the production director (ChatGPT) on 2026-08-20 from the expanded brief in
§8b, and **this is the version to send**. It pins three things §8b left open: the beacon housing is
**asymmetrical and on the shoulder** (not "head or shoulder"), the weapon is specifically a
**two-handed sealing maul**, and the exclusion list adds logos and inset panels.

> Create **one single full-body "Beacon Warden" character reference image** for Meshy image-to-3D:
> strict front-facing A-pose, arms straight angled down and away, legs slightly apart, palms forward,
> centered on a plain light-grey background. Stylized low-poly corrupted guardian: broad
> iron-and-ash-stone torso, short neck, long arms, narrow legs, one long two-handed sealing maul, one
> asymmetrical lantern-cage/beacon housing on the shoulder, weathered dark iron + ash-grey stone +
> aged timber, exactly one cold pale-cyan/blue-white accent inside the beacon housing/seams; no warm
> colors, no cape, no shield, no chains, no scenery, no text, no logos, no multiple views or inset
> panels.

### 8b. Expanded form — design rationale and the same constraints spelled out

Kept because it explains *why* each constraint exists, which is what an operator needs when judging a
returned image or asking for a revision. It satisfies the same required format: single character,
A-pose, no text, no multiple angles, clean background, suitable as a Meshy image-to-3D input.

> Generate one character reference image for a stylized low-poly game.
>
> **Subject:** "Beacon Warden" — a corrupted humanoid guardian bound to a cold, dormant signal beacon.
>
> **Required format — all of these are hard requirements:**
> - ONE single full-body character, centred, filling most of the frame
> - strict **A-pose**: standing, facing directly forward, arms straight and angled down and away from
>   the body, legs straight and slightly apart, palms facing the viewer
> - **no text, no letters, no numbers, no watermark, no logo, no signature**
> - **one view only** — no turnaround, no multiple angles, no side or back view, no inset panels
> - plain flat neutral background (light grey), no scenery, no ground shadow beyond a soft contact shadow
> - even, neutral lighting; no dramatic rim light, no lens flare, no motion blur, no depth of field
>
> **Design:** humanoid but heavier than human — broad shoulders and chest, short neck, long arms,
> narrower legs; planted stance. It carries ONE long two-handed haft weapon (a heavy maul or sealing
> rod). Its head or shoulder carries a lantern-cage / brazier housing that reads as a small beacon,
> currently cold and unlit. No shield, no cape, no chains, no floating debris.
>
> **Materials:** weathered dark iron, ash-grey stone, aged timber. Exactly ONE accent colour — a cold
> pale cyan / blue-white — used only inside the beacon housing and a few seams, as if cold fire lives
> in it. No warm colours.
>
> **Style:** stylized low-poly game character, clean readable shapes, moderate texture detail, chunky
> proportions. Silhouette must stay readable when small. Not photorealistic, not horror-realistic, not
> ornate. Must not resemble any existing franchise character.

Iterate by asking for **one** replacement image with a specific change (e.g. "same character, but the
beacon housing moves to the left shoulder and the head is a plain iron helm"). Never ask for a sheet or
a turnaround — Meshy image-to-3D takes a single view.

Record the resulting image under `tmp/` (gitignored) and log its provenance in the ledger below.

## 9. Phase 3–4 — Meshy execution order

1. Flatten/verify the reference is a single clean view; save as `tmp/warden-flat.png`.
2. **Image-to-3D + texture (15 credits).** Read the balance before and after and record both.
3. **Rig (5 credits)** — `input_task_id` = the step-2 task id.
4. **Animate (3 credits each)** — `idle`, `walk`, `attack`, then `hit`, `death` if the first three pass.
   Measure each with `pose_anatomy.mjs` before buying the next.
5. `verify_native_clip.mjs --body ... --clip ...` in **strict** mode on every arriving clip.
6. `merge_clips.mjs` into the pristine body; recompress to 1024; `glb_budget.mjs` must PASS.
7. Artist's review pass (iron rule 8) — searched references beside running-game captures at gameplay
   **and** inspection scale, front/back/three-quarter, before integration is considered done.

## 10. Credit ledger

Every attempt gets a row, including failures. Balance is read before and after each spend.

| # | Date | Purpose | Credits | Balance before → after | Outcome | Accept/reject reasoning |
|---|---|---|---:|---|---|---|
| — | — | *no attempt has been made* | **0** | — | — | Blocked before any spend — see below |

**Total spent to date: 0 of 500 authorized.**

### Reference image provenance

Every image used as a Meshy image-to-3D input is logged here before it is spent against.

| Ref | Date | Source | Request used | File | Status |
|---|---|---|---|---|---|
| R1 | 2026-08-20 | production director (ChatGPT), relayed by the owner | §8a canonical wording | *not yet generated* | request finalized; image not produced — see blockers |

No image has been generated, so nothing has been accepted as a modelling basis yet.

---

## Execution status — why no asset exists yet

Three independent blockers stop this lane at Phase 2. None is fixable from inside the agent session,
and the agent proxy's own runbook says an egress denial must be reported rather than routed around.

1. **`chatgpt.com` is not reachable.** The production-director conversation cannot be driven from the
   session. `curl` gets `HTTP 403` on the proxy CONNECT; a real Chromium load renders
   `ERR_TUNNEL_CONNECTION_FAILED`. A control request to `api.github.com` succeeds through the same
   proxy, so this is a per-host egress policy denial, not a broken network.
2. **`api.meshy.ai` is not reachable** — identical `ERR_TUNNEL_CONNECTION_FAILED`. No credit can be
   spent even with a key.
3. **No Meshy client exists in this repository, and no key is present.** `docs/pipeline/README.md` and
   `characters-npcs.md` both invoke `tools/meshy/gen_prop.mjs`; that path **does not exist in the
   public repo** (every other tool they cite — `verify_native_clip.mjs`, `merge_clips.mjs`,
   `pose_anatomy.mjs`, `recompress_glb.py`, `glb_budget.mjs` — does). The key is documented to live at
   `.local/meshy/api-key.txt`, which is gitignored and absent here.

**Blocker 3 is a real public-repo defect** independent of this session: the pipeline docs are the
operator runbook for "any competent operator", and they route the only credit-spending step through a
tool the public repo does not contain. Either the generator is ported to `tools/meshy/`, or those
runbook steps are marked private-only. Filed here rather than silently worked around.

### What unblocking looks like

- **Fastest path, no infrastructure change:** the owner runs Phase 2 by hand in the linked ChatGPT
  conversation using the verbatim prompt in §8, drops the resulting PNG into `tmp/`, and the lane
  resumes from Phase 3 — provided a Meshy client and key exist on that machine. This matches how the
  repo already expects ChatGPT collaboration to work: Owner Review Mode
  (`public/src/studio/reviewAnnotations.js`, merged in PR #10) exports a packet *for the owner to carry
  to the ChatGPT subscription* and explicitly "does not call OpenAI or require an API key".
- **Full autonomy path:** allow `chatgpt.com` and `api.meshy.ai` for the session's egress policy, port
  a Meshy client into `tools/meshy/`, and provide the key at `.local/meshy/api-key.txt`.
