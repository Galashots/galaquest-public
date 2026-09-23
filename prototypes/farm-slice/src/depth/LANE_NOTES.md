# Sol depth lane handoff

Public base SHA: `efbaa1084e5d8e0c7c9dd52e2ef4d7278c98f323` (`co-ceo/sol-depth`). This is an experimental browser prototype package, not a production pet or economy decision.

## Ownership and review

Sol (GPT-6) wrote `orders.js`, `breeding.js`, `help-along.js`, `gifts.js`, and the matching tests. Sol reviewed the supplied brief, schema, content arrays, product vision, task guidance, code paths, and the failing-then-passing order fulfilment test. No sub-agent or external model wrote these files. No OpenCode job was needed.

## Integration API

Import these named exports from `src/depth/`; all arguments and returned state are plain JSON except injected content arrays. Pass `content.OFFERS` and `content.QUESTIONS` from the shared content module. Store returned state with the shell's existing guarded localStorage save path. Use the latest returned object; the functions do not mutate input.

| Module | Call | Save/display |
| --- | --- | --- |
| Orders | `createOrderBoard({ offers, band, seed?, slots? })` | Save board once; default 3 slots. `getOpenOrders(board, offers)` supplies content text, wants and coins with a distinct order instance `id`. |
| Orders | `canFulfillOrder(order, inventory)`; `fulfillOrder({ board, orderId, inventory, offers })` | Save returned `board` and `inventory` together; add `coinsEarned` to the shell's in-game coin count. No order expires. |
| Breeding | `previewBreeding(parentA, parentB)` | Show the full `outcomes` percentages or each visible trait's odds **before** the choice. Both parents are owned creature instances with distinct IDs and `{element, shape, rarity, colors:{body, accent}}`. |
| Breeding | `createBreedingEgg({ parentA, parentB, ownedCreatureIds, eggId, ordinal, now, hatchMs, seed })` | Caller supplies a unique `eggId`, lifetime egg `ordinal`, timestamp and seed. Save returned `egg` and `nextSeed`; no crop or coin charge. The `child` traits are resolved at creation. |
| Breeding | `observeEgg(egg, now)`; `hatchEgg(egg, now)` | Save returned egg after observation. Show `remainingMs`; when ready, keep egg until player taps to hatch. Clock rollback does not undo observed progress. |
| Help | `getHelpOffer({ target, state, grade, questions, now })` | Target: `{id, kind:'egg'|'crop', rarity, ordinal?, startedAt, readyAt}`. Show normal finish time and an optional button only when `offer` exists. Save returned `state`; never show `usedToday` or a daily counter. |
| Help | `answerHelpQuestion({ target, state, question, choiceIndex, grade, questions, now })` | Wrong answer returns `hint` and permits retry without changing the target. Correct answer returns shortened `target` and updated `state`. Save both together. |
| Gifts | `createGiftCode(state, { kind, itemId, giftId? })` | State shape: `{crops:{[id]:count}, eggs:[], createdGiftIds?:[], redeemedGiftIds?:[]}`. Save returned `state` immediately, then display/copy `code`. One crop or owned unhatched egg is removed. |
| Gifts | `redeemGiftCode(state, code, { cropIds })` | Pass allowed IDs from `CROPS`. Save returned state immediately; duplicate IDs on the same device throw. The receiver owes nothing. |

Use millisecond Unix timestamps (`Date.now()`). The help state holds a UTC day index and a monotonic `lastObservedAt`. The soft cap is three correct answers per UTC day, with no visible count. `rare` and `epic` targets qualify; common crops and the first three eggs do not. The content currently has no crop rarity field, so the shell or later content contract must explicitly mark any genuinely rare crop before offering help. Distinctive crops are not automatically rare.

Gift codes carry unsigned JSON. They can be forged or copied; the guard prevents accidental repeat redemption on one saved device, not cheating across devices. Do not present them as authenticated trade. Keep fictional names and all child identifiers out of payloads. For a browser without `crypto.randomUUID`, the caller must provide a unique safe `giftId`. Rendering any decoded data must use text nodes, never HTML injection.

`node --test prototypes/farm-slice/test/depth/` uses `test/depth/index.js` as a directory entry point on Node 24. `node prototypes/farm-slice/test/depth/index.js` prints individual assertion counts.
