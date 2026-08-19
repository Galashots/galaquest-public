// RFC 6455 frame codec, kept separate from the socket plumbing so it can be tested against
// hand-built byte vectors rather than against itself.
//
// Only what a browser actually sends to a small JSON game server. Deliberately NOT implemented:
// continuation frames, extensions (permessage-deflate), and binary payloads. Each of those is a
// rejection with a documented close code rather than a silent no-op -- an unimplemented case that
// looks like success is how a protocol bug becomes a mystery.

import { createHash } from 'node:crypto';

// RFC 6455 section 1.3. Not a secret; it is a fixed constant that proves the server understood the
// handshake rather than echoing arbitrary bytes.
export const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const OPCODE = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa,
};

export const CLOSE = {
  normal: 1000,
  goingAway: 1001,
  protocolError: 1002,
  unsupportedData: 1003,
  policyViolation: 1008,
  messageTooBig: 1009,
};

// A game input is ~90 bytes and a snapshot for a handful of players a few hundred. 64 KiB is three
// orders of magnitude of headroom, so anything larger is a bug or an attack, not a message.
export const MAX_PAYLOAD_BYTES = 64 * 1024;

export function acceptKey(clientKey) {
  return createHash('sha1').update(`${clientKey}${WS_GUID}`).digest('base64');
}

export function handshakeResponse(clientKey) {
  return [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey(clientKey)}`,
    '',
    '',
  ].join('\r\n');
}

// Server-to-client frames are never masked (RFC 6455 5.1). Always FIN, since nothing here fragments.
export function encodeFrame(opcode, payload = Buffer.alloc(0)) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const length = body.length;

  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65_536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    // 64-bit length. writeBigUInt64BE rather than splitting by hand: lengths over 2^32 are
    // impossible here, but a hand-rolled high word is a silent corruption waiting to happen.
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([header, body]);
}

export function encodeText(text) {
  return encodeFrame(OPCODE.text, Buffer.from(text, 'utf8'));
}

export function encodeClose(code, reason = '') {
  const reasonBytes = Buffer.from(reason, 'utf8');
  const payload = Buffer.alloc(2 + reasonBytes.length);
  payload.writeUInt16BE(code, 0);
  reasonBytes.copy(payload, 2);
  return encodeFrame(OPCODE.close, payload);
}

/**
 * Pull one frame off the front of `buffer`.
 *
 * Returns null when more bytes are needed — a TCP read is not a frame boundary, and treating a short
 * read as a malformed frame is the classic way to break under load while passing every local test.
 * Returns { error, closeCode } for a protocol violation the caller must close on.
 */
export function decodeFrame(buffer) {
  if (buffer.length < 2) return null;

  const first = buffer[0];
  const second = buffer[1];
  const fin = (first & 0x80) !== 0;
  const reserved = first & 0x70;
  const opcode = first & 0x0f;
  const masked = (second & 0x80) !== 0;
  const lengthIndicator = second & 0x7f;

  if (reserved !== 0) {
    // No extensions were negotiated, so a reserved bit means we are misreading the stream.
    return { error: 'reserved bits set without a negotiated extension', closeCode: CLOSE.protocolError };
  }
  if (!masked) {
    // RFC 6455 5.1: a client MUST mask. An unmasked client frame means either a broken client or a
    // proxy rewriting traffic, and both are safer to refuse than to guess at.
    return { error: 'client frame was not masked', closeCode: CLOSE.protocolError };
  }

  const controlFrame = opcode >= 0x8;
  if (controlFrame && !fin) {
    return { error: 'control frames must not be fragmented', closeCode: CLOSE.protocolError };
  }
  if (controlFrame && lengthIndicator >= 126) {
    // RFC 6455 5.5: every control frame is at most 125 bytes. Reject from the two-byte header
    // instead of buffering an impossible extended body (especially important for ping, which the
    // server would otherwise mirror back as a large pong).
    return { error: 'control frame payload exceeds 125 bytes', closeCode: CLOSE.protocolError };
  }

  let offset = 2;
  let payloadLength = lengthIndicator;
  if (lengthIndicator === 126) {
    if (buffer.length < offset + 2) return null;
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (lengthIndicator === 127) {
    if (buffer.length < offset + 8) return null;
    const big = buffer.readBigUInt64BE(offset);
    if (big > BigInt(MAX_PAYLOAD_BYTES)) {
      return { error: `payload of ${big} bytes exceeds the limit`, closeCode: CLOSE.messageTooBig };
    }
    payloadLength = Number(big);
    offset += 8;
  }

  if (payloadLength > MAX_PAYLOAD_BYTES) {
    return {
      error: `payload of ${payloadLength} bytes exceeds the limit`,
      closeCode: CLOSE.messageTooBig,
    };
  }

  // Length is validated before waiting for the body, so an absurd declared length is refused
  // immediately instead of buffering towards it.
  if (buffer.length < offset + 4 + payloadLength) return null;

  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;
  const masked_payload = buffer.subarray(offset, offset + payloadLength);
  const payload = Buffer.alloc(payloadLength);
  for (let i = 0; i < payloadLength; i += 1) payload[i] = masked_payload[i] ^ mask[i % 4];
  offset += payloadLength;

  // Fragmentation is refused rather than assembled. No browser fragments a sub-64KB JSON send, so
  // supporting it would be untested code on a path that never runs -- and if it ever does run, a
  // loud close is far better than a half-message reaching the simulation.
  if (!fin || opcode === OPCODE.continuation) {
    return {
      error: 'fragmented frames are not supported',
      closeCode: CLOSE.unsupportedData,
      consumed: offset,
    };
  }
  if (opcode === OPCODE.binary) {
    return { error: 'binary frames are not supported', closeCode: CLOSE.unsupportedData, consumed: offset };
  }
  if (opcode !== OPCODE.text && opcode !== OPCODE.close && opcode !== OPCODE.ping
    && opcode !== OPCODE.pong) {
    return { error: `unknown opcode 0x${opcode.toString(16)}`, closeCode: CLOSE.protocolError };
  }
  if (opcode === OPCODE.close && payloadLength === 1) {
    // A close payload is either empty or starts with a complete two-byte status code.
    return { error: 'close frame has a truncated status code', closeCode: CLOSE.protocolError, consumed: offset };
  }

  return { opcode, payload, consumed: offset };
}

// Test helper, exported because the codec tests need to build client frames and only a client masks.
// Kept beside the decoder it exercises so the two cannot drift apart.
export function encodeMaskedFrame(opcode, payload, mask = Buffer.from([0x37, 0xfa, 0x21, 0x3d])) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  const length = body.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | length;
  } else if (length < 65_536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  const scrambled = Buffer.alloc(length);
  for (let i = 0; i < length; i += 1) scrambled[i] = body[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, scrambled]);
}
