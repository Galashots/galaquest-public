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

At **d7285e577dcf9e1ae1e8ccaa48a0cfd3ff0f7fdd**, the seven focused server/guard checks pass and
the full [hosted unit gate](https://github.com/Galashots/galaquest-public/actions/runs/34174864788) passes.
The earlier full local run at runtime-equivalent `7b71feec320497a59c40f44b465bbb5bb507b3f8`
reported 2290 pass, two fail, three skip: a source-text Beacon scanner needed to follow the new
destination loop (fixed in d7285e5), and the previously observed Windows Lantern-XP temporary-folder
cleanup hit `EPERM`. The latter occurred during cleanup, not a failed reward assertion.

The server checkpoint does not establish Unity, browser or physical iPad acceptance.

## Unity camp and travel checkpoint

The existing Unity player scene now contains a small camp alongside the Emberworks scenery. One
session, hero and camera survive travel; the acknowledged destination selects the scenery, resets
position prediction and clears the previous destination's combat views. The camp is the initial
destination. Its gate offers entry to Emberworks, and a Return to camp control allows each child to
leave independently. Touches on the travel control are excluded from camera gestures.

Travel releases movement before the request, blocks controls while arrival is pending, and requires
neutral movement before the next stride. New controls carry the acknowledged epoch. Wrong-player
arrivals and old-world snapshots are ignored. A broken socket reconnects to the last acknowledged
destination with the same selected profile. A page reload starts at camp.

The initial Unity regression failed because the session had no travel operation. The completed
EditMode run covers arrival, retry after failed send, synchronous acknowledgement, stale snapshots,
reconnection, existing collision/locomotion behavior, and the admitted hand asset. The old locomotion
fixture used duplicate welcomes to reposition a hero; it now opens a fresh fake connection before
each welcome. No movement constants were tuned for that fixture.

### Camp visual convention

GalaQuest's current hero and materials remain the project reference. Three inspected comparison
images informed only spatial conventions: an open meeting area with destinations at the edges in
[Kirby's Waddle Dee Town](https://www.nintendo-master.com/news/kirby-et-le-monde-oublie-se-devoile-en-images-et-en-artworks),
a compact action courtyard with low foreground scenery in
[Minecraft Dungeons' camp](https://www.windowscentral.com/minecraft-dungeons-guide-how-replay-levels-higher-difficulties),
and paths, benches and lighting that frame a gathering place in this
[LEGO Fortnite village](https://www.eurogamer.de/lego-fortnite-ist-viel-mehr-lego-als-fortnite-aber-deshalb-nicht-weniger-spannend).
These are attributed game screenshots carried by secondary publications; their art is not copied
into the project. The camp geometry and simple materials are authored locally through Unity.

Exact-source WebGL build, two-browser travel/reunion, running-game visual review and physical iPad
results must still be recorded below. This checkpoint does not claim the miniature loop or either
full adventure complete. The existing gremlin remains a separate review candidate; travel work
does not promote it or authorize further provider spend.
