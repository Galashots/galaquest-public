import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  CLOSE,
  MAX_PAYLOAD_BYTES,
  OPCODE,
  acceptKey,
  decodeFrame,
  encodeClose,
  encodeFrame,
  encodeMaskedFrame,
  encodeText,
  handshakeResponse,
} from '../net/wsFrame.mjs';

// RFC 6455 section 1.3 publishes this exact key/accept pair as a worked example. Asserting against
// it means the test would still catch a wrong digest, a wrong GUID or base64 of the wrong bytes --
// none of which a test that recomputed our own sha1 could see.
test('the handshake digest matches the RFC 6455 worked example', () => {
  assert.equal(acceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

test('the handshake response is a well-formed 101 with CRLF line endings', () => {
  const response = handshakeResponse('dGhlIHNhbXBsZSBub25jZQ==');
  assert.ok(response.startsWith('HTTP/1.1 101 Switching Protocols\r\n'));
  assert.ok(response.includes('\r\nUpgrade: websocket\r\n'));
  assert.ok(response.includes('\r\nConnection: Upgrade\r\n'));
  assert.ok(response.includes('\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n'));
  // Must terminate with a blank line or the browser waits forever for more headers.
  assert.ok(response.endsWith('\r\n\r\n'), 'headers must end with an empty line');
});

// RFC 6455 section 5.7's single-frame masked "Hello". Byte-for-byte external authority for the
// unmask path, which is the one piece of this codec that is easy to write plausibly and wrongly.
test('the RFC 6455 masked "Hello" frame decodes to Hello', () => {
  const frame = Buffer.from([0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d, 0x7f, 0x9f, 0x4d, 0x51, 0x58]);
  const decoded = decodeFrame(frame);
  assert.equal(decoded.opcode, OPCODE.text);
  assert.equal(decoded.payload.toString('utf8'), 'Hello');
  assert.equal(decoded.consumed, frame.length, 'the whole frame should be consumed');
});

test('our masked-frame helper reproduces the RFC bytes exactly', () => {
  // Otherwise every test below that uses the helper is only checking us against ourselves.
  const built = encodeMaskedFrame(OPCODE.text, 'Hello', Buffer.from([0x37, 0xfa, 0x21, 0x3d]));
  assert.deepEqual(
    [...built],
    [0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d, 0x7f, 0x9f, 0x4d, 0x51, 0x58],
  );
});

test('an unmasked server frame has the shape the RFC specifies', () => {
  // RFC 6455 section 5.7: a single-frame unmasked "Hello" is 0x81 0x05 then the ASCII.
  assert.deepEqual([...encodeText('Hello')], [0x81, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f]);
  assert.equal(encodeText('Hello')[1] & 0x80, 0, 'server frames must not set the mask bit');
});

test('all three payload length forms round-trip', () => {
  for (const length of [0, 1, 125, 126, 127, 65_535, 65_536, MAX_PAYLOAD_BYTES]) {
    const payload = Buffer.alloc(length, 0x61);
    const decoded = decodeFrame(encodeMaskedFrame(OPCODE.text, payload));
    assert.ok(decoded && !decoded.error, `length ${length} failed: ${decoded?.error}`);
    assert.equal(decoded.payload.length, length, `length ${length} payload size`);
    assert.ok(decoded.payload.equals(payload), `length ${length} payload contents`);
  }
});

test('the length indicator uses the smallest legal form', () => {
  // A server that always used the 8-byte form would work, but this pins the boundaries where the
  // form changes, which is where off-by-one bugs live.
  assert.equal(encodeFrame(OPCODE.text, Buffer.alloc(125))[1], 125);
  assert.equal(encodeFrame(OPCODE.text, Buffer.alloc(126))[1], 126);
  assert.equal(encodeFrame(OPCODE.text, Buffer.alloc(65_535))[1], 126);
  assert.equal(encodeFrame(OPCODE.text, Buffer.alloc(65_536))[1], 127);
  assert.equal(encodeFrame(OPCODE.text, Buffer.alloc(126)).length, 4 + 126);
  assert.equal(encodeFrame(OPCODE.text, Buffer.alloc(65_536)).length, 10 + 65_536);
});

// A TCP read is not a frame boundary. Returning null for "need more bytes" rather than an error is
// what keeps this working under load, and it is invisible to any test that always hands over a
// complete frame in one buffer.
test('a partial frame asks for more bytes instead of failing', () => {
  const frame = encodeMaskedFrame(OPCODE.text, 'a reasonably long test payload');
  for (let cut = 0; cut < frame.length; cut += 1) {
    assert.equal(decodeFrame(frame.subarray(0, cut)), null, `${cut} bytes should be incomplete`);
  }
  assert.ok(decodeFrame(frame), 'the complete frame should decode');
});

test('two frames in one read are consumed one at a time', () => {
  const stream = Buffer.concat([
    encodeMaskedFrame(OPCODE.text, 'first'),
    encodeMaskedFrame(OPCODE.text, 'second'),
  ]);
  const one = decodeFrame(stream);
  assert.equal(one.payload.toString(), 'first');
  const two = decodeFrame(stream.subarray(one.consumed));
  assert.equal(two.payload.toString(), 'second');
  assert.equal(one.consumed + two.consumed, stream.length);
});

test('control frames decode with their payloads intact', () => {
  const ping = decodeFrame(encodeMaskedFrame(OPCODE.ping, 'are you there'));
  assert.equal(ping.opcode, OPCODE.ping);
  assert.equal(ping.payload.toString(), 'are you there', 'a pong must echo the ping payload');

  const close = decodeFrame(encodeMaskedFrame(OPCODE.close, encodeClose(CLOSE.normal).subarray(2)));
  assert.equal(close.opcode, OPCODE.close);
  assert.equal(close.payload.readUInt16BE(0), CLOSE.normal);

  const pong = decodeFrame(encodeMaskedFrame(OPCODE.pong, ''));
  assert.equal(pong.opcode, OPCODE.pong);
  assert.equal(pong.payload.length, 0);
});

test('a close frame carries its code in the first two bytes, big-endian', () => {
  const frame = encodeClose(CLOSE.messageTooBig, 'too big');
  assert.equal(frame[0], 0x88, 'FIN + close opcode');
  const payload = frame.subarray(2);
  assert.equal(payload.readUInt16BE(0), 1009);
  assert.equal(payload.subarray(2).toString('utf8'), 'too big');
});

test('protocol violations name their close code', () => {
  // Unmasked client frame: RFC 6455 5.1 says a client MUST mask.
  const unmasked = encodeFrame(OPCODE.text, 'unmasked');
  assert.equal(decodeFrame(unmasked).closeCode, CLOSE.protocolError);

  // Reserved bits set with no negotiated extension means we are misreading the stream.
  const reserved = encodeMaskedFrame(OPCODE.text, 'x');
  reserved[0] |= 0x40;
  assert.equal(decodeFrame(reserved).closeCode, CLOSE.protocolError);

  // Fragmentation and binary are refused loudly rather than half-handled.
  const fragment = encodeMaskedFrame(OPCODE.text, 'part one');
  fragment[0] &= 0x7f;
  assert.equal(decodeFrame(fragment).closeCode, CLOSE.unsupportedData);
  assert.equal(decodeFrame(encodeMaskedFrame(OPCODE.continuation, 'more')).closeCode,
    CLOSE.unsupportedData);
  assert.equal(decodeFrame(encodeMaskedFrame(OPCODE.binary, 'bytes')).closeCode,
    CLOSE.unsupportedData);

  // An unknown opcode.
  assert.equal(decodeFrame(encodeMaskedFrame(0x3, 'reserved')).closeCode, CLOSE.protocolError);
});

test('control frames are never fragmented or larger than 125 bytes', () => {
  const fragmentedPing = encodeMaskedFrame(OPCODE.ping, 'x');
  fragmentedPing[0] &= 0x7f;
  assert.equal(decodeFrame(fragmentedPing).closeCode, CLOSE.protocolError);

  const oversizedPing = encodeMaskedFrame(OPCODE.ping, Buffer.alloc(126));
  const verdict = decodeFrame(oversizedPing.subarray(0, 2));
  assert.ok(verdict?.error, 'the invalid extended control-frame header is enough to reject');
  assert.equal(verdict.closeCode, CLOSE.protocolError);
});

test('a close payload cannot contain half of a two-byte status code', () => {
  const verdict = decodeFrame(encodeMaskedFrame(OPCODE.close, Buffer.from([0x03])));
  assert.equal(verdict.closeCode, CLOSE.protocolError);
});

test('an oversized frame is refused on its declared length, before its body arrives', () => {
  // The header alone must be enough to reject it -- otherwise a lying length is a memory-growth
  // invitation, since we would buffer towards a body that need never be sent.
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 0x80 | 127;
  header.writeBigUInt64BE(BigInt(MAX_PAYLOAD_BYTES + 1), 2);
  const verdict = decodeFrame(header);
  assert.ok(verdict?.error, 'a 10-byte header should be enough to reject');
  assert.equal(verdict.closeCode, CLOSE.messageTooBig);

  // And the same via the 16-bit form, where the body genuinely could arrive.
  const big = encodeMaskedFrame(OPCODE.text, Buffer.alloc(MAX_PAYLOAD_BYTES + 1));
  assert.equal(decodeFrame(big).closeCode, CLOSE.messageTooBig);
});

test('a payload that is exactly at the limit is still accepted', () => {
  // Off-by-one on a limit is how a legal message becomes an unexplained disconnect.
  const decoded = decodeFrame(encodeMaskedFrame(OPCODE.text, Buffer.alloc(MAX_PAYLOAD_BYTES)));
  assert.ok(decoded && !decoded.error, `expected acceptance, got ${decoded?.error}`);
  assert.equal(decoded.payload.length, MAX_PAYLOAD_BYTES);
});

test('unmasking is correct for every byte position in the 4-byte cycle', () => {
  // The mask repeats every 4 bytes, so a wrong modulo only shows up at some lengths.
  for (let length = 1; length <= 9; length += 1) {
    const payload = Buffer.from('abcdefghi'.slice(0, length));
    const decoded = decodeFrame(encodeMaskedFrame(OPCODE.text, payload,
      Buffer.from([0x01, 0x02, 0x03, 0x04])));
    assert.equal(decoded.payload.toString(), payload.toString(), `length ${length}`);
  }
});

test('utf8 payloads survive masking', () => {
  const text = 'héllo — ünïcode ✨';
  const decoded = decodeFrame(encodeMaskedFrame(OPCODE.text, Buffer.from(text, 'utf8')));
  assert.equal(decoded.payload.toString('utf8'), text);
});
