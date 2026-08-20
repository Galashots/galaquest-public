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

**Superseded 2026-08-20 by the production director's asset request (§8a).** The earlier direction —
an iron-and-ash industrial guardian whose silhouette was carried by an asymmetrical shoulder beacon
housing and a two-handed maul — is recorded in §8c. The director's direction is now:

A silent guardian of the Old Beacon: weathered by time, bound to the light, clad in nature-worn
armour. Stoic and noble rather than monstrous.

- **Ancient guardian read.** Armour fused with stone, wood and aged metal — grown into, not forged.
- **The head carries the silhouette.** A hooded or helm-like headpiece with **antler growths**. This
  is now the strongest silhouette element and the thing that must survive being 40 px tall.
- **A tattered cloak or tabard** with nature motifs, breaking the outline.
- **No weapon in the character mesh** (§8a negative prompts) — see the open question in §11 about
  what that means for the `attack` clip.
- Silhouette must read clearly at thumbnail scale.

Readability requirement, unchanged and still outranking every aesthetic choice: at gameplay camera
distance (`GAMEPLAY_DISTANCE = 16`, `public/src/review/cameraPresets.js`) a child must read
**"important enemy"** in under a second, and must never confuse it with the wolf or the Keeper.

## 3. Palette and material language

**Superseded 2026-08-20 by §8a.** Previously a cold industrial palette (dark iron / ash stone / aged
timber, one pale-cyan accent, explicitly no warm colours). The director's palette is:

- **Earth tones:** moss green, slate, weathered bronze, deep brown.
- **Inner light:** a subtle **blue-green** glow from the chest, the eyes, and crystal accents.
- **Glowing moss / crystal veins** running through the armour seams — this is what now carries the
  Beacon connection, in place of a physical beacon housing.

Style: **stylized semi-realistic fantasy**, even neutral studio lighting. Not photoreal — the
director's own negative prompts exclude "overly realistic / photoreal". See §11 for the open question
about how this sits beside the shipped low-poly cast.

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

### 8a. CANONICAL — production director's asset request (received 2026-08-20)

This supersedes every earlier wording in this file. Transcribed from the director's brief
"ASSET REQUEST: BEACON WARDEN (2D CONCEPT REFERENCE)".

**Objective.** A cleaned-up, front-facing concept reference image of the Beacon Warden for 2D/3D
production, to be used as the canonical visual reference for Meshy 3D generation.

**Key requirements**
- Full body, front-facing view
- Transparent or pure white background
- Stylized semi-realistic fantasy style, consistent with GalaQuest
- Clean silhouette, clearly readable at small sizes
- No text, no UI, no props or weapons

**Character.** A silent guardian of the Old Beacon — weathered by time, bound to the light, clad in
nature-worn armour.
- Ancient guardian vibe; stoic, noble presence
- Armour fused with stone, wood and aged metal
- Glowing moss / crystal veins through the armour seams
- Hooded or helm-like headpiece with antler growths
- Tattered cloak or tabard with nature motifs
- Earth tones: moss green, slate, weathered bronze, deep brown
- Subtle blue-green inner light from chest, eyes and crystal accents
- Silhouette reads clearly at thumbnail scale

**Style & output.** Stylized semi-realistic fantasy; even neutral studio lighting; full body,
front-facing; transparent or pure white background; high resolution.

**Negative prompts.** No text, logos, watermarks or UI elements. No weapons (swords, staffs, etc.).
No other characters or creatures. No backgrounds, scenery or props. No modern or sci-fi elements. No
overly realistic / photoreal style. No blur, low detail, distortion or extra limbs.

**Deliverable.** One (1) high-quality PNG, front-facing full body, transparent background preferred.

> The example image in the director's brief is labelled **"EXAMPLE REFERENCE (NOT FINAL)"** and is
> therefore *not* the modelling basis. The deliverable PNG still has to be produced.

### 8b. One requirement this lane adds back: strict A-pose

The director's brief specifies "full body, front-facing" but does not state a pose. **The A-pose is
retained as a hard requirement**, for two reasons that are not aesthetic:

1. The task brief that opened this lane names it as required reference format.
2. Meshy's auto-rigger fits a skeleton to the figure in the image. Arms held against the body make
   the shoulder/elbow chain ambiguous and are the usual cause of a bad auto-rig — which would cost a
   re-generation, not a re-render.

So the request sent must add: *strict front-facing A-pose — arms straight, angled down and away from
the body, legs straight and slightly apart, palms facing the viewer.*

### 8c. Superseded wording, kept for the evidence chain

The earlier canonical request (director wording of 2026-08-20, adopted in commit `f099ce5`) specified
a two-handed sealing maul, an asymmetrical shoulder-mounted lantern-cage beacon housing, a cold
iron/ash palette with a single pale-cyan accent and explicitly no cloak, in a stylized **low-poly**
style. It is superseded in full by §8a. Recorded rather than deleted so that a capture or model made
against it can still be identified later.

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
| R1 | 2026-08-20 | production director, relayed by the owner | earlier §8a wording (now §8c) | *not generated* | **superseded** before any image existed |
| R2 | 2026-08-20 | production director asset request, relayed by the owner | §8a + the §8b A-pose line | *not yet generated* | current canonical request; image not produced — see blockers |

No image has been generated, so nothing has been accepted as a modelling basis yet.

---

## 11. Open questions for the production director

Three consequences of the 2026-08-20 asset request that are cheaper to settle now than after credits
are spent. None blocks generating the reference image; all three affect what happens after it.

**1. No weapon in the mesh — confirmed good, but the `attack` clip needs a decision.**
Excluding the weapon actually matches how this repo already ships gear: the hero's sword, shield and
belt lantern are separate GLBs mounted on bones (`attachRigidTier2Gear`, `attachBeltLantern`), never
baked into the body. So a weaponless Warden is the *correct* pipeline shape, not a compromise. The
open part is the G3 encounter: either the `attack` clip reads as an unarmed strike (free), or a maul
ships as a separate mounted prop — **+15 credits and a fit pass** on top of the 35-credit nominal.
Recommend deciding before step 4, because the animation choice depends on it.

**2. "Stylized semi-realistic" beside a low-poly cast.**
The shipped characters are stylized low-poly — the pipeline runbook calls the hero "Toon-Link-class",
the Keeper shipped at 5,258 tri, and iron rule 4 requires judging new work against that established
look. A semi-realistic Warden may read as belonging to a different game when standing next to the
hero. This is the director's call and is adopted as written; flagging it because the cheapest place to
catch a style clash is the reference image, and the most expensive is after rig and animation.
The first hero-and-Warden side-by-side capture is the moment to confirm it.

**3. Antlers, cloak and thumbnail readability.**
Antler growths and a tattered cloak are strong silhouette elements, which is good — but both are also
thin geometry, which is what a 512/1024 recompress and a 40 px gameplay read punish first. Worth
watching specifically at `glb_budget.mjs` time and in the first gameplay-distance capture.

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
