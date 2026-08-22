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

Usage: ci-diff.py <base-jobs.json> <head-jobs.json>
Both files are what mcp__github__actions_list(list_workflow_jobs) saves to disk.
"""
import json, sys

def buckets(path):
    d = json.load(open(path))
    jobs = d['jobs']['jobs'] if isinstance(d.get('jobs'), dict) else d['jobs']
    failed, unproven = set(), set()
    for j in jobs:
        if j.get('status') != 'completed':
            unproven.add(j['name'])
        elif j.get('conclusion') == 'failure':
            failed.add(j['name'])
        elif j.get('conclusion') not in ('success', 'skipped'):
            unproven.add(j['name'])            # cancelled, timed_out, action_required
    return failed, unproven, len(jobs)

bf, bu, nb = buckets(sys.argv[1])
hf, hu, nh = buckets(sys.argv[2])
print(f'base: {len(bf)} failed, {len(bu)} unproven of {nb}')
print(f'head: {len(hf)} failed, {len(hu)} unproven of {nh}')
new, fixed = sorted(hf - bf), sorted(bf - hf)
print('NEW FAILURES :', new or 'none')
print('FIXED        :', fixed or 'none')
if hu:
    print('UNPROVEN     :', sorted(hu), '<- these ran nothing conclusive; re-check before trusting this diff')
sys.exit(1 if new else 0)
