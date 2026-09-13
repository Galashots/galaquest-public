# Rune Forge production retrospective

Status: working record for the Rune Forge / MagmaLord Helmet candidate. This is
not independent acceptance or an asset-promotion record.

## Scope and visual handoff

This package implements one personal Forge encounter, two data-backed task
packs, one durable entitlement, explicit equip, and the existing combat/POWER
effect. It deliberately stops short of final helmet art. The current helmet and
its enlarged display copy are implementation candidates whose semantic identity
is fixed, but their detail, materials, silhouette refinement, Hero fit, and
gameplay-distance polish still need an Astra-led visual pass. The display object
is explicitly named `MagmaLordForgeDisplayCopy`; it reuses the wearable mesh at
a larger scale so it cannot be mistaken for a second shipping asset.

No paid provider call, credit spend, asset promotion, merge, or PR closure was
performed in this package.

## What slowed production

### Unity startup and import dominated focused tests

At commit `e517ffc75acceffb864795f4f8d45bd027025974`, six focused EditMode tests
spent 0.128 seconds executing. The batch process took roughly two minutes because
Unity performed Asset Pipeline refreshes of 16.689 and 95.644 seconds. The log is
stored locally at `.local/rune-forge/editmode-final-e517ffc.log`; it is not public
authority and will be summarized in the PR evidence.

Several full WebGL builds were used to discover defects that should have been
caught before IL2CPP: camera lookup depended on a `MainCamera` tag, small
world-space labels were unreadable at gameplay framing, projected-control
diagnostics did not appear in the browser, and the first physics hit could hide
a Forge control behind ordinary level collision. The last defect now has a
red-capable Unity test and the runtime examines ordered hits until it finds an
interactable.

### Unity command behavior was easy to misread

The working editor is:

`C:\Program Files\Unity 6000.3.23f1\Editor\Unity.exe`

Bare `Unity.exe` can resolve WindowsApps shims. Direct shell invocation can also
return while the GUI process continues. Reliable batch execution required
`Start-Process -PassThru -WindowStyle Hidden` and waiting for that PID. Unity Test
Framework runs also had to omit `-quit`; including it allowed the editor to exit
before writing results.

### Late integration checks exposed coupled generated data

The required Node suite caught that the item catalogue, asset registry snapshot,
Unity bridge provenance, and tests must advance together. That coupling is
legitimate, but it is costly when discovered after gameplay work. The same suite
also exposes a Windows `EPERM` temporary-directory cleanup failure in
`lantern-xp-award.test.mjs`. It reproduces on the accepted convergence base, so
this package records it as existing engineering debt rather than changing an
unrelated test.

### Prefab authoring could have invalidated serialized identity

An early authoring path deleted and recreated the Forge prefab. It now overwrites
the existing prefab so its `.meta` GUID and serialized references survive. That
rule was added to the public authoring guidance and mistakes ledger.

## Fixes incorporated during this package

- The Unity command examples use the exact editor path and a waited process.
- Focused EditMode coverage checks task data, entitlement identity, physical
  raycast reachability through level collision, and authored object identity.
- The Forge browser driver owns its server and Chrome process, uses anonymous
  isolated profiles, verifies build hashes, binds client and server SHAs
  independently, and advances only after authoritative state changes.
- The prefab authoring path preserves the existing asset and `.meta` identity.
- Private learning facts are separated from shared world-reward events.
- The provisional helmet icon and registry entry remain visibly qualifying and
  unpromoted.

## Outstanding blockers to faster progress

1. Add a reusable Unity batch wrapper under `tools/` that resolves the configured
   editor, reports the version, starts and waits for the real process, rejects
   incompatible test flags, and records log/result paths and exit status.
2. Add a Forge scene preflight that instantiates the final preview scene in the
   Editor and checks every state control for active collider, unobstructed
   raycast, projected screen position, and gameplay-frame legibility. This should
   fail before a WebGL build.
3. Repair the WebGL projected-control diagnostic seam and make the browser driver
   fail fast when diagnostics unexpectedly disappear. The current driver has a
   bounded coordinate fallback but still uses real canvas touch and requires an
   authoritative response for every consequential action.
4. Reserve full IL2CPP builds for checkpoint and final evidence. Use the warm
   Library, PlayMode, and review-camera captures for ordinary visual and input
   iteration.
5. Diagnose the baseline Windows `EPERM` cleanup failure in a separate engineering
   lane so required-suite results are not obscured by a nondeterministic cleanup
   error.
6. Have Astra finish the helmet candidate and display presentation, then repeat
   Unity neutral-view, motion/fit, gameplay-distance, and running-WebGL visual
   review. The current package must not be described as visually accepted.

The highest-return follow-up is the Unity batch wrapper plus scene interaction
preflight. Together they would turn most command ambiguity and late WebGL input
discoveries into fast, deterministic failures before the expensive build step.
