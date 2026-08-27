#!/usr/bin/env python3
"""Diff a matrix run's job outcomes against the base run's.

The discipline this exists for: "the matrix is known debt" is true and it is also how a real
regression of mine hid for six commits. Reasoning from a remembered failing set is not the same as
diffing the actual job lists, and only one of those catches a harness that flipped.

FAILED and UNPROVEN are reported separately, and that split is itself a lesson. The first version
counted only `conclusion == "failure"`, so when the keystone broke drive-old-beacon and the runner
CANCELLED that job -- superseded by my next push a few minutes later -- the tool said the run was
clean. It hid a real regression for two runs. A cancelled job has not told us anything about the
code; it is not a failure, and it is not a pass either, and collapsing it into either one is how you
get a confident wrong answer.

ONE WORKFLOW IS NOT "THE CI", and that is the third lesson here, learned the expensive way. This
tool was written to diff a full-playtest-matrix job list, so that is what it saw -- and the
forge-review workflow's `browser-proof` check sat red for fourteen hours while every diff this tool
printed said the head was clean. It was clean, of the one workflow it was looking at. The head SHA
had nine failing checks and this reported eight.

So prefer the SHA mode: `/commits/{sha}/check-runs` returns EVERY check on a commit, whatever
workflow raised it, which is the only listing that cannot quietly omit one.

Usage:
  ci-diff.py --sha <base-sha> <head-sha>        every check on each commit (preferred)
  ci-diff.py <base-jobs.json> <head-jobs.json>  one workflow's job list, saved to disk
The file form is what mcp__github__actions_list(list_workflow_jobs) writes.
"""
import json, os, sys, urllib.request

REPO = os.environ.get('GQ_REPO', 'Galashots/galaquest-public')


def bucket_names(rows, name_of, status_of, conclusion_of):
    """Shared by both modes so they can never disagree about what counts as proven."""
    failed, unproven = set(), set()
    for row in rows:
        if status_of(row) != 'completed':
            unproven.add(name_of(row))
        elif conclusion_of(row) == 'failure':
            failed.add(name_of(row))
        elif conclusion_of(row) not in ('success', 'skipped', 'neutral'):
            unproven.add(name_of(row))         # cancelled, timed_out, action_required
    return failed, unproven, len(rows)


def checks_for(sha):
    """Every check run on one commit, across all workflows, latest attempt per check name.

    PAGINATED, and DEDUPLICATED BY NAME. A commit that has been re-run, or that is the head of main
    and has collected scheduled runs, carries far more than one page: base 82478ea has 167 rows for
    about thirty distinct checks. Taking the first page gave `0 failed of 100` for a base that has
    eleven -- a confidently wrong answer, which is the specific thing this whole tool exists to stop.
    Highest id wins, because ids increase with time and a re-run is the answer that stands.
    """
    latest = {}
    total = None
    page = 1
    while True:
        url = (f'https://api.github.com/repos/{REPO}/commits/{sha}/check-runs'
               f'?per_page=100&page={page}')
        request = urllib.request.Request(url, headers={'accept': 'application/vnd.github+json'})
        token = os.environ.get('GITHUB_TOKEN')
        if token:
            request.add_header('authorization', f'Bearer {token}')
        with urllib.request.urlopen(request) as response:
            payload = json.load(response)
        total = payload['total_count'] if total is None else total
        runs = payload['check_runs']
        if not runs:
            break
        for run in runs:
            seen = latest.get(run['name'])
            if seen is None or run['id'] > seen['id']:
                latest[run['name']] = run
        page += 1
        if page > 20:                          # 2000 rows is far past anything real; do not spin
            print(f'WARNING: {sha} paging stopped at 2000 rows')
            break
    return bucket_names(list(latest.values()), lambda c: c['name'], lambda c: c['status'],
                        lambda c: c['conclusion'])

def buckets(path):
    d = json.load(open(path))
    jobs = d['jobs']['jobs'] if isinstance(d.get('jobs'), dict) else d['jobs']
    return bucket_names(jobs, lambda j: j['name'], lambda j: j.get('status'), lambda j: j.get('conclusion'))


def conclusion_history(name, head_sha, depth=12):
    """How `name` has concluded on the last `depth` commits leading to head_sha.

    TWELVE, not six, and the number was measured rather than picked. Six was the first draft, and
    run against the exact diff that fooled me it reported `.....X` for both checks -- "stable, then
    broke", the same wrong story. The window has to be long enough to contain the previous flap:
    drive-touch's was five commits further back than six reached. Twelve costs about a minute when
    there are new failures and nothing at all when there are none.

    A NEW FAILURE IS NOT EVIDENCE OF CAUSATION WHEN THE HARNESS FLAPS, and on 2026-08-23 I reverted
    a proven bug fix because I forgot that. Two checks went red on my commit having been green on the
    one before it; I read "the only difference is mine" and reverted. drive-marks then went red on
    the REVERT as well -- whose tree was byte-identical to a head where it had passed -- and
    drive-touch came back green. Both were flakes. I had posted a table of exactly which harnesses
    flap, to this same PR, forty minutes earlier, and did not look at it.

    So the diff carries the history now. A tool that reports "NEW FAILURES: drive-marks" and makes
    the reader remember whether drive-marks is trustworthy is a tool that will be believed on the day
    the reader does not remember.
    """
    url = f'https://api.github.com/repos/{REPO}/commits?sha={head_sha}&per_page={depth}'
    request = urllib.request.Request(url, headers={'accept': 'application/vnd.github+json'})
    token = os.environ.get('GITHUB_TOKEN')
    if token:
        request.add_header('authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(request) as response:
            commits = [c['sha'] for c in json.load(response)]
    except Exception as error:                 # history is a courtesy; never fail the diff for it
        return f'(history unavailable: {error})'

    marks = []
    for sha in commits:
        failed, unproven, _ = checks_for(sha)
        marks.append('X' if name in failed else ('?' if name in unproven else '.'))
    flaps = sum(1 for a, b in zip(marks, marks[1:]) if a != b)
    # Oldest first reads like a timeline; the head is the last character.
    return f"{''.join(reversed(marks))}  ({flaps} flip(s) over {len(marks)} heads, '.'=green X=red ?=unproven)"


if sys.argv[1:2] == ['--sha']:
    bf, bu, nb = checks_for(sys.argv[2])
    hf, hu, nh = checks_for(sys.argv[3])
else:
    bf, bu, nb = buckets(sys.argv[1])
    hf, hu, nh = buckets(sys.argv[2])
    print('NOTE: one workflow only -- prefer --sha, which sees every check on the commit')
print(f'base: {len(bf)} failed, {len(bu)} unproven of {nb}')
print(f'head: {len(hf)} failed, {len(hu)} unproven of {nh}')
new, fixed = sorted(hf - bf), sorted(bf - hf)
print('NEW FAILURES :', new or 'none')
# Each one with its own recent record, so "new against this base" is never read as "caused by this
# commit" without the reader seeing how often that check flips on its own.
if new and sys.argv[1:2] == ['--sha']:
    for name in new:
        print(f'   {name}: {conclusion_history(name, sys.argv[3])}')
print('FIXED        :', fixed or 'none')
if hu:
    print('UNPROVEN     :', sorted(hu), '<- these ran nothing conclusive; re-check before trusting this diff')
sys.exit(1 if new else 0)
