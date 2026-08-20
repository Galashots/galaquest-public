/**
 * Direct visual handoff for the zero-API workflow. The .gqreview.json packet remains the structured
 * authority, but ChatGPT should also receive an actual PNG so the annotated pixels are available to
 * normal image understanding rather than buried inside JSON/base64 parsing.
 */
function imageFilename(packet) {
  const path = packet?.suggestedRepoPaths?.image;
  const name = typeof path === 'string' ? path.split('/').pop() : null;
  return name || 'galaquest-owner-review.png';
}

function downloadDataUrl(dataUrl, filename) {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.click();
}

export function installReviewImageDownload(reviewApi) {
  const button = document.querySelector('#review-export-image');
  const status = document.querySelector('#review-status');
  if (!button) throw new Error('review image export button is missing');

  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'capturing annotated PNG…';
    try {
      const packet = await reviewApi.buildPacket({ includeImage: true });
      if (!packet.image?.dataUrl) throw new Error('review packet contains no annotated image');
      const filename = imageFilename(packet);
      downloadDataUrl(packet.image.dataUrl, filename);
      status.textContent = `${filename} downloaded — upload it with the review packet in ChatGPT`;
    } catch (error) {
      console.error('[studio-review] image export failed', error);
      status.textContent = `image export failed: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });
}
