# GalaQuest product memory and board system

GalaQuest uses GitHub as the durable product control plane so Owner intent, product ideas, observations,
and active initiatives survive chat boundaries and remain readable by ChatGPT, Codex, Claude, and other
agents.

The system is deliberately small:

- `docs/product/PRODUCT_VISION.md` = settled Owner-level product direction;
- **GitHub Issues** = canonical product memory, provenance, backlog, and initiative records;
- **GitHub Projects** = visual projection of those Issues for board/roadmap use;
- pull requests = implementation proposals and evidence linked back to the relevant product record;
- chats = temporary thinking surfaces, never the only home of durable product information.

If the Project view and an Issue disagree, the Issue wins. If an Issue and the settled product vision
disagree, stop and resolve the contradiction rather than silently choosing one.

## Product record types

Use one Issue per meaningful product record. Prefer a small number of useful records over a ticket for
every passing thought.

### Idea

A product possibility worth preserving but not yet selected for implementation.

Examples: a pet gifting mechanic, pet eggs, a new flex surface, a giant power-number moment, or a new
learning-delivery pattern.

Target label: `type:idea`.

### Signal

An observation or piece of evidence that may change product judgment.

Examples: a child repeatedly ignores a feature, a playtest produces spontaneous excitement, another
game demonstrates a useful engagement pattern, or a player repeatedly gets confused by a UI flow.

Target label: `type:signal`.

A signal is evidence, not automatically a decision. Keep observation separate from interpretation.

### Initiative

A product outcome the Owner has selected for active or upcoming work. An initiative may link several
candidate ideas, implementation tasks, briefs, and PRs while remaining the product-level reason the work
exists.

Target label: `type:initiative`.

## Required provenance

Every product Issue should preserve enough context that a future agent can understand why it exists
without needing the originating chat.

Record, as applicable:

- **Origin date** — use `YYYY-MM-DD`;
- **Origin type** — Owner direction, child/player observation, playtest, research/reference, agent
  suggestion, implementation discovery, or other;
- **Source/context** — a concise description of where the thought or observation arose;
- **Record** — the idea, observation, or intended outcome itself;
- **Why it may matter** — product hypothesis, not a claim of proof;
- **Decision state** — settled Owner direction, candidate/not decided, needs Owner decision, or
  superseded;
- **Open questions** — unresolved product questions that could change selection or scope;
- **Related records** — relevant Issues, PRs, briefs, or evidence.

Do not paste entire chat transcripts when a concise product record preserves the useful context. Do not
record children's names, personal identifiers, private account details, or other unnecessary personal
information; use descriptions such as `child playtest` or `Owner observation`.

## Lifecycle

All live product records carry the common target label `product` plus one type label. A live record also
carries exactly one stage label when the label set is available.

- `stage:inbox` — captured but not yet triaged;
- `stage:candidate` — worth considering; not selected for near-term work;
- `stage:next` — selected as a likely near-term push but not currently being implemented;
- `stage:building` — active implementation or production work exists;
- `stage:validate` — implementation exists and product/playtest acceptance is the current question;
- `stage:icebox` — deliberately preserved but not under active consideration.

Closed Issues represent records no longer requiring an open backlog state. Close with a concise reason:
completed/shipped, not planned, duplicate, or superseded. A rejected idea is not erased; its closing note
preserves why it was declined when that context is useful.

`Done` is a Project-board display column for closed/completed records rather than a required open-issue
stage label.

## GitHub Project projection

Create one GitHub Project named **GalaQuest Product**. It is a visual control panel, not a second source
of truth.

Recommended primary board columns:

`Inbox -> Candidate -> Next -> Building -> Validate -> Done`

Keep `Icebox` as a separate status/column or filtered view so it does not dominate normal planning.

Recommended one-time configuration:

1. auto-add repository Issues carrying the `product` label;
2. create a Project Status field matching the board stages above;
3. when a record changes stage, update its `stage:*` Issue label first and mirror the Project Status
   when Project access is available;
4. if Project Status and the stage label drift, the Issue label is authoritative and the Project should
   be repaired;
5. do not store critical context only in a Project-only custom field.

This design keeps the system usable by agents that can read/write Issues but cannot manipulate GitHub
Projects directly.

## Label set

Keep the initial taxonomy intentionally small.

Required common label:

- `product`

Required type labels:

- `type:idea`
- `type:signal`
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

1. identify genuinely new ideas, signals, Owner decisions, superseded direction, and selected work;
2. search existing product Issues before creating a duplicate;
3. update the smallest existing record when it already owns the subject;
4. create a new record only when the thought deserves independent lifecycle or provenance;
5. promote settled Owner direction into `docs/product/PRODUCT_VISION.md` through a normal branch/PR when
   it is durable enough to belong there;
6. leave low-value conversational brainstorming in chat rather than turning the backlog into a transcript.

## From product record to implementation

When an idea graduates into work:

1. move or create the owning Initiative record and set it to `stage:next` or `stage:building`;
2. frame a bounded implementation objective under `docs/WORKFLOW.md`;
3. link the branch/brief/PR back to the Initiative or relevant product Issue;
4. keep implementation discoveries from silently expanding the current PR — capture separate candidate
   ideas instead;
5. when implementation is ready for product judgment, move the record to `stage:validate`;
6. record meaningful playtest evidence as a Signal Issue or a concise comment on the owning record;
7. close the record only when its product outcome is actually finished, deliberately declined, or
   superseded.

An Initiative may remain open across several small PRs. A PR should still contain one coherent,
reviewable product increment rather than becoming the backlog itself.

## Agent behavior

A fresh agent should be able to recover product state from the public repository plus live GitHub Issues
without reading historical chats.

Agents should:

- read `docs/product/PRODUCT_VISION.md` before making product-level assumptions;
- search product Issues before claiming an idea is new, decided, or currently prioritized;
- distinguish Owner decisions from agent suggestions and observations;
- add concise provenance when creating or materially changing a product record;
- link implementation work to its product reason;
- avoid creating duplicate backlogs in Markdown, spreadsheets, Notion, private notes, or chat;
- treat the GitHub Project as a convenient view over Issues rather than independent authority.

Agents may create/update product Issues when the current task or Production Director authorization permits
reversible coordination writes. A bounded implementation worker that is not authorized to create product
records should report the candidate finding to the Director instead of broadening its implementation.

## Issue templates

For human or agent-assisted capture, use:

- `.github/ISSUE_TEMPLATE/product-idea.yml`
- `.github/ISSUE_TEMPLATE/product-signal.yml`
- `.github/ISSUE_TEMPLATE/product-initiative.yml`

The templates preserve provenance and record shape. Labels remain the lifecycle/search authority after
the one-time label set has been created.
