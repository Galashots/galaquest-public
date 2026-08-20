export const REVIEW_PACKET_VERSION = 'galaquest-review-packet/1';

export const REVIEW_TYPES = Object.freeze([
  Object.freeze({ id: 'important-view', label: 'important view' }),
  Object.freeze({ id: 'fit-rule', label: 'fit rule' }),
  Object.freeze({ id: 'good-reference', label: 'good / reference' }),
  Object.freeze({ id: 'problem-area', label: 'problem area' }),
]);

const REVIEW_TYPE_IDS = new Set(REVIEW_TYPES.map(({ id }) => id));

function slug(value, fallback = 'review') {
  const result = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return result || fallback;
}

function stamp(iso) {
  return String(iso).replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function suggestedReviewPaths(reviewId, reviewTarget) {
  const targetDir = slug(reviewTarget, 'unknown-target');
  const id = slug(reviewId, 'review');
  return Object.freeze({
    manifest: `docs/review-guides/${targetDir}/${id}.json`,
    image: `docs/review-guides/${targetDir}/${id}.png`,
  });
}

export function buildReviewPacket({
  source,
  studioState,
  reviewType,
  title = '',
  note = '',
  annotations = [],
  imageDataUrl = null,
  createdAt = new Date().toISOString(),
  reviewId = null,
}) {
  if (!REVIEW_TYPE_IDS.has(reviewType)) {
    throw new Error(`unknown review type "${reviewType}"`);
  }
  if (!studioState || typeof studioState !== 'object') {
    throw new Error('studioState is required');
  }
  const target = studioState.reviewTarget ?? 'unknown-target';
  const id = reviewId ?? `gq-${slug(reviewType)}-${slug(target)}-${stamp(createdAt)}`;
  const paths = suggestedReviewPaths(id, target);
  const repository = source?.repository ?? 'Galashots/galaquest-public';
  const sha = source?.sha ?? null;
  const commitUrl = sha ? `https://github.com/${repository}/commit/${sha}` : null;

  return {
    schemaVersion: REVIEW_PACKET_VERSION,
    reviewId: id,
    createdAt,
    authority: {
      kind: 'owner-review-guidance',
      productionAuthority: false,
      visualAcceptance: false,
      note: 'Owner guidance for repeatable review. It does not by itself promote an asset or accept product appearance.',
    },
    source: {
      repository,
      ref: source?.ref ?? 'main',
      sha,
      commitUrl,
      studioUrl: source?.studioUrl ?? null,
    },
    review: {
      type: reviewType,
      title: String(title).trim() || `${reviewType}: ${target}`,
      note: String(note).trim(),
    },
    studioState: structuredClone(studioState),
    annotations: structuredClone(annotations),
    image: imageDataUrl
      ? { mimeType: 'image/png', dataUrl: imageDataUrl }
      : null,
    suggestedRepoPaths: paths,
  };
}

export function reviewPacketFilename(packet) {
  return `${slug(packet?.reviewId, 'gq-review')}.gqreview.json`;
}

export function chatHandoffText(packet) {
  const state = packet.studioState ?? {};
  const view = state.view ?? {};
  const sha = packet.source?.sha ?? packet.source?.ref ?? 'unbound';
  const note = packet.review?.note || '(no note)';
  return [
    'GQ-OWNER-REVIEW v1',
    `Packet: ${reviewPacketFilename(packet)}`,
    `Repo: ${packet.source?.repository ?? 'Galashots/galaquest-public'} @ ${sha}`,
    `Target: ${state.reviewTarget ?? 'unknown'}`,
    `View: ${view.scale ?? 'unknown'} / ${view.bearing ?? 'unknown'}`,
    `Clip: ${state.clipName ?? 'unknown'} @ ${Number(state.animationTimeSeconds ?? 0).toFixed(3)}s`,
    `Type: ${packet.review?.type ?? 'unknown'}`,
    `Note: ${note}`,
    'Instruction: ingest the uploaded review packet as GalaQuest owner review guidance and preserve its exact camera/pose context.',
  ].join('\n');
}
