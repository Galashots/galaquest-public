# The agent economy

**How to spend a free, unlimited judgment budget on a repository whose scarce resource is
execution.** Research and proposal, not yet authority. Every number below was measured against
`main@d18a74eb9aa4ed1f584adb1f035660bf8f30c94d` on 2026-08-20, from a checkout, a live API, or a
command that ran — none is carried forward from another document.

---

## 1. The economics, and the constraint that reorders them

| Resource | What it is | Price | What it cannot do |
|---|---|---|---|
| **Sol** — GPT-5.6, extra-high, plain chats | Frontier *judgment* | free, effectively unlimited | Touch anything |
| **GitHub Actions**, public repo | Frontier *execution* — Linux, Node, Chrome; 66–79 runner-minutes per matrix run | free and unlimited | Judge anything |
| **Claude Code** | The glue: read, decide, write, run, push | metered — the scarce one | — |

Judgment is free. Execution is free. **The expensive thing is the glue between them**, and every
proposal below should be read against one question: *does this shrink the glue?*

Then the constraint that changes the shape of the answer:

> **The ChatGPT GitHub connector is read-only.** OpenAI's own words: it *"only lets you read from
> your repositories to analyze and search your code. If you want to generate, edit, and push code
> directly to GitHub, that's available through our Codex product."*

The free surface — a plain chat with Sol — can **read** this repo and **cannot write a byte** to it.
Not a branch, not a file, not a comment, not a workflow dispatch. "Agent mode", which used to be the
escape hatch, was retired in early August 2026.

So PR #19 was **not** written by a plain chat. Its own body says *"the current ChatGPT container"* —
that is Codex cloud or ChatGPT Work, both of which have containers and metered budgets. **Confirming
which is the first open question in §10**, because it decides which budget every future write
spends.

That gives the real design rule, and it is not the obvious one:

> **Reads are free and unlimited. Writes are not. So make the repository maximally *readable*, and
> make writes few, large, and mechanical.**

In one line: **separate the thinking from the typing.** Sol should do a whole session's reasoning in
a plain chat and emit *one* self-contained commit packet — path, full file contents, commit message
— that a cheap carrier applies verbatim without thinking. Fifteen small writes cost fifteen metered
actions. One batched write costs one.

### 1.1 The write paths, ranked

| Path | Writes? | Cost | Notes |
|---|---|---|---|
| Plain chat + connector | ❌ | free | Read and search only. **The thinking tier.** |
| **Custom GPT + Actions + a GitHub PAT** | ✅ full REST | free on Plus/Pro | Branch, commit, PR, comment, **and `workflow_dispatch`**. Only callable inside that GPT; not schedulable. **Highest-value thing to test.** |
| Codex cloud task | ✅ branch + PR | ~10–60 tasks / 5 h on Plus | Documented, robust. |
| Codex Automations | ✅ | metered | The only *scheduled* write path. |
| `openai/codex-action` in CI | ✅ | bills the API, not the plan | No plan quota at all; runs on the runner. |
| Owner pastes | ✅ | 30 s of a human | Always available. Don't be too proud to use it. |

A widely repeated claim that OpenAI deprecated custom-GPT Actions in 2024 is **false** — they remain
documented and supported. That path is real.

### 1.2 The connector is an index, not a repository

The GitHub app is an "app with sync": repos are indexed into a vector store and queried there, not
fetched live. Initial indexing takes minutes; large orgs can take *days*; partial sync serves roughly
the last 30 days first. **Recent commits are not immediately visible**, and no refresh interval is
published.

This repo commits **2.5 times an hour, sustained** — 96 commits in 39 hours. At that velocity the
index is routinely several commits stale.

`AGENTS.md` already forbids exactly this failure: *"Refresh live GitHub state before relying on
remembered branch, PR, CI, or merge status."* **The connector is remembered state.** The rule for
Sol should therefore be explicit:

> The connector is for **discovery** — "where is the code that does X". It is never authority for
> **state**. Anything Sol asserts about current state must be bound to a SHA it fetched directly.

---

## 2. Before adding throughput: the signal is broken

**`full-playtest-matrix` has run 19 times on `main` since this repo was created. It has never once
been green.** Sixteen failures, three cancellations. On the current head, **13 of 27 harness jobs are
red**, at a cost of 66–79 runner-minutes per run.

That has been absorbed rather than fixed. Six merge commits carry a variant of the same sentence —
*"Every remaining red check on this head is red on main too"* — meaning somebody, on every merge,
differences two 27-element red sets by eye. It is the largest recurring clerical task in the project.

It is also **unsound**, which is worse than expensive. PR #19 changes two workflow files and not one
line of game code. Its red set is not `main`'s red set:

```
main @ d18a74e   13 red   drive-hero-screen  drive-lifecycle  drive-marks  drive-old-beacon
                          drive-ranger  drive-relight  drive-two-clients  drive-village
                          play-fight  review-hero-idle11  review-keeper-idle
                          review-keeper-turn  review-rowan-camp-composite

PR #19 head      12 red   the same set, minus drive-ranger and drive-two-clients,
                          plus drive-village-board
```

**Three of twenty-seven jobs flipped on identical game code.** The comparison performed by hand on
every merge cannot distinguish a regression from a coin flip, because the instrument's own variance
is the size of the thing being measured. GQ-009 already names this failure: *an instrument that can
only ever report "no defect" is not evidence.*

### 2.1 Four of the thirteen reds are two authorities disagreeing

`tools/runtime-test/review-suites.mjs` declares **eleven of the twenty-seven harnesses `gate: false`**
— measuring instruments whose product is captures for a person to read. Its header says why:

> Treating their exit code as a verdict would report a permanently green suite forever, which is
> worse than having no check at all.

`test/review-suite.test.mjs` already pins the matrix list against `SUITES.full`, so there is no list
drift — that half is enforced. But the same file contains two tests that point in opposite
directions:

- line 66 — *"the GitHub matrix fails closed on every non-zero harness exit"*
- line 111 — *"a harness marked as not-a-gate really does exit 0 unconditionally"*, whose scanner
  **explicitly whitelists exit code 2** as not-a-verdict (`exits.filter(e => e !== '0' && e !== '2')`)

So the repo simultaneously asserts that exit 2 is not a verdict *and* that any non-zero exit must
red the PR. Four instruments exit 2 (or crash) on **every hosted run**, because each needs a
candidate GLB under gitignored `tmp/` built from private Blender sources that cannot exist on a
runner. Reproduced here, exact codes:

| Job | Exit | Cause |
|---|---|---|
| `review-keeper-turn` | 2 | `candidate not found: tmp/ap2/keeper-turns.glb` |
| `review-keeper-idle` | 2 | `candidate not found: tmp/ap1/keeper-review.glb` |
| `review-hero-idle11` | 2 | `candidate not found: tmp/ap2/hero-idle11-raw.glb` |
| `review-rowan-camp-composite` | 1 | `ENOENT tmp/rowan-camp-audit/cart-candidate-mounted.glb` |

Three minutes of work, 31% of the red set explained, and the fix is a reconciliation rather than a
new rule: **an instrument whose declared input is absent should report `skipped: candidate absent`,
not `failed`.** A skip reported as a skip is honest and does not fail open.

Strip those four and the reproducible red is roughly **six** harnesses — the hosted-runner
frame-starvation family that `movement-diagnostic-probe.yml` exists to investigate — plus three that
flap. *That* is tractable. Thirteen indistinguishable reds is not.

### 2.2 A queueing detail that costs wall-clock

Free and Pro personal accounts are capped at **20 concurrent Actions jobs** (account-wide, not
per-repo). The matrix fans out to **27**. Seven jobs queue behind the first wave every run. It still
costs nothing; it just takes two waves. Trimming the four impossible jobs takes the fan-out to 23 —
still over, but closer.

---

## 3. The browser wall is real, and it is not ChatGPT's fault

PR #19 reports that its container's Chromium is enterprise-managed with `URLBlocklist: ["*"]` and
refuses even `127.0.0.1`. That reads like a ChatGPT limitation.

It isn't. **A Claude Code cloud session hits the same wall from the other side.** Chromium 141
launches fine there and answers on CDP port 9224 — but the game never boots
(`runtime never came up on http://127.0.0.1:5202/`), because loopback is routed through that
environment's managed proxy and the sandbox correctly refuses to let an agent disable it.

Two different AI clouds, two mechanisms, one outcome: **an agent container is not a place where a
browser can reach a local game server.** A GitHub Actions runner is. That is not a workaround, it is
the architecture — PR #19 got it right for a better reason than the one it gives.

Routing corollary: **do not plan around "Claude drives the browser locally".** In a cloud session it
cannot. Browser evidence comes from Actions or from the owner's desktop. Those are the only two.

---

## 4. What a read-only agent can already reach, free, with no credentials

`raw.githubusercontent.com` serves any file at any ref including binary PNGs; `codeload.github.com`
serves a zip of any ref; `api.github.com` serves repo metadata, workflow runs, job conclusions and
artifact *metadata*, at 60 requests/hour unauthenticated. Artifact *contents* and job *logs* require
an authenticated session **even on a public repo** — that is documented behaviour, not a
misconfiguration, and it is why third-party artifact proxies exist.

Which produces the best single trick available here, **verified end to end**:

```bash
curl -sSL -o main.zip https://codeload.github.com/Galashots/galaquest-public/zip/refs/heads/main
unzip -q main.zip && cd galaquest-public-main
node --test test/*.test.mjs
# 1236 tests, 1233 pass, 3 skipped, 14.1 s
```

10 MB, no git, no auth, no install, no CI round-trip: **14 seconds**. Any agent with a shell and Node
can verify this project's entire unit suite against any commit, branch or tag. Sol's container
already downloads artifacts and boots the game, so it has both halves.

That deserves to be a blessed, documented workflow rather than a trick, because it changes what "ask
Sol to check something" costs. Today a unit-level question routes through a branch, a PR and a CI
run. It should route through a 14-second command in Sol's own sandbox, with the SHA named in the
answer.

*(Measured in passing: the suite passes on Node **22.22.2**, though three workflows and their
comments insist on 24 for `node:sqlite`. Three tests skip. Worth two minutes to check whether that
comment is still true, since it is load-bearing in three files.)*

### 4.1 One caching rule, if results are published as files

`raw.githubusercontent.com` serves `cache-control: max-age=300` behind Fastly. On a **SHA-pinned**
URL that is harmless — the content is immutable, so a first fetch is always correct. On a **mutable
ref** it means a reader can see a five-minute-old body after a push. So: **a small mutable pointer
file plus SHA-addressed result blobs.** The pointer tolerates five minutes of lag; the blobs are
exact.

---

## 5. Three planes, and the one that is broken

**Control plane — GitHub.** Branches, files, PR comments, issues. The only medium every agent and
the owner can read. Healthy for reading; write-gated for Sol, per §1.

**Compute plane — Actions.** Free and unlimited on public repos, confirmed unaffected by the 2026
pricing changes. Chrome preinstalled. Healthy but under-exploited — see §6/B4: **fifteen pure-Node
instruments in `tools/` are run by no workflow at all.**

**Evidence plane — currently artifacts.** This is the broken one. An Actions artifact is an
auth-gated zip; **1,337 already exist**. A read-only agent cannot open one by URL, cannot diff one
against last week's, and cannot cite one durably. Job summaries are worse: rendered HTML on the run
page with no machine-readable API at all.

> *Evidence that only a credentialed downloader can open is evidence the free reasoning tier cannot
> use.*

**The highest-leverage structural change in this document is to move machine-readable evidence out
of artifacts and into the repository** — small committed JSON on an orphan branch, pixels staying in
artifacts or release assets. Then every claim is a raw URL, every regression is a `git diff`, and
Sol can audit CI history with no token and no index lag.

---

## 6. The build list, ranked by payoff ÷ glue

### B1 · Red-set differ with a flake classifier — **do this first**
On a PR, fetch `main`'s latest matrix job conclusions from the API, compute
`newly_red = pr_red − main_red`, **re-run only the newly-red harnesses twice more**, and post one
comment: `no new failures` / `NEW: drive-x (3/3 red)` / `FLAKE: drive-y (1/3 red)`. Write the same
verdict as JSON to the evidence branch.
*Cost:* one workflow, ~120 lines of Node. *Return:* deletes the largest recurring clerical task and
replaces a coin-flip comparison with a measured one.

### B2 · Reconcile the exit-2 contradiction
Make an instrument whose declared input is absent report `skipped`, and make the matrix treat that
as neutral — or drop those four from the hosted list entirely. The repo already believes both halves
of this (`review-suites.mjs`'s `gate: false`, `review-suite.test.mjs:119`'s exit-2 whitelist); only
the workflow disagrees.
*Cost:* an afternoon. *Return:* 13 red → ~9, four fewer log-reads per PR, and red starts meaning
something.

### B3 · The evidence branch
An orphan branch (`evidence`). Each matrix run commits `runs/<sha>/<harness>.json` — verdict, gate
flag, duration, assertion counts, error text, artifact name — plus a mutable `latest/main.json`
pointer (§4.1). Text only; heavy captures go to release assets, which have **unmetered bandwidth and
no total-size cap**.
Then `raw.githubusercontent.com/.../evidence/latest/main.json` is CI status with no token, and
`git log evidence -- runs/*/play-fight.json` is a flake history nobody has to remember.
*Mechanics that matter:* a `GITHUB_TOKEN` push does **not** re-trigger workflows, which is what stops
this looping; keep the branch orphan and periodically re-orphan it so history cannot grow without
bound; keep it unprotected, since branch protection blocks `GITHUB_TOKEN` pushes too.

### B4 · Run the instruments you already own
Fifteen pure-Node tools — `pose_anatomy.mjs`, `material_audit.mjs`, `clip_inventory.mjs`,
`glb_budget.mjs`, `measure_props.mjs`, `diagnose_keeper_turn.mjs`, `diagnose_swing_arbitration.mjs`
and others — run in a bare container against committed assets, need no browser and no Blender, and
are invoked by **no workflow**.

They are not idle: run today, `glb_budget.mjs` reports `hero.glb`, `wolf.glb` and `lantern_tree.glb`
all over the contract's LOD1 target (`wolf.glb` 10,435 vs 8,000). Whether those are genuine breaches
or the hero contract being applied to things that are not the hero is exactly the question nobody
can answer, **because the instrument is wired to nothing.** Wire it up, decide the scoping, and the
answer becomes durable.

Related: `test/glb-budget.test.mjs` restates measured triangle counts as literals rather than opening
the files, so its own header's claim — *"this test fails if the assets change underneath it"* — is
not true. That is GQ-007 wearing a hat.

### B5 · A front page for machines
A read-only agent's real cost is **context assembly** — 189 files to crawl before it can say
anything. Generate one small always-current digest: `main`'s SHA, the green/red set, open PRs and
their gate states, what is blocked and on whom, which briefs are open. Regenerated by CI on every
push.
*Return:* turns "read the repo" from an expensive crawl into one fetch — and because it is
committed, it is what the connector's index will actually pick up.

### B6 · Move `sol-review` off the desktop and onto Actions
`tools/sol-review/` (1,034 LOC) is good design on a fragile substrate: it needs the owner's machine
awake, a local Chrome on 9224, and a Google Drive mount. None of that is necessary now.

Keep everything that makes it safe — the closed `mode` enum, `additionalProperties: false`, the
trusted schema stored beside the worker rather than the requester-controlled copy, the seen-sequence
replay guard, the detached-worktree exact-SHA checkout. Change only the transport: **the request
arrives as a commit on a control branch, and the result is committed to the evidence branch.**

`push` is the one trigger that runs from the pushed branch rather than the default branch, so a
file-writing agent can fire it with `contents: write` alone. Two sharp edges:

- **Never let the request branch carry the workflow.** The workflow definition lives on `main` and
  reads the request with `git show <control-branch>:<path>`, so a request can never modify its own
  executor. The executing job gets `contents: read` and no secrets.
- Writing anything under `.github/workflows/` needs a separate `workflows: write` permission that
  `GITHUB_TOKEN` does not have at all. Seed workflows by hand; let agents write only data files.

*Return:* `studioCapture` / `studioState` / `studioFitEnvelope` go from "works when the desktop is
on" to "works always, free, for whoever asks".

### B7 · An issue-form work queue, and briefs as a schema
The repo has **zero issues**; Sol's output lands in a chat transcript and is re-derived by whoever
picks it up next. YAML issue forms give a schema-validated intake with auto-labelling, which is the
best structured channel an agent that can only open issues will ever get. Fields should be the
vocabulary this repo already speaks: task ID, bounded file surface, acceptance seams, gates, stop
conditions, cited `GQ-NNN` rules, and the exact SHA the brief was written against. Labels route:
`agent:sol`, `agent:claude`, `needs:owner-eyes`, `blocked:asset`, `evidence:pending`.
*Return:* converts free judgment into queued, executable work. This is the single biggest multiplier
on Sol's free tier — and note that opening an issue is a **write**, so it is exactly the kind of
thing to batch (§1) or hand to a custom GPT with Actions.

### B8 · A daily watchdog, with two traps to avoid
A scheduled ChatGPT task **can** use connectors, so it can read and report: new reds, dead doc paths,
`MISTAKES` entries past their promotion trigger, stale `Foreknowledge helped: not yet recorded`
lines. Plus 5 active tasks on Plus, 15 on Pro; minimum cadence one hour.

If the writing half matters, run it as an Actions cron instead — and mind two documented traps:
**scheduled workflows in a public repo are automatically disabled after 60 days with no repository
activity**, and schedules on the hour are the most likely to be delayed or dropped. Pick `:17`, not
`:00`.

### B9 · Cheap checks that do not exist
Each is a small `test/*.test.mjs`: free, inside the 14-second suite, zero CI minutes. The repo
already has 27 source-scanning meta-tests, so this is an established idiom, not a new one.

1. **Dead-path check** — every repo-relative path named in a tracked file must exist. **At least 14
   are dangling** by a narrow grep of `.md` files alone, and a broader sweep finds more. Among them:
   `tools/meshy/flatten_bg.py`, which `docs/pipeline/references.md` calls a *mandatory* vetting step;
   `docs/teardown/hero_contract.schema.json`, which the character-foundry skill's step 3 orders
   agents to open. Worst of all, in
   `.agents/skills/galaquest-character-foundry/references/authority-map.md` — the file that skill's
   step 2 tells agents to read *before anything else* — **twelve of the thirteen link targets do not
   resolve**, and four of them are the literal string `](the private engineering archive)`, a
   scrubbing placeholder that was substituted inside the link target. One authority in the authority
   map is reachable. `AGENTS.md` already says a stale path must be repaired or reported.
2. **Guest-id minting** — every navigating harness mints through `sanitizeGuestId`. Only four of
   fourteen do. `drive-cart-loot.mjs:90` builds `` `gp2-cart-loot-${label}-${randomUUID()}` `` =
   14 + 12 + 1 + 36 = **63 characters against a 64-character cap**, with no sanitize. GQ-008's hit 3
   names this file as the next one to break; it is one character from breaking.
3. **One `class CDP`** — the ~37-line CDP client is copy-pasted into **29 files**, in at least ten
   distinct variants, with request timeouts split between 20,000 ms and 30,000 ms. GQ-007 at the
   scale of a whole subsystem, checked by nothing.
4. **Workflow permissions floor** — every workflow declares `permissions:`; no comment-triggered job
   holds `contents: write` or secrets.
5. **Ledger discipline** — `test/mistakes-ledger.test.mjs` checks ENFORCED→file-exists, ID
   uniqueness, and RULE-at-3+→has-reason. It does not check OBSERVED-at-2+, and one entry currently
   sits at OBSERVED with three hits.

### B10 · Pixels Sol can open
The visual loop's last manual link is a hand-carry: the owner downloads a PNG and a `.gqreview.json`
packet and **uploads both into the ChatGPT project by hand**. (`docs/review-guides/` currently
contains only its README — zero packets have been normalized. The loop is built and unused.)

Have the review workflow commit a downscaled contact sheet to the evidence branch and publish
captures where a URL can reach them, so a chat can be pointed at an image instead of fed one.
*This takes the owner's hands out of the loop and leaves the owner's eyes in it* — which is the part
that must never be automated.
*Caveat:* whether the connector reads repo **binaries** is unconfirmed; assume not, and plan on a URL
handed to the chat rather than a connector lookup. If publishing to Pages, note that a
`GITHUB_TOKEN` commit to `gh-pages` **does not trigger a Pages build** — use the Actions-native
`upload-pages-artifact` / `deploy-pages` path.

### B11 · Make owner-only boundaries structural
Actions **Environments with required reviewers are free on public repos on every current plan** —
including Free. A job with `environment: owner-approval` blocks, rather than fails, until a person
clicks approve; up to six reviewers, one approval needed, self-review can be disabled, and the wait
can run 30 days.

That is the correct home for every owner-only transition `AGENTS.md` currently states in prose —
Meshy spend, merges, asset promotion. **A gate that is a property of the system beats a gate that is
a property of an agent's compliance.**

### B12 · Verify PR #20's transport before relying on it
The Render blueprint is the right idea — a public URL converts "an agent needs to see the game" into
something any browser-driving agent can use. But two free-plan properties need checking before the
co-op claim in `docs/public-playtest.md` holds: whether Render's free plan carries **WebSockets** at
all, and that its documented spin-down **closes open connections without warning**, which is fatal
mid-session. If either bites, the static client can go to Pages for free and only the authoritative
server needs a home — and among current free tiers, the ones that clearly do WebSockets without cold
starts are edge runtimes rather than Node hosts, which would mean a port rather than a deploy.

---

## 7. Routing: who does what

| Work | Route to | Why |
|---|---|---|
| Design, art direction, world and dialogue, product judgment | **Sol, plain chat** | free, frontier, already the design lead |
| Diff review against the ledger; test-gap, doc and consistency audits | **Sol, plain chat** | pure text; two shipped fixes already came from exactly this |
| CI red triage from logs + harness source | **Sol, plain chat** | 12–13 per run, pure reading, the highest-volume recurring cost |
| Reference-image generation for the Meshy pipeline | **Sol** | image generation is included, and is already step 1 of the pipeline |
| Writing briefs, issue bodies, PR prose | **Sol drafts → one batched write** | thinking is free, typing is not |
| Unit-level verification of any SHA | **Sol's own container** | zip → `node --test` → 14 s, no CI |
| Anything needing a browser | **GitHub Actions** | the only free plane where a browser reaches the game |
| The pure-Node instruments | **GitHub Actions** | free, currently run by nothing |
| Multi-file implementation, refactors, pushes | **Claude Code** | the glue tier; spend it on what only it can do |
| Whether the game *looks* right | **the owner** | not delegable, by this repo's own rules |

---

## 8. Risks worth naming before building any of this

**An agent-authored workflow file is a supply-chain change.** PR #19 is the pattern: a chat proposed
two workflows. Workflow files can read secrets and push. Every agent-authored workflow needs the
review a dependency bump would get — least-privilege `permissions:`, no secrets in comment-triggered
jobs, and no job that executes content from the branch that requested it.

**The `/director-playtest` owner gate is weaker than it looks.** It tests
`comment.user.login == repository_owner`. Anything acting *as* the owner's account passes — which is
the point, and also the risk. It is a good gate against accident, not against compromise.

**Prompt injection has a real surface here.** Agents read `AGENTS.md`, `MISTAKES.md`, PR bodies and
CI logs and treat them as instruction. Any of those an outside contributor can write is an injection
vector. Keep the authority files owner-controlled and treat PR-body text as data.

**Green is not accepted.** Everything above makes evidence cheaper to produce, which makes it easier
to mistake evidence for acceptance. The rule holds and should be restated in whatever lands:
*running-game pixels are final appearance authority; a machine metric can reject a result, never
accept one.*

**Automation multiplies whatever the signal already is** — which is why B1 and B2 come before
everything else.

---

## 9. What not to automate

- **Visual acceptance.** The owner's eyes, in the running game, at gameplay framing.
- **The children's playtest.** The most valuable finding of the last week — a ceremony spending
  itself on an empty room — was found by playing the purchase from where the money is actually
  earned, after every harness had bought it standing at the door.
- **Opening the captures.** Two ledger entries exist solely because captures were produced and never
  looked at.
- **Merging, Meshy spend, asset promotion, proportion locks** — the owner-only transitions.
- **The `MISTAKES.md` promotion decision.** A machine can *detect* a 3+-hit `RULE` with no test;
  whether a lesson is genuinely new is judgment.
- **Calling a red harness "flake".** Measure it (B1); never assert it.

---

## 10. Resolve these four before building

1. **Which ChatGPT surface wrote PR #19?** A plain chat cannot have (read-only connector), so it was
   Codex or Work. It determines which budget every write spends.
2. **Does a custom GPT with Actions + a PAT work on this account?** ~30 minutes to test. If yes, the
   free tier gains a full write path — including `workflow_dispatch` — and most of the glue in §1
   disappears.
3. **Can the connector read Actions logs or artifacts on a consumer plan?** Only the *Enterprise app
   template* documents those permissions. If not — and assume not — B3 stops being an optimisation
   and becomes a prerequisite.
4. **Can Sol's browsing fetch `raw.githubusercontent.com`?** One message answers it, and the entire
   read path in §4 depends on it.
