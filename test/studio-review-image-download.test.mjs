import test from 'node:test';
import assert from 'node:assert/strict';

import { installReviewImageDownload } from '../public/src/studio/reviewImageDownload.js';

function fakeDom() {
  let handler = null;
  const button = {
    disabled: false,
    addEventListener(type, fn) {
      assert.equal(type, 'click');
      handler = fn;
    },
  };
  const status = { textContent: '' };
  const anchor = {
    href: '',
    download: '',
    clicked: false,
    click() { this.clicked = true; },
  };
  return {
    button,
    status,
    anchor,
    document: {
      querySelector(selector) {
        if (selector === '#review-export-image') return button;
        if (selector === '#review-status') return status;
        return null;
      },
      createElement(tag) {
        assert.equal(tag, 'a');
        return anchor;
      },
    },
    async click() {
      assert.ok(handler, 'click handler was not installed');
      await handler();
    },
  };
}

test('annotated PNG handoff downloads the packet image using its repo-path filename', async () => {
  const dom = fakeDom();
  const priorDocument = globalThis.document;
  globalThis.document = dom.document;
  try {
    let buildOptions = null;
    const reviewApi = {
      async buildPacket(options) {
        buildOptions = options;
        return {
          image: { dataUrl: 'data:image/png;base64,AAAA' },
          suggestedRepoPaths: { image: 'docs/review-guides/sword/gq-palm-seat.png' },
        };
      },
    };
    installReviewImageDownload(reviewApi);
    await dom.click();

    assert.deepEqual(buildOptions, { includeImage: true });
    assert.equal(dom.anchor.href, 'data:image/png;base64,AAAA');
    assert.equal(dom.anchor.download, 'gq-palm-seat.png');
    assert.equal(dom.anchor.clicked, true);
    assert.equal(dom.button.disabled, false);
    assert.match(dom.status.textContent, /upload it with the review packet in ChatGPT/);
  } finally {
    globalThis.document = priorDocument;
  }
});

test('annotated PNG handoff fails closed when the packet has no image', async () => {
  const dom = fakeDom();
  const priorDocument = globalThis.document;
  const priorConsoleError = console.error;
  globalThis.document = dom.document;
  console.error = () => {};
  try {
    installReviewImageDownload({ async buildPacket() { return { image: null, suggestedRepoPaths: {} }; } });
    await dom.click();

    assert.equal(dom.anchor.clicked, false);
    assert.equal(dom.button.disabled, false);
    assert.match(dom.status.textContent, /review packet contains no annotated image/);
  } finally {
    globalThis.document = priorDocument;
    console.error = priorConsoleError;
  }
});
