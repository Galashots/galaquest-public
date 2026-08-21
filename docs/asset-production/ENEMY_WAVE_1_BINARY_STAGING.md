# Enemy Wave 1 binary staging note

The Meshy provider generation is complete for 13 candidate enemies and GLB download has been proven. The GitHub connector available to this production session can create repository text/blob metadata but cannot ingest the already-downloaded local binary GLB files directly from the Meshy connector's local download surface.

Therefore this branch currently contains the authoritative task ledger and exact target filenames/paths, but **does not claim that the 13 GLB binaries are committed yet**.

Do not treat this note as a failure of the models. It is a transport limitation between the Meshy download surface and GitHub binary write surface.

The next local/worker step is mechanical: re-download each successful Meshy task by ID as GLB and place it at the path listed in `public/assets/enemies/candidates/README.md`, then commit those binaries to this branch. No additional Meshy credits are required for that download-only step.
