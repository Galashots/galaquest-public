# GalaQuest product memory and board system

GalaQuest uses GitHub as the durable product control plane so Owner intent, product ideas, observations,
requirements, and active initiatives survive chat boundaries and remain readable by ChatGPT, Codex,
Claude, and other agents.

The system is deliberately small:

- `docs/product/PRODUCT_VISION.md` = settled Owner-level product direction;
- **GitHub Issues** = canonical live product memory, provenance, backlog, requirements, and initiatives;
- **GitHub Projects** = visual projection of those Issues for board/roadmap use;
- pull requests = implementation proposals and evidence linked back to the relevant product record;
- chats = temporary thinking surfaces, never the only home of durable product information.

If the Project view and an Issue disagree, the Issue wins. If an Issue and the settled product vision
disagree, stop and resolve the contradiction rather than silently choosing one.

This repository is public. Assume every product Issue, comment, Project item, and committed product document
is public. Do not put family-identifying information, credentials, private provider/account details, or
genuinely confidential planning here.

## Product record types

Use one Issue per meaningful product record. Prefer a small number of useful records over a ticket for
every passing thought.

### Idea

A product possibility worth preserving but not yet selected for implementation.

Examples: a pet gifting mechanic, pet eggs, a new flex surface, a giant power-number moment, or a new
learning-delivery pattern.

Target label: `type:idea`.

When the Owner selects an idea, stop treating it as an Idea: retype or replace it with a bounded
Requirement or broader Initiative as appropriate.

### Signal

An observation or piece of evidence that may change product judgment.

Examples: a child repeatedly ignores a feature, a playtest produces spontaneous excitement, another
game demonstrates a useful engagement pattern, or a player repeatedly gets confused by a UI flow.

Target label: `type:signal`.

A signal is evidence, not automatically a decision. Keep observation separate from interpretation.
Create a standalone Signal Issue when the evidence deserves independent search/lifecycle. If it only
matters to an existing Requirement or Initiative, prefer a concise comment on that owning record.

### Requirement

A bounded behavior or outcome the Owner has selected. It is usually small enough to be completed by one
or a few coherent PRs without becoming a multi-phase product program.

Examples: invert both camera orbit axes, make one reward auto-equip, or add one specific child-facing
control behavior.

Target label: `type:requirement`.

### Initiative

A broader product outcome the Owner has selected for active or upcoming work. An Initiative may link
several Requirements, candidate Ideas, implementation tasks, briefs, and PRs while remaining the
product-level reason the work exists.

Target label: `type:initiative`.

## Required provenance

Every product Issue should preserve enough context that a future agent can understand why it exists
without needing the originating chat.

Record, as applicable:

- **Origin date** — use `YYYY-MM-DD`;
- **Origin type** — Owner direction, child/player observation, playtest, research/reference, agent
  suggestion, implementation discovery, or other;
- **Source/context** — a concise description of where the thought or observation arose;
- **Record** — the idea, observation, requirement, or intended outcome itself;
- **Why it may matter** — product hypothesis, not a claim of proof;
- **Decision state** — selected Owner requirement/initiative, candidate/not decided, needs Owner
  decision, or superseded;
- **Open questions** — unresolved product questions that could change selection or scope;
- **Related records** — relevant Issues, PRs, briefs, or evidence.

Do not paste entire chat transcripts when a concise product record preserves the useful context. Do not
record children's names, personal identifiers, private account details, or other unnecessary personal
information; use descriptions such as `child playtest` or `Owner observation`.

## Issue body and comments

Use the Issue **body** as the current durable summary: what the record means now, settled decisions,
open questions, current stage rationale, and durable implementation history.

Use **comments** as the chronological event/evidence log: implementation updates, playtest findings,
worker notes, dated observations, and intermediate review events.

Do not rewrite the body for every small event. Periodically ratchet material changes from comments into
the body so a fresh agent does not need to read the entire thread. Avoid durable phrases such as
`current PR #N` when a dated/history-safe statement will survive the next merge.

## Lifecycle

All live product records carry `product` plus exactly one type label and exactly one open `stage:*` label.

- `stage:inbox` — captured but not yet triaged;
- `stage:candidate` — worth considering; not selected for near-term work;
- `stage:next` — Owner-selected near-term work but no active implementation/production lane exists;
- `stage:building` — active implementation or production work exists now;
- `stage:validate` — an implemented increment exists and product/playtest acceptance is the current
  question;
- `stage:icebox` — deliberately preserved but not under active consideration.

`stage:building` is not a synonym for important. When the active implementation PR/production lane ends,
reconcile the owning product Issue immediately: move to Validate, Next, Candidate, or close it according
to the actual product state.

Every product PR open/merge/close should trigger a quick reconciliation of the owning Issue stage.

Closed Issues represent records no longer requiring an open backlog state. Before closing, remove the
open `stage:*` label and close with a concise reason: completed/shipped, not planned, duplicate, or
superseded. A rejected idea is not erased; its closing note preserves why it was declined when useful.

`Done` is a Project-board display state for closed/completed records rather than an open Issue stage.

## Promotion authority

Capture is intentionally easy; promotion is intentionally controlled.

Authorized agents may capture Inbox records, append evidence/comments, and suggest candidates. A bounded
implementation worker may not promote its own suggestion to `stage:next`/`stage:building`, retype an Idea
as an Owner Requirement, or turn a finding into settled Product Vision direction.

Promotion into selected work requires either:

- explicit Owner direction; or
- Production Director action clearly grounded in existing Owner direction.

Implementation discoveries must not silently broaden the active PR. Capture/report the new candidate and
keep executing the authorized objective.

## GitHub Project projection

Use one GitHub Project named **GalaQuest Product**. It is a visual control panel, not a second source of
truth.

Primary board states:

`Inbox -> Candidate -> Next -> Building -> Validate -> Done`

Keep `Icebox` as a separate status/column or filtered view so it does not dominate normal planning.

Recommended configuration:

1. auto-add repository Issues matching `is:issue label:product`;
2. create/use a Project Status single-select matching the board states above;
3. enable the built-in closed-Issue -> Done automation where available;
4. optionally default newly added items to Inbox, but mirror later stage changes from the Issue label;
5. when a record changes stage, update its `stage:*` Issue label first and mirror Project Status when
   Project access is available;
6. if Project Status and the stage label drift, the Issue label is authoritative and the Project should
   be repaired;
7. do not store critical context only in a Project-only custom field.

Auto-add is not retroactive to untouched existing Issues, so seed/existing records may require one-time
manual addition.

## Label set

Keep the taxonomy intentionally small.

Required common label:

- `product`

Required type labels:

- `type:idea`
- `type:signal`
- `type:requirement`
- `type:initiative`

Required stage labels:

- `stage:inbox`
- `stage:candidate`
- `stage:next`
- `stage:building`
- `stage:validate`
- `stage:icebox`

Add area labels such as `area:pets`, `area:social`, `area:learning`, or `area:progression` only when they
make real filtering easier. Do not create a taxonomy for hypothetical future needs.

## Capture and ratchet protocol

During ordinary product conversation, the Owner should be able to speak naturally. Phrases such as
`capture that`, `do not lose that`, `backlog that`, or `I like that, but not now` are sufficient intent
for the Production Director to create or update the appropriate product record when GitHub coordination
writes are authorized.

At the end of a meaningful planning or playtest session, perform a bounded product ratchet:

1. identify genuinely new Ideas, Signals, Owner-selected Requirements/Initiatives, superseded direction,
   and decisions;
2. search existing product Issues before creating a duplicate;
3. update the smallest existing record when it already owns the subject;
4. create a new record only when the thought deserves independent lifecycle or provenance;
5. promote settled Owner-level direction into `docs/product/PRODUCT_VISION.md` through a normal branch/PR
   when it is durable enough to belong there;
6. leave low-value conversational brainstorming in chat rather than turning the backlog into a transcript.

## From product record to implementation

When product work is selected:

1. use a Requirement for a bounded selected behavior/outcome or an Initiative for a broader product push;
2. set the owning record to `stage:next` until an active implementation/production lane exists;
3. move it to `stage:building` only while that active lane exists;
4. frame a bounded implementation objective under `docs/WORKFLOW.md` and link it back to the owning
   product record;
5. keep implementation discoveries from silently expanding the current PR — capture/report separate
   candidates instead;
6. move the record to `stage:validate` when an implemented increment exists and product/playtest judgment
   is the current question;
7. record meaningful evidence as a Signal Issue when independently useful, otherwise as a concise
   comment on the owning record;
8. close only when the product outcome is actually finished, deliberately declined, duplicate, or
   superseded.

A broad Initiative may remain open across several PRs. Link those PRs with `Related to #N` or equivalent
rather than auto-closing the Initiative. A small Requirement may use `Closes #N` only when that PR truly
completes the requirement; do not let one checkpoint accidentally close a multi-PR product outcome.

## Product records versus engineering work

The product board is not a second engineering backlog.

Ordinary CI/test debt, refactors, tooling defects, implementation bugs, dependency maintenance, and
internal engineering chores remain in the normal engineering Issue/brief/PR flow unless they materially
change product choice, priority, player outcome, or Owner requirement.

Product records are for player/product outcomes, Owner-selected requirements and initiatives, evidence
that changes product judgment, and candidate product possibilities.

## Agent behavior

A fresh agent should be able to recover product state from the public repository plus live GitHub Issues
without reading historical chats.

Agents should:

- read `docs/product/PRODUCT_VISION.md` before making product-level assumptions;
- search product Issues before claiming an idea is new, decided, or currently prioritized;
- distinguish Owner decisions from agent suggestions and observations;
- add concise provenance when creating or materially changing a product record;
- link implementation work to its product reason;
- use Issue bodies for current durable state and comments for chronological evidence/events;
- avoid creating duplicate backlogs in Markdown, spreadsheets, Notion, private notes, or chat;
- treat the GitHub Project as a convenient view over Issues rather than independent authority.

Agents may create/update product Issues when the current task or Production Director authorization permits
reversible coordination writes. A bounded implementation worker that is not authorized to create product
records should report the candidate finding to the Director instead of broadening its implementation.

## Issue templates

For human or agent-assisted capture, use:

- `.github/ISSUE_TEMPLATE/product-idea.yml`
- `.github/ISSUE_TEMPLATE/product-signal.yml`
- `.github/ISSUE_TEMPLATE/product-requirement.yml`
- `.github/ISSUE_TEMPLATE/product-initiative.yml`

The forms auto-apply the common/type/Inbox labels. Inbox is deliberate: capture should not silently
prioritize work. The Production Director performs the explicit triage/promotion step afterward.
