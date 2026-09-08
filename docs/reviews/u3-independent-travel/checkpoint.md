# M3: independent travel

## Package frame

This is an L package: a small Unity hub and two-way travel to Emberworks, with two children free to
separate and reunite in one ongoing world per destination. It follows the verified first-fight
checkpoint `be9d88f95d98b40440029ba1dcc2ebe8b9fc2840` on a separate branch.

Checkpoint 1 implements server destination ownership and the additive protocol handoff. Checkpoint 2
wires the Unity scene, controls and presentation, then tests real two-browser travel and reunion.
Physical Safari iPad acceptance remains an Owner gate. Personal math/rewards and worm admission are
sequential follow-up packages within the approved miniature-loop milestone. No new provider spend,
asset promotion or PR merge is implied by this networking package.

## Owner decisions on 2026-09-07

The Owner approved the reviewed hand grip for playtest integration, accepting the documented small
crease and pommel-contact limitations for later polish. The approved candidate is identified by the
[hand receipt](../../asset-production/HERO_RIGHT_GRIP_CANDIDATE_2026-09-07.json). Its integration remains
in the first-fight asset package, separate from this server change.

The Owner also set a new stopping point: finish the hub and Emberworks work and associated pushes,
then pause for a progress discussion before starting the second level, Sunroot Glade. The agreed
two-level release remains the eventual objective; second-level implementation must wait for that discussion.

## Server checkpoint behavior

The transport owns globally unique connection/player IDs and one shared reward coordinator/store.
Each recognized destination owns its own simulation and receives only its own players and world
events. Existing clients with no destination still join Village; it remains the legacy geography,
not the new Unity hub. Unknown destinations continue to fail explicitly.

`travel` carries `destinationId` and a required non-negative integer `worldEpoch`. The server replies
with `destination-changed`, including the full arrival snapshot, personal facts, stable player ID and
the next epoch. Subsequent controls must carry that epoch. A transition preserves HP and cooldowns,
cancels active attacks, and starts with released input at the destination spawn. Old-world messages
are ignored. Legacy clients remain at epoch zero without a wire-shape change.

Travel does not recreate a sibling's simulation. Participation ledgers are scoped by destination,
so equal authored enemy IDs cannot share credit. On reconnect, outstanding participation and corpse
claims move to the new connection ID; an awarded personal fact follows an active contributor to
their current destination without forwarding the other destination's combat state. Saved reward
facts remain in the existing store and reconnect through the existing profile journal.

## Evidence and remaining work

The first real-socket test failed on the package base because the second destination was rejected.
The travel test failed before the new message was implemented. A separate counterexample omitting
the reconnect participation handoff loses the returning child's XP after a real shared fight.
These tests now exercise separate destinations, reunion with a damaged enemy, stale controls,
HP/cooldown continuity, personal coin restore, scoped XP and protocol validation.

Exact-commit required-gate results will be recorded at the server checkpoint. Unity portals, a visible
hub, scene transitions, browser visual review and physical iPad evidence are not yet provided by this
checkpoint. It does not claim the miniature loop or either full adventure complete.
