import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// This is intentionally a source-seam regression around attachGameServer's private process latch.
// The bug lives in orchestration, not rewardStore: an ephemeral-only victory makes every
// recordBeaconLit() call return applied:false, then the server currently marks beaconLitRecorded true
// anyway and never retries when a durable guest later joins. The store and siege can both be
// individually correct while a restart still puts the Beacon out.
//
// Prefer replacing this with a full attachGameServer restart test once that harness has a cheap
// injectable WebSocket/server clock seam. Until then, this red gate prevents the exact unconditional
// latch from surviving a review fix disguised as prose.
test('Beacon persistence latch is set only after a durable write actually succeeds', () => {
  const source = readFileSync(new URL('../net/gameServer.mjs', import.meta.url), 'utf8');
  const block = source.match(
    /if \(!beaconLitRecorded && simulation\.beaconIsLit\(\)\) \{([\s\S]*?)\n    \}/,
  )?.[1] ?? '';

  assert.ok(block.includes('recordBeaconLit'), 'could not find the Beacon persistence loop');
  assert.doesNotMatch(
    block,
    /for \([^]*?\) \{[^]*?if \([^]*?\.applied\) break;[^]*?\}\s*beaconLitRecorded = true;/,
    'an ephemeral-only victory must not permanently latch “recorded” after every durable write failed',
  );

  // The safe shape is deliberately broad: either the successful record call assigns/latches inside
  // the applied branch, or the loop tracks a boolean and assigns from that. What matters is that a
  // failed pass leaves beaconLitRecorded false so the next tick can retry when a durable identity
  // exists.
  assert.match(
    block,
    /(if \([^\n]*\.applied\)[^]*beaconLitRecorded = true|beaconLitRecorded\s*=\s*[^;]*(applied|recorded|durable))/,
    'latch must be coupled to a successful durable write rather than to the fact a retry was attempted',
  );
});
