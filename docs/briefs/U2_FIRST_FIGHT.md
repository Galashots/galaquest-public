# First Emberworks fight

## Package

**Objective:** deliver one readable, satisfying, repeatable fight in the connected Unity opening route: approach a lava gremlin, land three or four good starter strikes, recognize its wind-up, step aside from a committed body bash, defeat it, and recover quickly after a mistake.

**Class L**, under the approved two-level initiative #46 and release contract in PR #142. This follow-on uses the isolated movement branch at `1802b4fa860fcf77ff712fb2df6d919bc6f8678e`; the tested runtime source is `2904587ff078f7cb247dc97e3fd62695df05369c`. Public main was refreshed at `d7c37e000e8ae3ea93c03f2cbc499edfa14bf9e4`. PR #143 retains the movement scope and its pending physical-device/Owner gates. No merge is implied.

## Included surfaces and checkpoints

1. **Authored encounter and authority:** reuse the existing party-combat engine with destination-specific population, spawn, recovery, wall constraints, and attack routing. Preserve Village geography and economics. Red tests cover the current absent Emberworks encounter, first-join destination selection, wall crossing, replayed attacks, and recovery.
2. **Unity fight:** consume authoritative bodies/enemies/events; add attack input with independent touch ownership, hero attack/reaction animation, enemy state presentation, readable health and telegraph feedback, hit/death audio, and retry. Two players share one enemy and retain independent control.
3. **Enemy candidate:** original approved lava gremlin reference; Smart Topology T2 body, then conditional rigging. Measure source geometry/materials and real clip motion, preserve custody, inspect in Unity neutral/gameplay views, and request Owner asset promotion only after a decision-ready result. Every paid batch requires its own current approval and measured receipt.
4. **Combined review:** relevant Node/Unity tests, exact-source WebGL build, actual two-client fights and recovery, producer visual/motion inspection, then physical-iPad/Owner judgment. Machine checks do not prove fun or final appearance.

## Fight contract and counterexamples

- Attack presses produce immediate local feedback, while the server alone decides contact, damage, defeat and rewards. Retransmission cannot grant another strike or reward.
- The gremlin winds up visibly, commits to its attack direction, and has a recovery opening. Continuously steering through the player during the active attack would fail counterplay.
- Movement remains available during telegraphs and attacks. An attack-button finger must not rotate the camera or steal the movement thumb.
- The enemy cannot pursue through the cavern wing. Death/recovery returns the hero to the Emberworks spawn, never Village coordinates.
- A second player can affect the same enemy without duplicating it. Disconnect/rejoin cannot leave a stuck attack, immortal body, or stale control owner.
- The output must animate in the actual Unity game. A provider animation label, one-key pose, standalone render, or successful importer is insufficient.

Full-level scenery, independent destination travel, learning tasks, pet production, the full gear loop and the optional direct-Blender rigid-armor experiment in Issue #44 remain later release work. Discoveries stay with their existing issue/asset authority instead of expanding this fight package.
