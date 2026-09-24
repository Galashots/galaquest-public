# Farm slice: ten-minute experience contract

This is the authoritative tuning target for `prototypes/farm-slice/`. Where it differs from the brief's beats, this file wins (see §8). The players are "the younger player" (Grade 2 curriculum band) and "the older player" (Grade 5 curriculum band). No real names are used anywhere.

**Cast.** The Hero, Pip (the market keeper), the egg, and the creature (default name **Sprout**, Sun element).
**Band.** Before 0:00, a one-time grown-up card offers two buttons: **Counting helper (6–8)** and **Deal helper (9–11)**. It saves `band: "younger" | "older"`; to change it later, hold the gear icon for 2 s. The economy is identical in both bands; only the presentation differs.

## 1. Beat sheet

The arrow is a bouncing arrow plus a pulse ring, with exactly one target at a time. Every sound has a visual twin, so numbers float on screen even with audio off.

| Time | On screen | Chip | Arrow | Action | Feedback (visual / audio) | State change |
|---|---|---|---|---|---|---|
| 0:00 | Farm; the egg wobbles and glows beside an empty 3-hole plot | Plant a seed | Plot | Tap plot | Seed tray slides up: 2 carrot seeds, 1 twinkling **star seed** / whoosh | `ARRIVE→PLANT` |
| 0:30 | Tray; the holes glow | Plant all 3 seeds | Next empty hole | Tap a hole; the tray auto-selects the next seed, or tap a seed to pick it first | Soil puff / pop. At 3/3, **crack 1** / crack + chime | Plots get `plantedAt`; `cracks=1` |
| 1:15 | Sprouts; the watering can bounces | Water your sprouts | Each unwatered sprout | Tap a sprout | Water arc; the sprout grows a stage / splash | Remaining time halved (once per crop) |
| 2:00 | Ripe crops bob; a progress ring shows on any that aren't ripe yet | Pick your crops | Ripest crop | Tap each plant | Crops pop into the basket, counted "1, 2, 3…". **Crack 2**; the egg glows sunberry-gold | `basket {carrot:6, sunberry:2}` |
| 2:40 | Stall: Pip, 2 offer cards, and a mannequin wearing the **Leaf Crest Helmet**, tagged **10** | Go to the market | Stall | Tap stall | The camera glides over; Pip says "Hi, farmer!" / bell | `view=market` |
| 3:10 | Two offer cards | Pick a deal | Sways between **both** cards | Tap a card | The card lifts, and the basket items it needs get an outline. **Back** is always available | UI only |
| 3:40 | The crate sits on a **balance scale** with outline slots | Fill Pip's crate / Fill the bundle | Next empty slot | Tap basket items (the older band also gets a **Fill** button) | Thunk plus a spoken count; the scale tilts toward level. When full, it levels with a chime, and Pip pays in **2-coins**, counted "2, 4, 6…". **Crack 3** | Atomic commit: coins +10 or +12 |
| 4:30 | Mannequin tag: five 2-coin outlines (younger) or "10" (older) | Buy the helmet | Price tag | Younger: tap coins into the outlines. Older: tap **Buy** | The purse shows "12 − 10 = 2" on path B. The helmet flies onto the Hero with a before/after sparkle and a pose / fanfare. **Crack 4**, and the egg shakes | `equipped.head`; `egg=READY` |
| 5:15 | Back at the farm; the egg bounces | Tap the egg! | Egg | Tap ×3 | Bigger cracks and a rising 3-note sound. No flashing | Taps aren't saved |
| **~6:00** | Gold confetti; Sprout tumbles out, blinks, and chirps at the Hero | (hidden for 5 s) | None | Watch | Hatch jingle | `egg=HATCHED` |
| 6:05 | 6 big name tiles plus **Type my own** (12 characters max) | Name your creature | Name card | Tap or type | Sprout hops at its name | `creature.name` |
| 6:45 | The book icon bounces, then the book opens | Open your book | Book icon | Tap, flip, close | Sprout's card, then **5 silhouettes** and "1 of 6 found" / page flip | `bookSeen` |
| 7:30 | Sprout wanders near the basket | Feed Sprout a sunberry | Sunberry | Tap it | Nom-nom, hearts, and a growth meter at **1/3** | `sunberry −1`; `fed=1` |
| 8:15 | The free seed sack glows (it never runs out) | Plant again | Plot | Tap 3 holes | As before (no crack); Sprout hops alongside | 3 carrots growing |
| 9:00 | Growing, then ripe | Water your sprouts → Pick your crops | As before | Water, then harvest | 9 carrots pop into the basket | `carrot +9` |
| 10:00 | The stall glows; both offers are still up | Pip wants more carrots | Stall | The slice ends; there's no stop or stay prompt | Idle music | `FREE` |

## 2. Numbers

| Crop | Grow time | Watered | Yield | Pip's sign |
|---|---|---|---|---|
| Carrot (seeds are free and unlimited) | 20 s | Remaining time halved | 3 per plant | 2 coins |
| Sunberry (the star seed; 1 in the slice) | 40 s | Remaining time halved | 2 per plant | 5 coins |

The sign is for reference only; the offers are the only way to sell. Both offers stay up and can be refilled whenever the basket has enough. The first harvest can fill only one of them.

| | A: Pip's crate | B: Bundle |
|---|---|---|
| Deal | 5 carrots → **10** (five 2-coins) | 2 carrots + 1 sunberry → **12** (six 2-coins) |
| Younger card and maths | Pictures: 5 carrots → 5 coins. Count the crops into the slots (the empty slots show "how many more"), then count coins by 2s to 10 | Pictures: 2 carrots + 1 sunberry → 6 coins. Count 2 + 1, then count by 2s to 12 |
| Older card | "5 carrots → 10 · You keep 1 carrot, 2 sunberries" | "2 carrots + 1 sunberry → 12 · You keep 4 carrots, 1 sunberry" |
| Older maths | 10 ÷ 5 = **2 per crop**. Kept: 1×2 + 2×5 = 12, so the total is **22** | 12 ÷ 3 = **4 per crop**. Kept: 4×2 + 1×5 = 13, so the total is **25** |
| Trade-off | Fewer coins, but an extra sunberry for Sprout | 3 more coins' worth, but one less sunberry |
| The other card then shows | "Needs 1 more carrot" | "Needs 1 more carrot" |

**Armor.** The Leaf Crest Helmet costs **10 coins**. It is cosmetic only and has no stats.

**Always affordable.** Either offer covers the helmet: min(10, 12) = 10 ≥ 10. The first harvest (6C, 2S) fills either offer: for A, 6 ≥ 5; for B, 6 ≥ 2 and 2 ≥ 1.

| Step | Path A | Path B |
|---|---|---|
| Start | 0 · empty | 0 · empty |
| Harvest 1 | 0 · 6C 2S | 0 · 6C 2S |
| Sell | 0 + 10 = **10** · 1C 2S | 0 + 12 = **12** · 4C 1S |
| Helmet | 10 − 10 = **0** | 12 − 10 = **2** |
| Feed | 0 · 1C 1S | 2 · 4C 0S |
| Harvest 2 (+9C) | 0 · 10C 1S | 2 · 13C 0S |

At 10:00, path A can fill offer A twice, or offer B. Path B can fill offer A twice, and its bundle card says "Needs a sunberry". Seeds are unlimited, so nothing can soft-lock.

## 3. Invisible-learning map

The outcomes come from Alberta's K–6 Mathematics program of studies (finalized April 2022, now implemented), checked on 2026-09-23 against these sources:
- [alberta.ca/curriculum-mathematics](https://www.alberta.ca/curriculum-mathematics)
- the [April 2022 fact sheet](https://open.alberta.ca/dataset/da982352-b50d-49a2-8805-c9073a7ecebd/resource/ce28459e-b9ba-40bc-a96f-c03b71df31e0/download/edc-new-curr-k6-mathematics.pdf)
- new LearnAlberta: [Grade 2](https://curriculum.learnalberta.ca/curriculum/en/c/mat2) and [Grade 5](https://curriculum.learnalberta.ca/curriculum/en/c/mat5)

LearnAlberta blocks automated fetches, so the outcome wording was cross-checked against IXL's Alberta Grade 2 standards page and Pearson's Mathology Alberta Grade 5 correlation. Re-read LearnAlberta before quoting any of it to a teacher.

| Moment | Outcome (and skill) | Why it's play | On a "wrong" choice |
|---|---|---|---|
| Filling the slots (younger) | Gr 2: "Students investigate addition and subtraction within 100." Skill: find a missing quantity | Pip is waiting, and the empty slots *are* the "how many more". There is no question text | The wrong crop hops back with a boing and Pip says "Carrots, please!" while the right slot pulses. A full crate wiggles "Full!" |
| Coins by 2s (younger) | Gr 2: "Students analyze quantity to 1000." Skill: value of same-denomination coins by skip counting | The coins clink and the helmet tag fills | Overpaying is impossible, so the next outline pulses. If the purse is short, the tag says "Need 2 more", and the arrow points at the stall |
| The scale levels (younger) | Gr 2 Algebra skill: model equality and inequality with a balance | The scale is a toy that tips and then levels with a chime | A partial fill just leaves the scale tipped. There is no timer |
| Choosing a deal (older) | Gr 5: "Students employ ratios to represent relationships between quantities."; "Students multiply and divide natural numbers within 100 000…" | The player picks what *they* want: coins or Sprout's food. Both choices afford the helmet | There's no wrong pick. The ledger shows "3 crops → 12 coins", and the other deal stays up |
| Change (older, path B) | Gr 5: "Students add and subtract within 1 000 000…" Skill: solve problems using money | The purse animates the change | Display only |

## 4. State model

**Save.** The save lives in `localStorage["gq.farmSlice.v1"]`, with try/catch on every access. If storage is unavailable, the game still plays; it just doesn't persist.

```
{v:1, band, goal, cracks, egg:"WOBBLE"|"READY"|"HATCHED",
 plots:[{crop, plantedAt, watered, harvested}], basket:{carrot, sunberry},
 coins, offersFilled:{crate, bundle}, equipped:{head}, creatures:[{id, name, fed}], bookSeen}
```

- **When to save:** on every goal change, plant, water, harvest, offer commit, and purchase.
- **Ripeness:** computed from `now − plantedAt`, clamped at ≥0. Once a crop is ripe it stays ripe.
- **Partial fills and coin taps:** UI-only. On reload they return to the basket or purse.

| Goal state | Exits when | Crack |
|---|---|---|
| PLANT | 3 seeds planted | 1 |
| GROW | Any crop is ripe | none |
| HARVEST | All crops harvested | 2 |
| MARKET | The stall is open | none |
| OFFER | An offer is committed | 3 |
| ARMOR | The helmet is equipped | 4 (READY) |
| HATCH | 3 taps | Hatch |
| NAME | A name is set | none |
| BOOK | The book is closed | none |
| FEED | Sprout is fed | none |
| REPLANT | Harvested | none |
| FREE | Loops | none |

If the player leaves the stall mid-goal, the chip reverts to "Go to the market".

**Returning after 1 hour or 1 week.** The same thing happens either way:
- Planted crops are ripe and sparkling.
- A READY egg waits for its taps, so the hatch moment is kept for the child.
- Sprout wakes from a nap and hops over.
- If the plot was empty, one ripe **volunteer carrot** has popped up.
- Both offers are still up, and the chip resumes where it was.

Nothing withers or expires, and no text mentions how long the player was away.

## 5. Minutes 10–30 tease

1. **Feed loop.** 3 sunberries bloom Sprout's sun crest, its first new look. The meter only goes up.
2. **Second egg.** Filling 2 more orders earns Pip's gift: a star seed and a Leaf egg. The egg's type is visible and its hatch is ungated.
3. **Order-board seed (older player).** A third card appears: 6 carrots + 2 sunberries → 26. They can fill it now, save for it, or feed Sprout instead.

## 6. Child-test protocol (gate 2)

Each player plays alone. The adult says only "Do whatever you like." Record each item as pass or fail, with the time. Items marked * must pass for both players.

1. *The player makes their first plot tap within 30 s.
2. *The player has at most 2 stalls, meaning pauses of more than 10 s with no purposeful touch. Log the goal state of each.
3. The player looks at or touches **both** offer cards before committing.
4. The older player compares the offers aloud or by pointing. The younger player fills the crate correctly within 2 tries.
5. *The player reacts to the hatch: a smile, an exclamation, leaning in, or a comment.
6. The player picks or types a name instead of skipping past it.
7. The player notices the helmet on the Hero: they point, comment, or linger on it.
8. *At 10:00, when told "you can stop now", the player keeps playing or asks to.

**Afterwards, ask:**
- "What would you do next?"
- "Which deal did you pick, and why?"
- "What was the best bit, and was there a moment you didn't know what to do?"

## 7. Anti-patterns: never

- Real money, premium currency, ads, or pay-to-skip.
- Random rewards with hidden odds. The egg type is always shown.
- Expiring timers, withering, streaks, "come back at X" prompts, or notifications.
- Absence or guilt text, such as "We missed you!".
- Red crosses, "Wrong!", lost coins or crops, or fail sounds.
- Any question gate on the hatch or on any first-session step.
- Nudging toward one offer, such as a "Best deal!" badge or a biased arrow.
- Countdowns, flashing above 3 Hz, or "Are you sure you want to quit?".
- Network calls beyond static files, or analytics.

## 8. Differences from the brief's beats

- **Offers.** The brief had 3C → 6 and 2C + 1S → 9. This contract uses **5C → 10** and **2C + 1S → 12**, from a harvest of 6C and 2S (2 carrot plants ×3, 1 star plant ×2). This makes the choice exclusive and a real trade-off, with clean rates of 2 and 4 coins per crop.
- **Coins.** All coins are 2-coins, which supports skip counting.
- **Watering.** An optional watering step fills the grow wait.
- **Cracks and hatch.** The egg gets 4 goal cracks, and then 3 child taps hatch it.
- **Band.** A grown-up sets the band once.
- **Return.** A volunteer carrot appears if the plot was left empty.
