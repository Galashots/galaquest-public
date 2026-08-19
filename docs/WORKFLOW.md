# WORKFLOW.md — how sessions hand off work in this repo

Adopted from [u/oxmannnn's r/ClaudeCode workflow post](https://www.reddit.com/r/ClaudeCode/comments/1vmey7d/my_claude_code_workflow_after_months_of_daily_use/)
and the thread's top comment thread on a lessons ratchet (u/thabxi, u/LividCan4323, u/9PcNugget). The
ratchet itself lives in `docs/MISTAKES.md`; this file is the roles-and-handoff half of the same
adoption.

## Roles

**One brain session per repo, on Opus.** Plans, decides, audits, authors briefs. Writes no feature
code. The `the private engineering archive` audit is brain work: it measured,
found, and recommended, but did not edit runtime files.

**Worker sessions, on Sonnet.** Execute exactly one brief, start to finish, sequentially, without
spawning further agents unless the brief explicitly says otherwise and why (see
`docs/briefs/TEMPLATE.md`). This document you're reading was itself produced by a worker session
following that model.

**Post tip 9: the brief names its model, and the brain verifies the worker is on it.** A brief that
says "Model: Sonnet" and gets executed by anything else is a broken handoff — the brain should check
before trusting the result, not after.

## Handoff is a committed file, not a live chat

The source post: *"create the chats, name them, and leave them empty until the brain chat writes into
them."* u/9PcNugget's stronger version, adopted here: *"the handoff is a committed file, not a live
chat — full audit trail, nothing critical in volatile context."*

This repo already half-does this via `the private engineering archive<X>/{brief.md,progress.md,state.md}`
(see `the private engineering archive` and `C-combat-sounds/` for the existing shape). That
directory is now **the** mechanism, not an example of one:

- `brief.md` — written by the brain before the worker starts. What `docs/briefs/TEMPLATE.md` fields
  fill in.
- `progress.md` — updated by the worker as it goes, so a session that stops mid-phase leaves a real
  trail instead of a half-remembered context window.
- `state.md` — the worker's exit note: what landed, what's proven, what's still open.

Nothing load-bearing may live only in chat history. If it isn't in git, the next session cannot see
it.

## One task = one session; no compaction

History lives in git and `docs/handoffs/`, not in a context window. A worker writes a handoff (or a
phase `state.md`) when it stops — whether it finished or got blocked — and the next session opens by
reading it, not by asking the previous session what happened. Compacting a long-running session's
context to keep going is a sign the task should have been split into a new phase and a new brief
instead.

## Standing smoke-check rule

Post tip 8, called *"the best tip in this thread"* by the most detailed commenter, and the rule the
2026-08-14 audit's P0.3 finding shows this repo was missing in practice:

> A phase does not close until a **committed** harness drives the whole path end to end in the
> running game and passes. A probe that was not committed did not happen. Green unit tests are not a
> smoke check, and a render is not the game.

This is the same principle AGENTS.md's "Playtests are mandatory" states for visual claims, generalized
to every phase: proof that cannot be re-run by the next session is a memory, not evidence.

## Session start/end checklist

**At session start:**
1. Read `the private engineering archive` — the live snapshot.
2. Read the relevant `the private engineering archive<X>/` directory if resuming a phase, or the assigned
   `docs/briefs/<name>.md` if starting fresh work.
3. Read `docs/MISTAKES.md` and note which `GQ-NNN` entries apply to the task.
4. Run `node --test test/*.test.mjs` and read the real count off the run — never trust a number in a
   document (see `docs/MISTAKES.md` GQ-003).

**At session end:**
1. Run the suite again; it must still be green, with the real count restated in the commit or handoff.
2. `git rev-list --count origin/main..main` must read `0` — everything committed is pushed. Agents may
   push to `main` freely (see AGENTS.md's publishing boundary); this checklist item is what makes that
   safe.
3. After a push, read the real result off `gh run list` — state what it says, don't assert what you
   expect it to say.
4. **Guidance ratchet pass** (mandatory, added 2026-08-16 per the SR3 runtime-identity incident —
   `the private engineering archive`). `docs/MISTAKES.md` is read at session start, but
   until now nothing required writing new lessons back for the *next* session to read. Before writing
   `state.md`/`progress.md`:
   1. Review the session for new failures, corrections, false assumptions, misleading green checks,
      manual discoveries, or operator knowledge that would matter to the next competent agent.
   2. Search `docs/MISTAKES.md` before adding anything.
   3. First hit → add/update `OBSERVED`; repeated same-class hit → promote per the ratchet's own
      mechanical rules (see the table at the top of that file).
   4. If the lesson changes how a future operator should work, update the runbook, skill, phase brief,
      schema documentation, or test they will actually read/use **in the same guidance pass** — a
      `MISTAKES.md` line by itself is not enough when the operating procedure has changed.
   5. Record the outcome in `state.md`/`progress.md` as `Guidance ratchet: ...`.
      `Guidance ratchet: no new lesson` is valid only after the review was actually performed, not as
      a default when the step was skipped.

   The principle: a fix that stays only in code or chat fixes one incident; a fix plus updated
   guidance changes the project.
5. Write or update the phase's `state.md` / `progress.md`, or a `docs/handoffs/` entry for
   cross-cutting work that doesn't belong to one phase — including the guidance-ratchet line from
   step 4.
