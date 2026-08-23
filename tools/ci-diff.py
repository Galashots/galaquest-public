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
print('FIXED        :', fixed or 'none')
if hu:
    print('UNPROVEN     :', sorted(hu), '<- these ran nothing conclusive; re-check before trusting this diff')
sys.exit(1 if new else 0)
