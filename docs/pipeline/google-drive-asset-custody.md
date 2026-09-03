# Google Drive asset custody and Owner review

Google Drive is GalaQuest's durable custody and review tier for large/raw asset material that should not be committed merely for transport or visual review. **GitHub remains authoritative** for shipped runtime assets, code, machine-readable asset registry/provenance, product decisions, exact-SHA acceptance, and promotion state.

## Canonical active root

There is exactly **one** active GalaQuest asset-pipeline root in Google Drive:

- **`GalaQuest Asset Source Archive / 00_ACTIVE_ASSET_PIPELINE`**
- folder id: `1cFn7mINYrBbfXkGz7qZBsDWHGo9if0k2`
- <https://drive.google.com/drive/folders/1cFn7mINYrBbfXkGz7qZBsDWHGo9if0k2>

The root also contains the human-readable operational mirror:

- **`00_START_HERE - GalaQuest Asset Pipeline`**
- <https://docs.google.com/document/d/1S8rKqAJpQYrBYIwlw53TY2MrEl3W-8pV0sUo_X80FjI/edit>

This checked-in runbook is the durable agent authority. If the Drive `START HERE` document and this file disagree, **this repository file wins** and the Drive mirror should be repaired.

Do not create another GalaQuest asset-pipeline root because a task, agent, worktree, provider export, Downloads folder, or synced local folder is more convenient. If the structure genuinely needs to change, change this runbook and the controlled Drive structure deliberately.

## Controlled structure

```text
00_ACTIVE_ASSET_PIPELINE/
  00_START_HERE - GalaQuest Asset Pipeline

  00_INBOX/
    00_UNSORTED/
    10_PENDING_PROVENANCE/
    20_READY_TO_QUALIFY/

  10_SOURCE_MASTERS/
    10_CHARACTERS/
    20_ENEMIES/
    30_GEAR/
    40_PETS/
    50_PROPS/
    60_ENVIRONMENTS/

  20_PRODUCTION_WORKING/

  30_OWNER_REVIEW/
    00_NEEDS_OWNER_REVIEW/
    90_REVIEWED_ARCHIVE/

  40_GENERATION_INPUTS/
  50_REFERENCE_LIBRARY/
  90_ARCHIVE_LEGACY/
```

### `00_INBOX`

Landing area for newly acquired or user-created source material that has not yet entered controlled production custody.

- `00_UNSORTED` — identity/status not yet established.
- `10_PENDING_PROVENANCE` — asset identity is known but source/licence/provenance is incomplete.
- `20_READY_TO_QUALIFY` — provenance is sufficient to begin technical and visual qualification.

An Inbox file is not an approved source master and is not production-ready merely because it exists here.

### `10_SOURCE_MASTERS`

Immutable best-known source custody, grouped by asset class. Preserve original provider exports and high-quality source masters here. **Do not overwrite a source master to create a derivative.** Remeshes, FBX conversions, texture edits, rigs, retargets, and optimization experiments belong in `20_PRODUCTION_WORKING` until a later authority deliberately selects a new master.

The repository's provenance/asset registry must remain capable of identifying the source used for shipped derivatives. Drive folder location is custody metadata, not the gameplay semantic identity.

### `20_PRODUCTION_WORKING`

Active derived production work: conversion, retopo/remesh, rigging, animation, texture/material work, optimization, and other intermediates. Use one package folder per semantic asset or coherent batch. This is a working surface, not a permanent archive and not evidence of promotion.

### `30_OWNER_REVIEW`

The fast visual decision surface.

- `00_NEEDS_OWNER_REVIEW` contains **only decision-ready review packets currently waiting on the Owner**.
- `90_REVIEWED_ARCHIVE` contains completed review packets retained for traceability after the Owner decision has been captured durably in the appropriate GitHub/asset authority.

Do not make the Owner hunt through raw provider exports, dozens of near-identical renders, unexplained versions, or a generic production-working folder. The active Owner queue should answer one question quickly: **what needs a decision now?**

### `40_GENERATION_INPUTS`

Source images, briefs, turnarounds, cleared input art, and Production Director-generated non-canonical target references used to create or transform assets. Inputs do not become approved production assets merely by being stored here.

### `50_REFERENCE_LIBRARY`

Project-controlled GalaQuest references and other references whose project custody is appropriate. External web/game comparison imagery normally remains linked by source/query in the review note rather than copied into Drive. Rejected explorations do not become future visual authority.

### `90_ARCHIVE_LEGACY`

Material deliberately retired or migrated from older active structures. It is not an active production surface.

## Asset-package identity and naming

Use stable semantic identity, not the producing agent, provider UI label, or subjective recency.

Preferred asset/package folder form:

```text
<semantic-id>__<short-name>
```

Examples:

```text
pet.worm.green__green-worm
enemy.emberworks.rollgremlin__roll-gremlin
gear.emberplate.helmet__emberplate-helmet
```

Do not create durable package identities such as `final`, `final2`, `newest`, `use-this-one`, `Claude`, `Codex`, `Meshy-output`, `temp`, or an opaque provider task id. Provider/task ids belong in provenance metadata when useful, not as the asset's durable identity.

## Owner review packet

For a non-gameplay visual decision, use a dedicated folder under `30_OWNER_REVIEW/00_NEEDS_OWNER_REVIEW`:

```text
YYYY-MM-DD__<semantic-id>__<short-name>__<sha7-or-NOSHA>
```

Use `NOSHA` only when the decision truly does not depend on repository state. If the asset/import/review depends on a repository revision, bind the packet to the exact Git SHA.

A useful minimum packet is:

```text
01_front.png
02_three-quarter.png
03_side.png              # when shape/fit is angle-sensitive
04_gameplay-scale.png    # when gameplay-size readability matters
motion.mp4               # or a short GIF when motion/VFX/cloth matters
review-manifest.json     # or equivalent concise manifest
```

The manifest should make the decision self-explanatory from a phone. Record, as applicable:

- semantic asset id and display name;
- decision requested from the Owner;
- exact Git SHA or `NOSHA` rationale;
- source/master identity and hashes/provenance where relevant;
- derivative/tool/version information;
- Unity version and inspection scene/state for Unity-bound assets;
- producer self-review result and **strongest known defect/uncertainty**;
- external/GalaQuest reference links or search terms used for comparison;
- whether motion was inspected;
- any surfaces still **UNKNOWN**.

The images should be tightly framed, consistently oriented, and large enough to judge on a phone. Do not provide only flattering angles: include the view that best exposes the known risk.

For Unity-bound assets, complete the mandatory Unity self-review in `docs/review-guides/asset-visual-review.md` **before** placing the packet in `00_NEEDS_OWNER_REVIEW`. For motion, inspect Play Mode. A deterministic Unity inspection scene is sufficient for a pre-gameplay asset decision; running-game pixels still govern final in-game appearance acceptance.

## Decision lifecycle

Use this route unless a task-specific runbook requires a narrower variant:

```text
new raw/source
  -> 00_INBOX
  -> provenance complete
  -> 00_INBOX/20_READY_TO_QUALIFY
  -> selected source master
  -> 10_SOURCE_MASTERS/<class>
  -> derived work
  -> 20_PRODUCTION_WORKING/<asset-package>
  -> producer self-review + decision-ready evidence
  -> 30_OWNER_REVIEW/00_NEEDS_OWNER_REVIEW/<review-packet>
  -> Owner decision recorded in the owning GitHub/asset authority
  -> 30_OWNER_REVIEW/90_REVIEWED_ARCHIVE
```

Approval of a Drive review packet does **not** by itself promote an asset into the game. Shipping/promotion remains governed by the public repository's asset registry, licence/provenance authority, relevant tests, runtime visual acceptance, and Owner-controlled promotion boundary.

## Anti-drift and document-control rules

1. **One active root only.** Search/list the canonical root before creating a folder. Do not make a parallel root or use a synced worktree/Downloads directory as project authority.
2. **Do not silently move or rename source masters.** If a GitHub registry/provenance record or durable review link references an item, update the related authority in the same controlled change.
3. **Raw/provider source is immutable evidence.** Derivatives receive new files/paths; do not destructively overwrite the source to save space or hide iteration history.
4. **Do not duplicate by default.** Copy a large binary only when a distinct custody role requires it. Prefer links/metadata when the same bytes already have a controlled source location.
5. **Do not use Drive as a second gameplay registry.** GitHub owns semantic IDs, shipped state, contracts, tests, and promotion. Drive owns custody and review media.
6. **Decision queue stays clean.** Only unresolved, decision-ready packets live in `00_NEEDS_OWNER_REVIEW`. After a durable decision, archive the packet so the Owner can trust that the remaining folders genuinely need attention.
7. **Large media stays out of Git merely for convenience.** Large source binaries and recordings belong in Drive; surface the most useful stills on the PR/Issue when practical so exact-SHA review context remains durable and phone-friendly.
8. **No hidden acceptance.** A Drive folder name such as `approved` or `final` cannot override GitHub/registry state. Owner decisions are ratcheted to the authority that owns the asset's lifecycle.
9. **No uncontrolled legacy migration.** Older `GalaQuest Asset Source Archive` folders, dated intake folders, and historical generation-input locations remain evidence until an explicit migration package reconciles them. Do not bulk-move/delete history merely to make the tree look neat.
10. **Capability gaps are explicit.** If an agent cannot access the controlled Drive root, it may continue work that does not require Drive but must not invent a substitute canonical location. Report the custody/review surface as unavailable/UNKNOWN and route the upload to a capable agent.

## Agent navigation rule

An agent working on the asset pipeline should start with this runbook, then access the canonical root by the folder id/URL above. It should list the relevant controlled child folder before creating anything and use the existing semantic asset package when one exists.

If a needed top-level category or lifecycle state does not exist, **do not improvise another hierarchy**. Route the structural change through the Production Director so the Drive tree and this runbook remain synchronized.

The target is simple: source provenance is recoverable, working files have one obvious home, the Owner has one trustworthy decision inbox, and a future agent can find the right asset without reconstructing old chats or searching random synced folders.
