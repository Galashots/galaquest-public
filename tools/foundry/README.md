# Foundry validation tools

`tools/foundry/` contains independent measurement/qualification helpers for character and animation
work. Treat each tool as authoritative only for the layer it actually measures, and verify that its
runtime dependencies exist before calling it a current gate.

## Blender topology qualification

The Blender-side qualification harness implements gates from
[`docs/foundry/topology/QUALIFICATION.md`](../../docs/foundry/topology/QUALIFICATION.md):

| File | Role |
| --- | --- |
| `gates.py` | pure reads/checks over Blender mesh data |
| `qualify.py` | opens a `.blend`, runs implemented gates, writes JSON |
| `fixture.py` | clean fixtures plus deliberate mutations |
| `prove_gates.py` | proves clean fixtures pass and target gates can fail |
| `verify-determinism.mjs` | deterministic-rebuild check |

Blender may not be on PATH. Resolve the executable from the current environment rather than storing a
machine-specific absolute path in repo guidance.

### Always pass `--python-exit-code`

Blender can exit 0 even when a `--python` script raises. Any automation that trusts its exit status must
supply a nonzero Python exception code:

```bash
blender --background --factory-startup --python-exit-code 42 --python <script> -- <args>
```

Without this, a failed build can be followed by validators reading stale output.

### Prove the gate harness before trusting it

```bash
blender --background --factory-startup --python-exit-code 42 --python tools/foundry/prove_gates.py -- \
  --out docs/foundry/topology/GATE-PROOF.json
```

Then qualify the actual candidate with `tools/foundry/qualify.py` and its manifest. The manifest is a
claim the gates verify; it is not optional for gates that depend on declared loops/static triangles.

## Shipping-GLB / animation helpers that are current

Useful public tools include:

- `tools/foundry/clip_inventory.mjs` — inspect clip inventory;
- `tools/foundry/verify_native_clip.mjs` — prove body/clip rest-skeleton compatibility;
- `tools/foundry/merge_clips.mjs` — merge compatible clips while re-checking the precondition;
- `tools/foundry/pose_anatomy.mjs` — measure skeleton/pose behavior;
- `tools/foundry/material_audit.mjs` — material inspection;
- `tools/foundry/measure_root_motion.mjs` — root-motion measurement.

Run the relevant unit tests with them; a green tool invocation is not blanket character acceptance.

## `verify-glb.mjs` is not currently a public gate

The file remains in the public tree as historical/unfinished validation work, but its former
second-reader/image-decoder support dependencies were **not safe-ported into this repository**. Do not
instruct a fresh public checkout to run it and do not count it as PASS/FAIL evidence until that support
is deliberately restored or the tool is rewritten to be self-contained.

This distinction is intentional: a checked-in script is not automatically an executable authority if
its dependency surface is absent. `test/guidance-integrity.test.mjs` prevents the runbook from routing a
new operator to dead dependency paths while leaving the historical source available for a later bounded
repair decision.
