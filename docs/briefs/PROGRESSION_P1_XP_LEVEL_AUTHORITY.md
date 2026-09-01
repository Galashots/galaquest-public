# Progression P1 — XP / Level Authority

> **STATUS: COMPLETE — merged to `main` via PR #53 (`ee2c5e60a29c6c2e6572ad3d0d0b8d36aff33885`).**
> This brief is a historical dispatch record. It no longer authorizes work, and its file-ownership
> and evidence expectations describe the state at dispatch time, not current `main`.

**Task-ID:** `PROG-P1-XP-LEVEL-AUTHORITY`  
**Package size:** **M — Coupled**  
**Worker:** **Claude Execute — single write-worker**  
**Director:** ChatGPT / GalaQuest Production Director  
**Repository:** `Galashots/galaquest-public`  
**Starting product head:** `main@22d83b74b88aa5903bf5997f646db4843987da92`  
**Branch:** `feat/progression-p1-xp-level-authority`  
**Owning product record:** #43 Hero XP, levels, and kid-readable progression  
**Program plan:** `docs/briefs/PROGRESSION_PROGRAM_DECOMPOSITION_V0.md`  
**Governing design:** `docs/product/PROGRESSION_CONTRACT_V0.md`

## Objective

Create the one canonical, shared **XP -> Hero Level** authority and finish the currently partial `xp-earned` durable-fact path so later packages can safely award XP without inventing another counter, formula, persistence path, or recovery law.

At P1 completion:

1. total XP is still derived only from append-only durable facts;
2. a canonical pure progression module turns valid total XP into Hero level/progress state;
3. `xp-earned` is a real store-supported profile fact, not a client-fold-only placeholder;
4. valid XP facts survive server persistence, server->client fact recovery, device->server empty-store recovery, duplicate replay, and reconnect without double counting;
5. malformed/unknown restored facts cannot produce a half-applied profile restore;
6. no gameplay source awards XP yet and no player-facing level UI appears yet.

P1 establishes **authority and durability**, not the first visible level-up experience. That is P2.

## Package contract

`objective -> M -> shared progression + durable profile recovery only -> no player-facing progression -> structural/integration tests -> one implementation checkpoint -> side quests routed out`

This package becomes L or is split if implementation requires a new product-visible surface, combat-stat redesign, broad reward-event/UI work, or a protocol rewrite beyond the existing additive profile-fact shape.

## V0 XP/level law

P1 needs a concrete canonical default so every caller can agree, but this is **tunable v0 data**, not final opening-balance acceptance.

Use a simple integer curve with no low technical cap:

`XP needed to advance from Level L to L+1 = 100 + 50 * (L - 1)`, for `L >= 1`.

Therefore the first thresholds are:

- Level 1 begins at cumulative XP `0`;
- Level 2 begins at `100`;
- Level 3 begins at `250`;
- Level 4 begins at `450`;
- Level 5 begins at `700`.

The purpose of this first law is to provide one monotone, easily tunable authority while preserving the Owner decision that early levels can be fast and later levels lengthen. P2/V1 may re-tune the constants after authored-beat/reward pacing is measured; they must change the same authority rather than add another formula.

The canonical pure module should expose enough information that future UI/server callers do not re-derive level progress independently. Exact function names may follow repo conventions, but one call should be able to answer at least:

- current Hero level;
- cumulative XP at the start of the current level;
- cumulative XP required for the next level;
- XP earned within the current level;
- XP remaining / required within the current level;
- normalized progress for presentation.

For valid internal calls, Level 1 is the floor. Invalid negative/non-finite/non-integer XP must fail or be rejected at the validation boundary rather than silently becoming legitimate progression.

High-level behavior must remain finite/monotone and have no baked-in Level-20 cap. Tests should cover representative levels including at least 20, 100, and 1000.

## Canonical XP fact value

`xp-earned` values are additive integer amounts carried through the existing generic durable-fact `value` field.

Establish **one shared parser/validator** for an XP fact amount and use it wherever XP facts are folded or accepted. Requirements:

- canonical decimal integer representation;
- strictly positive amount for an earned-XP fact;
- safe integer range;
- malformed, negative, zero, fractional, exponential-notation, or overflow values are not progression;
- duplicate eventIds remain idempotent and do not add XP twice.

Do not create a mutable stored XP total or a second server-only XP counter.

## Persistence/recovery requirements

### Store support

`net/rewardStore.mjs` currently refuses `xp-earned` because it is absent from its known award types, while `public/src/progression/facts.js` already recognizes and folds it. P1 must close that split.

The durable store must accept valid `xp-earned` profile facts and return them through the existing `profileFactsFor` shape with eventId/value/origin preserved as applicable.

### Restore safety

The current device->server restore path validates candidates and then applies them one-by-one. P1 must ensure a malformed or business-invalid fact cannot cause earlier facts in the same restore request to persist before the request fails.

Acceptance requirement: **profile restore is all-or-safe** with respect to unexpected apply-time failure. Either the validated accepted set is committed consistently, or a bad request does not leave a partially restored prefix. The worker may choose the smallest implementation consistent with the existing append-only store (for example complete pre-validation plus transactional/batch application), but do not weaken store validation to avoid the problem.

Valid duplicate facts are not errors; replay remains idempotent.

### Wire boundary

`restore-profile` and welcome facts share `decodeProfileFacts`. Preserve one validator for that common shape.

P1 should tighten the boundary enough that a profile-fact `type` outside the canonical profile fact set and a malformed XP amount are rejected/refused before durable write. Do not create a second hand-maintained fact-type list inside the protocol; import/use the pure progression authority where practical.

`origin` remains provenance, not permission. Preserve the existing v0 local-first posture: legitimate same-device restored facts may remain `origin: client`, and P1 is not a cheat-proofing/security redesign.

## Expected file ownership

Expected production write surface:

- **new:** `public/src/progression/levels.js` (or one equivalently narrow pure progression authority);
- `public/src/progression/facts.js`;
- `public/src/net/protocol.js` only as required for canonical profile-fact / XP validation at the existing boundary;
- `net/rewardStore.mjs`;
- `net/gameServer.mjs` only for bounded restore coordination / transaction-safe use;
- targeted tests under `test/`.

A small comment correction in `test/currency-fact-announcement.test.mjs` is permitted if P1 makes its current “xp-earned does not exist anywhere” wording stale while XP still has no live announcement source.

Stop before editing:

- `public/index.html` or player-facing HUD/UI;
- `public/src/combat/**`;
- enemy/world behavior;
- item/gear definitions;
- companion/pet code;
- asset files;
- learning content/runtime;
- live XP-award source handlers unless a tiny test-only fixture is strictly necessary.

If a required fix crosses one of those boundaries, stop and request reforecast.

## Explicitly out of scope

Do **not** implement in P1:

- XP bars, Level text, level-up glow/audio/VFX;
- level-derived HP or Hero damage;
- scalable health UI / replacement of hearts;
- POWER derivation or display;
- any quest, learning, enemy, boss, or exploration XP award;
- combat XP level-gap decay;
- gear XP, gear drops, loot probabilities, rarity, equipment changes;
- movement-speed milestone bonuses;
- the Level-5 special attack;
- pet XP/combat/contribution;
- enemy collection/density/levels/nameplates;
- paid/generated assets;
- anti-cheat/account/server-authority redesign beyond preserving current v0 provenance semantics;
- unrelated cleanup/refactors.

Discoveries in these areas go to the existing program package/Issue or the Director; they do not enter this branch.

## Red-capable / targeted coverage

Before acceptance, add or strengthen tests that would fail on the current fixed point for the actual missing behavior.

At minimum prove:

### Level authority

- 0 XP -> Level 1, 0 progress;
- exact thresholds `100`, `250`, `450`, `700` resolve to Levels 2, 3, 4, 5 respectively;
- one XP below each threshold remains in the prior level;
- progress resets correctly at an exact threshold;
- representative Levels 20, 100, 1000 remain finite and monotone;
- invalid XP input is rejected rather than silently normalized into progression.

### Durable XP facts

- valid `xp-earned` store write succeeds;
- two distinct XP fact ids add;
- replaying the same eventId does not add again;
- persisted facts round-trip through `profileFactsFor` and fold to the same XP;
- client-origin restored XP keeps `origin: client` provenance;
- malformed XP amount is refused/rejected;
- unknown profile-fact type is rejected/refused at the common fact boundary;
- mixed restore containing an apply-time-invalid fact cannot leave a partially applied valid prefix;
- empty-store recovery of valid XP facts restores once and remains stable across a second reconnect/replay.

Prefer testing relationships/invariants over duplicating internal implementation details.

## Acceptance gates

At the exact result head:

1. **Targeted progression/persistence tests — PASS.** New red-capable tests and affected existing profile/reward-store/protocol tests pass.
2. **Required unit gate — PASS:** `node --test test/*.test.mjs`.
3. **Diff hygiene — PASS:** `git diff --check`.
4. **Architecture audit — PASS:** there is one XP->Level law, one XP fact parser/validator, no mutable stored XP total, and no player-facing or combat-stat implementation has leaked into P1.
5. **Recovery audit — PASS:** valid XP survives local/server recovery and malformed restore cannot partially mutate durable state.
6. **Running-game visual gate — N/A for P1.** No intended player-visible change. If the branch accidentally changes visible behavior, that is scope drift and requires reforecast rather than retroactively adding visual acceptance.
7. **Hosted exact-head `unit` — PASS** before merge recommendation.

## Checkpoint plan

**One implementation checkpoint** is sufficient for this M package.

Worker should first establish red tests for the missing store/recovery/level authority, then implement to green. Do not create a sequence of micro-checkpoint PRs.

If the restore atomicity fix unexpectedly requires broad reward-store schema redesign or the level authority requires touching combat/UI to be meaningful, stop at the red/diagnostic checkpoint and report for package reforecast.

## Worker topology and handoff

- Claude Execute is the **only semantic writer** on this branch during P1.
- Director remains read-only while Claude is writing.
- After Claude posts its final worker report and explicitly hands off branch ownership, the Director independently refreshes the PR/head and audits it.
- Director may make only bounded deterministic audit corrections inside the locked P1 scope after handoff, with disclosure and revalidation.
- Terra/Codex does **not** review or write P1 concurrently; its initial experiment is A2 read-only work on a separate lane.

## Authorization envelope

Authorized for Claude Execute after relay:

- work only on `feat/progression-p1-xp-level-authority`;
- implement this P1 brief;
- add/modify tests needed by this package;
- commit and push the branch;
- update the P1 PR with accurate implementation/evidence notes;
- run local tests and gather exact results;
- report any separable side quest without implementing it.

Not authorized:

- merge/close the PR;
- write to `main`;
- force-push/rewrite shared history;
- start P2 or another program package on this branch;
- paid/provider/Meshy work;
- production promotion;
- silent scope expansion.

## Stop / reforecast conditions

Stop and report rather than broaden if:

- refreshed `main` or branch state moves unexpectedly before semantic implementation begins;
- another writer is active on the same branch;
- a protocol version bump appears necessary rather than the existing additive profile-fact shape;
- persistence correctness requires a broad database/schema migration beyond bounded XP/profile recovery;
- a player-facing UI/combat change becomes necessary;
- the proposed v0 XP curve cannot be represented cleanly without a materially different progression model;
- a new Owner decision is genuinely required;
- any asset/provider work appears relevant.

## Side-quest destinations

- P2-visible progression/HUD/stat work -> #43 / P2;
- POWER follow-up -> #41;
- gear/persistence observations beyond XP -> #44 or engineering follow-up as appropriate;
- enemy/combat XP observations -> #47 / R1;
- learning reward observations -> L1 planning under the progression program;
- local-first security/competitive-threat questions -> product candidate only if they become materially relevant;
- low-value cleanup -> leave out.

## Worker report

Return `GQ-WORKER-REPORT v1` with:

- `Task-ID: PROG-P1-XP-LEVEL-AUTHORITY`;
- exact starting branch SHA before semantic edits;
- exact result SHA;
- DONE / BLOCKED / FAILED;
- changed-file summary;
- red-before evidence for at least the store/recovery gap and level authority;
- exact targeted-test results;
- exact full unit result;
- `git diff --check` result;
- explicit proof/description of restore all-or-safe behavior;
- explicit note that no live XP source/UI/combat-stat work was added;
- unresolved/UNKNOWN items;
- confirmation owner-only actions were not performed.