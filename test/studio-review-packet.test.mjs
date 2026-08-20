import test from 'node:test';
import assert from 'node:assert/strict';

import {
  REVIEW_PACKET_VERSION,
  REVIEW_TYPES,
  buildReviewPacket,
  chatHandoffText,
  reviewPacketFilename,
  suggestedReviewPaths,
} from '../public/src/studio/reviewPacket.js';

const state = {
  studioVersion: 'galaquest-character-studio/1',
  character: 'hero',
  clipName: 'idle',
  animationTimeSeconds: 0.42,
  playing: false,
  view: { scale: 'closeup', bearing: 'opposite-side' },
  lightingMode: 'game',
  lightingAuthoritative: true,
  viewport: { width: 768, height: 1024 },
  loadout: 'candidate-wildwood-blade',
  loadoutIsShipping: false,
  loadoutGearProvenance: 'contains-candidate',
  reviewTarget: 'sword_wildwood_w1a',
  gear: [],
  overlay: 'none',
};

const source = {
  repository: 'Galashots/galaquest-public',
  ref: 'main',
  sha: '0123456789abcdef0123456789abcdef01234567',
  studioUrl: 'https://example.invalid/studio.html',
};

test('review types are the four owner-intent categories', () => {
  assert.deepEqual(REVIEW_TYPES.map(({ id }) => id), [
    'important-view', 'fit-rule', 'good-reference', 'problem-area',
  ]);
});

test('packet binds owner note to exact repo, target, view, clip and time', () => {
  const packet = buildReviewPacket({
    source,
    studioState: state,
    reviewType: 'fit-rule',
    title: 'Palm seating',
    note: 'Check the hilt inside the palm from this side.',
    annotations: [{ tool: 'circle', start: { x: 0.4, y: 0.5 }, end: { x: 0.6, y: 0.7 } }],
    imageDataUrl: 'data:image/png;base64,AAAA',
    createdAt: '2026-08-20T01:40:00.000Z',
  });

  assert.equal(packet.schemaVersion, REVIEW_PACKET_VERSION);
  assert.equal(packet.source.sha, source.sha);
  assert.equal(packet.source.commitUrl, `https://github.com/${source.repository}/commit/${source.sha}`);
  assert.equal(packet.studioState.reviewTarget, 'sword_wildwood_w1a');
  assert.deepEqual(packet.studioState.view, { scale: 'closeup', bearing: 'opposite-side' });
  assert.equal(packet.studioState.animationTimeSeconds, 0.42);
  assert.equal(packet.review.note, 'Check the hilt inside the palm from this side.');
  assert.equal(packet.annotations.length, 1);
  assert.equal(packet.image.mimeType, 'image/png');
});

test('review packet is guidance, never automatic promotion or visual acceptance', () => {
  const packet = buildReviewPacket({ source, studioState: state, reviewType: 'good-reference' });
  assert.equal(packet.authority.kind, 'owner-review-guidance');
  assert.equal(packet.authority.productionAuthority, false);
  assert.equal(packet.authority.visualAcceptance, false);
});

test('suggested repo paths are stable and target-scoped', () => {
  assert.deepEqual(
    suggestedReviewPaths('GQ Palm View #1', 'Sword Wildwood W1A'),
    {
      manifest: 'docs/review-guides/sword-wildwood-w1a/gq-palm-view-1.json',
      image: 'docs/review-guides/sword-wildwood-w1a/gq-palm-view-1.png',
    },
  );
});

test('packet filename is one uploadable .gqreview.json file', () => {
  const packet = buildReviewPacket({
    source,
    studioState: state,
    reviewType: 'problem-area',
    reviewId: 'Palm / collision 01',
  });
  assert.equal(reviewPacketFilename(packet), 'palm-collision-01.gqreview.json');
});

test('ChatGPT handoff names the exact reproducible review context', () => {
  const packet = buildReviewPacket({
    source,
    studioState: state,
    reviewType: 'important-view',
    note: 'This is the angle to use for hand seating.',
    reviewId: 'hand-seating-view',
  });
  const handoff = chatHandoffText(packet);
  assert.match(handoff, /sword_wildwood_w1a/);
  assert.match(handoff, /closeup \/ opposite-side/);
  assert.match(handoff, /idle @ 0\.420s/);
  assert.match(handoff, /0123456789abcdef/);
  assert.match(handoff, /ingest the uploaded review packet/);
});

test('unknown review types fail closed', () => {
  assert.throws(
    () => buildReviewPacket({ source, studioState: state, reviewType: 'looks-good-ish' }),
    /unknown review type/,
  );
});

test('packet snapshots input state instead of keeping mutable references', () => {
  const mutableState = structuredClone(state);
  const annotations = [{ tool: 'arrow', start: { x: 0.1, y: 0.2 }, end: { x: 0.3, y: 0.4 } }];
  const packet = buildReviewPacket({ source, studioState: mutableState, reviewType: 'fit-rule', annotations });
  mutableState.view.bearing = 'front';
  annotations[0].end.x = 0.99;
  assert.equal(packet.studioState.view.bearing, 'opposite-side');
  assert.equal(packet.annotations[0].end.x, 0.3);
});
