// Minimal WebSocket server, attached to an existing node http server.
//
// Hand-rolled because this project cannot install packages: npm registry lookups take ~6 minutes on
// the development machine and have burned whole sessions. `ws` would be the obvious choice
// otherwise, and if the constraint ever lifts, this file is the thing to delete.
//
// The frame codec lives in wsFrame.mjs and is tested against RFC 6455's own worked examples. This
// file is only sockets: handshake, buffering, dispatch, teardown.

import {
  CLOSE,
  OPCODE,
  decodeFrame,
  encodeClose,
  encodeFrame,
  encodeText,
  handshakeResponse,
} from './wsFrame.mjs';

export const WS_VERSION = 13;
export const DEFAULT_MAX_CLIENTS = 32;
export const DEFAULT_MAX_CLIENTS_PER_IP = 8;
export const DEFAULT_MAX_BUFFERED_BYTES = 1024 * 1024;
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

function positiveInteger(value, name, { allowZero = false } = {}) {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(`${name} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`);
  }
  return value;
}

function sameOriginOrNonBrowser(request, allowMissingOrigin) {
  const origin = request.headers.origin;
  if (origin === undefined) return allowMissingOrigin;
  const host = request.headers.host;
  if (!host) return false;
  try {
    const parsed = new URL(String(origin));
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.host.toLowerCase() === String(host).toLowerCase();
  } catch {
    return false;
  }
}

function validClientKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(value)) return false;
  try { return Buffer.from(value, 'base64').byteLength === 16; } catch { return false; }
}

function clientIp(request) {
  const address = request.socket.remoteAddress ?? 'unknown';
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

function refuse(socket, status, message) {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n`
    + `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
  socket.destroy();
}

/**
 * @param httpServer  a node http.Server whose 'upgrade' event we take over
 * @param handlers    { onConnect(client), onMessage(client, text), onClose(client) }
 * @param options     {
 *   path = '/ws', maxClients, maxClientsPerIp, maxBufferedBytes,
 *   heartbeatIntervalMs, allowMissingOrigin, isOriginAllowed(request)
 * }
 */
export function attachWebSocketServer(httpServer, handlers = {}, options = {}) {
  const path = options.path ?? '/ws';
  const maxClients = positiveInteger(options.maxClients ?? DEFAULT_MAX_CLIENTS, 'maxClients');
  const maxClientsPerIp = positiveInteger(
    options.maxClientsPerIp ?? DEFAULT_MAX_CLIENTS_PER_IP,
    'maxClientsPerIp',
  );
  const maxBufferedBytes = positiveInteger(
    options.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES,
    'maxBufferedBytes',
  );
  const heartbeatIntervalMs = positiveInteger(
    options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
    'heartbeatIntervalMs',
    { allowZero: true },
  );
  const allowMissingOrigin = options.allowMissingOrigin ?? true;
  const isOriginAllowed = options.isOriginAllowed
    ?? ((request) => sameOriginOrNonBrowser(request, allowMissingOrigin));
  const clients = new Set();
  let nextClientId = 0;

  function onUpgrade(request, socket) {
    // Only our own path. Anything else is left to 404 rather than silently upgraded, so a typo in a
    // client URL fails loudly instead of connecting to a server that will never speak to it.
    const requestPath = (request.url ?? '/').split('?')[0];
    if (requestPath !== path) {
      refuse(socket, '404 Not Found', 'no websocket endpoint here');
      return;
    }
    if (request.method !== 'GET') {
      refuse(socket, '405 Method Not Allowed', 'websocket upgrades require GET');
      return;
    }
    const key = request.headers['sec-websocket-key'];
    const version = Number(request.headers['sec-websocket-version']);
    const upgradeHeader = String(request.headers.upgrade ?? '').toLowerCase();
    const connectionTokens = String(request.headers.connection ?? '')
      .split(',').map((token) => token.trim().toLowerCase());
    if (upgradeHeader !== 'websocket' || !connectionTokens.includes('upgrade') || !validClientKey(key)) {
      refuse(socket, '400 Bad Request', 'not a valid websocket upgrade');
      return;
    }
    if (version !== WS_VERSION) {
      // Advertise what we do speak; RFC 6455 4.4.
      socket.write(`HTTP/1.1 426 Upgrade Required\r\nSec-WebSocket-Version: ${WS_VERSION}\r\n\r\n`);
      socket.destroy();
      return;
    }
    let originAllowed = false;
    try { originAllowed = Boolean(isOriginAllowed(request)); } catch { originAllowed = false; }
    if (!originAllowed) {
      refuse(socket, '403 Forbidden', 'websocket origin is not allowed');
      return;
    }

    const remoteAddress = clientIp(request);
    if (clients.size >= maxClients) {
      refuse(socket, '503 Service Unavailable', 'websocket client limit reached');
      return;
    }
    let clientsFromIp = 0;
    for (const client of clients) if (client.remoteAddress === remoteAddress) clientsFromIp += 1;
    if (clientsFromIp >= maxClientsPerIp) {
      refuse(socket, '429 Too Many Requests', 'websocket per-address client limit reached');
      return;
    }

    // Nagle's algorithm batches small writes, which is exactly wrong for a game: it would add up to
    // ~40ms of latency to every input and snapshot, indistinguishable from a bad connection.
    socket.setNoDelay(true);
    socket.write(handshakeResponse(key));

    let buffer = Buffer.alloc(0);
    let closed = false;

    const client = {
      id: `c${nextClientId += 1}`,
      socket,
      remoteAddress,
      heartbeatAlive: true,
      // Whatever the game layer wants to hang here (player id, last input, name).
      data: {},
      send(text) {
        return writeFrame(encodeText(text));
      },
      close(code = CLOSE.normal, reason = '') {
        if (closed) return;
        closed = true;
        // Write the close frame, then end the socket -- the browser wants the frame, not a hangup.
        try {
          socket.end(encodeClose(code, reason));
        } catch {
          socket.destroy();
        }
      },
      terminate(code = CLOSE.goingAway, reason = '') {
        if (!closed) {
          closed = true;
          try { socket.end(encodeClose(code, reason)); } catch { socket.destroy(); }
        }
        teardown();
        const force = setTimeout(() => socket.destroy(), 1000);
        force.unref?.();
      },
      get closed() {
        return closed;
      },
    };

    function writeFrame(frame) {
      if (closed || socket.destroyed || !socket.writable) return false;
      if (socket.writableLength + frame.byteLength > maxBufferedBytes) {
        client.terminate(CLOSE.messageTooBig, 'outbound buffer limit');
        return false;
      }
      return socket.write(frame);
    }
    clients.add(client);

    function teardown() {
      if (!clients.delete(client)) return; // already torn down
      closed = true;
      try {
        handlers.onClose?.(client);
      } catch (error) {
        console.error('[ws] onClose handler threw', error);
      }
    }

    function failConnection(code, reason) {
      client.terminate(code, reason);
    }

    socket.on('data', (chunk) => {
      if (closed) return;
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);

      // Drain every complete frame in the buffer. A single TCP read can carry several frames, or
      // half of one; decodeFrame returns null for "need more bytes".
      for (;;) {
        const frame = decodeFrame(buffer);
        if (frame === null) return;
        if (frame.error) {
          console.error(`[ws] ${client.id}: ${frame.error}`);
          failConnection(frame.closeCode, frame.error);
          return;
        }
        buffer = buffer.subarray(frame.consumed);

        if (frame.opcode === OPCODE.text) {
          try {
            handlers.onMessage?.(client, frame.payload.toString('utf8'));
          } catch (error) {
            // A throwing handler is the game layer rejecting the message (e.g. ProtocolError). Drop
            // this client rather than let a bad message loop, and never take the server down with it.
            console.error(`[ws] ${client.id} message rejected:`, error.message);
            failConnection(CLOSE.policyViolation, 'invalid message');
            return;
          }
        } else if (frame.opcode === OPCODE.close) {
          // Echo the code back, per RFC 6455 5.5.1, then let the socket close.
          const code = frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : CLOSE.normal;
          client.close(code);
          teardown();
          return;
        } else if (frame.opcode === OPCODE.ping) {
          writeFrame(encodeFrame(OPCODE.pong, frame.payload));
        } else if (frame.opcode === OPCODE.pong) {
          client.heartbeatAlive = true;
        }
      }
    });

    // Without an error listener a client vanishing mid-write throws ECONNRESET at the process, which
    // would take the whole game server down with one flaky iPad.
    socket.on('error', (error) => {
      if (error.code !== 'ECONNRESET') console.error(`[ws] ${client.id} socket error`, error.message);
      teardown();
    });
    socket.on('close', teardown);
    socket.on('end', teardown);

    try {
      handlers.onConnect?.(client);
    } catch (error) {
      console.error('[ws] onConnect handler threw', error);
      failConnection(CLOSE.policyViolation, 'connect rejected');
    }
  }

  const heartbeatTimer = heartbeatIntervalMs === 0 ? null : setInterval(() => {
    for (const client of [...clients]) {
      if (client.closed || client.socket.destroyed) continue;
      if (!client.heartbeatAlive) {
        client.terminate(CLOSE.goingAway, 'heartbeat timeout');
        continue;
      }
      client.heartbeatAlive = false;
      const payload = Buffer.from(String(Date.now()));
      const frame = encodeFrame(OPCODE.ping, payload);
      // A slow client's queued snapshots must not grow without bound merely because heartbeat
      // traffic keeps being appended. The same outbound budget governs every frame.
      if (client.socket.writableLength + frame.byteLength > maxBufferedBytes) {
        client.terminate(CLOSE.messageTooBig, 'outbound buffer limit');
      } else {
        client.socket.write(frame);
      }
    }
  }, heartbeatIntervalMs);
  heartbeatTimer?.unref?.();

  httpServer.on('upgrade', onUpgrade);

  return {
    clients,
    broadcast(text) {
      const frame = encodeText(text);
      const recipients = clients.size;
      for (const client of [...clients]) {
        if (!client.closed && !client.socket.destroyed) {
          if (client.socket.writableLength + frame.byteLength > maxBufferedBytes) {
            client.terminate(CLOSE.messageTooBig, 'outbound buffer limit');
          } else {
            client.socket.write(frame);
          }
        }
      }
      return recipients;
    },
    closeAll(code = CLOSE.goingAway, reason = 'server shutting down') {
      for (const client of [...clients]) client.close(code, reason);
    },
    detach() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      httpServer.off('upgrade', onUpgrade);
    },
  };
}
