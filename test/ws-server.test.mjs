import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import test from 'node:test';

import { attachWebSocketServer } from '../net/wsServer.mjs';

// These drive the server through node's built-in WebSocket client over a real TCP socket. That
// matters: the client is an independent implementation of RFC 6455, so it masks its own frames,
// builds its own handshake and enforces its own rules. A test that used our own encoder for both
// sides would agree with itself no matter how wrong it was.

async function withServer(handlers, body, options) {
  const httpServer = createServer((_request, response) => {
    response.writeHead(200).end('http still works');
  });
  const ws = attachWebSocketServer(httpServer, handlers, options);
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();
  try {
    return await body({ port, ws, url: `ws://127.0.0.1:${port}/ws` });
  } finally {
    ws.closeAll();
    ws.detach();
    await new Promise((resolve) => httpServer.close(resolve));
  }
}

const opened = (socket) => new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', () => reject(new Error('socket errored before opening')), { once: true });
});

const nextMessage = (socket) => new Promise((resolve, reject) => {
  socket.addEventListener('message', (event) => resolve(event.data), { once: true });
  setTimeout(() => reject(new Error('timed out waiting for a message')), 3000);
});

const closedWith = (socket) => new Promise((resolve) => {
  socket.addEventListener('close', (event) => resolve({ code: event.code, reason: event.reason }),
    { once: true });
});

async function rawUpgrade(port, {
  origin,
  version = 13,
  path = '/ws',
  key = 'dGhlIHNhbXBsZSBub25jZQ==',
  method = 'GET',
} = {}) {
  const { connect } = await import('node:net');
  const socket = connect(port, '127.0.0.1');
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const headers = [
    `${method} ${path} HTTP/1.1`,
    `Host: 127.0.0.1:${port}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    `Sec-WebSocket-Version: ${version}`,
    ...(origin === undefined ? [] : [`Origin: ${origin}`]),
    '',
    '',
  ].join('\r\n');
  socket.write(headers);

  const response = await new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const timeout = setTimeout(() => reject(new Error('timed out waiting for upgrade response')), 3000);
    function onData(chunk) {
      buffered = Buffer.concat([buffered, chunk]);
      const end = buffered.indexOf('\r\n\r\n');
      if (end < 0) return;
      clearTimeout(timeout);
      socket.off('data', onData);
      resolve({
        head: buffered.subarray(0, end + 4).toString('utf8'),
        remainder: buffered.subarray(end + 4),
      });
    }
    socket.on('data', onData);
    socket.once('error', reject);
  });
  return { socket, ...response };
}

test('a browser-grade client completes the handshake and exchanges text', async () => {
  await withServer(
    { onMessage: (client, text) => client.send(`echo:${text}`) },
    async ({ url }) => {
      const socket = new WebSocket(url);
      await opened(socket);
      socket.send('hello from the client');
      assert.equal(await nextMessage(socket), 'echo:hello from the client');
      socket.close();
      await closedWith(socket);
    },
  );
});

test('payloads spanning all three length forms survive a real socket', async () => {
  await withServer(
    { onMessage: (client, text) => client.send(String(text.length)) },
    async ({ url }) => {
      const socket = new WebSocket(url);
      await opened(socket);
      // 125/126 and 65535/65536 are the boundaries where the length encoding changes form. 65536 is
      // both the largest legal payload and the only one that uses the 64-bit form, and at this size
      // it is certain to be split across TCP reads -- the case a single-buffer unit test cannot reach.
      for (const length of [1, 125, 126, 65_535, 65_536]) {
        socket.send('x'.repeat(length));
        assert.equal(await nextMessage(socket), String(length), `length ${length}`);
      }
      socket.close();
      await closedWith(socket);
    },
  );
});

test('a payload over the limit closes the connection with 1009', async () => {
  // Found by this test failing when it tried 70,000 bytes expecting success: the server was right and
  // the expectation was wrong. Kept as its own case, because "the limit is enforced end-to-end over a
  // real socket" is worth more than the codec unit test alone -- the frame arrives across several TCP
  // reads, so the rejection has to survive reassembly.
  const { MAX_PAYLOAD_BYTES } = await import('../net/wsFrame.mjs');
  await withServer(
    { onMessage: (client, text) => client.send(String(text.length)) },
    async ({ url }) => {
      const socket = new WebSocket(url);
      await opened(socket);
      socket.send('x'.repeat(MAX_PAYLOAD_BYTES + 1));
      const closure = await closedWith(socket);
      assert.equal(closure.code, 1009, `expected messageTooBig, got ${closure.code}`);
    },
  );
});

test('a burst of small messages arrives complete and in order', async () => {
  // A burst is what coalesces into one TCP read, so this is the multiple-frames-per-read path that
  // a game's 15 Hz input stream will hit constantly.
  await withServer(
    { onMessage: (client, text) => client.send(text) },
    async ({ url }) => {
      const socket = new WebSocket(url);
      await opened(socket);
      const received = [];
      socket.addEventListener('message', (event) => received.push(event.data));
      const sent = Array.from({ length: 50 }, (_, i) => `message-${i}`);
      for (const message of sent) socket.send(message);
      const deadline = Date.now() + 3000;
      while (received.length < sent.length && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.deepEqual(received, sent, 'all 50 messages, in order');
      socket.close();
      await closedWith(socket);
    },
  );
});

test('the server answers a ping with a pong carrying the same payload', async () => {
  // The browser never exposes ping/pong to page JS, but intermediaries send them and an unanswered
  // ping is a dropped connection. Built by hand because no client API can send one.
  const { encodeMaskedFrame, decodeFrame, OPCODE } = await import('../net/wsFrame.mjs');
  const { connect } = await import('node:net');
  const { acceptKey } = await import('../net/wsFrame.mjs');

  await withServer({}, async ({ port }) => {
    const socket = connect(port, '127.0.0.1');
    await new Promise((resolve) => socket.once('connect', resolve));
    const key = 'dGhlIHNhbXBsZSBub25jZQ==';
    socket.write('GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n'
      + `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    const handshake = await new Promise((resolve) => socket.once('data', resolve));
    assert.ok(handshake.toString().startsWith('HTTP/1.1 101'), 'expected a 101');
    assert.ok(handshake.toString().includes(`Sec-WebSocket-Accept: ${acceptKey(key)}`));

    socket.write(encodeMaskedFrame(OPCODE.ping, 'ping-payload'));
    const reply = await new Promise((resolve) => socket.once('data', resolve));
    // The server does not mask, so decodeFrame would reject its own output; read the header directly.
    assert.equal(reply[0], 0x80 | OPCODE.pong, 'expected a FIN pong frame');
    assert.equal(reply.subarray(2, 2 + reply[1]).toString('utf8'), 'ping-payload');
    socket.destroy();
  });
});

test('an unmasked client frame is refused with close 1002', async () => {
  const { encodeFrame, OPCODE, CLOSE } = await import('../net/wsFrame.mjs');
  const { connect } = await import('node:net');

  await withServer({}, async ({ port }) => {
    const socket = connect(port, '127.0.0.1');
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.write('GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n'
      + 'Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
      + 'Sec-WebSocket-Version: 13\r\n\r\n');
    await new Promise((resolve) => socket.once('data', resolve));

    socket.write(encodeFrame(OPCODE.text, 'I did not mask this'));
    const reply = await new Promise((resolve) => socket.once('data', resolve));
    assert.equal(reply[0], 0x80 | OPCODE.close, 'expected a close frame');
    assert.equal(reply.readUInt16BE(2), CLOSE.protocolError, 'expected close code 1002');
    socket.destroy();
  });
});

test('a handler that throws drops only that client, and the server survives', async () => {
  // The game layer signals "this message is illegal" by throwing (ProtocolError). One bad client
  // must not take down the other kid's session.
  await withServer(
    {
      onMessage: (client, text) => {
        if (text === 'poison') throw new Error('rejected by the game layer');
        client.send(`fine:${text}`);
      },
    },
    async ({ url, ws }) => {
      const good = new WebSocket(url);
      const bad = new WebSocket(url);
      await Promise.all([opened(good), opened(bad)]);
      assert.equal(ws.clients.size, 2);

      bad.send('poison');
      const badClose = await closedWith(bad);
      assert.equal(badClose.code, 1008, 'the offender should get a policy-violation close');

      good.send('still here');
      assert.equal(await nextMessage(good), 'fine:still here', 'the other client is unaffected');
      good.close();
      await closedWith(good);
    },
  );
});

test('a client that vanishes mid-session is reported closed exactly once', async () => {
  // Without a socket error listener an ECONNRESET throws at the process; without the once-only guard
  // the game layer would remove the same player twice and could resurrect state.
  const closes = [];
  await withServer(
    { onClose: (client) => closes.push(client.id) },
    async ({ url, ws }) => {
      const socket = new WebSocket(url);
      await opened(socket);
      assert.equal(ws.clients.size, 1);
      // Terminate rudely: no close frame, just a dead socket.
      socket.close();
      const deadline = Date.now() + 3000;
      while (ws.clients.size > 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(ws.clients.size, 0, 'client should have been removed');
      assert.equal(closes.length, 1, `onClose fired ${closes.length} times, expected exactly 1`);
    },
  );
});

test('broadcast reaches every connected client', async () => {
  await withServer({}, async ({ url, ws }) => {
    const sockets = [new WebSocket(url), new WebSocket(url), new WebSocket(url)];
    await Promise.all(sockets.map(opened));
    const waiting = sockets.map(nextMessage);
    assert.equal(ws.broadcast('to everyone'), 3);
    assert.deepEqual(await Promise.all(waiting), ['to everyone', 'to everyone', 'to everyone']);
    for (const socket of sockets) socket.close();
  });
});

test('browser origins must match the HTTP Host, while a same-origin page is accepted', async () => {
  await withServer({}, async ({ port }) => {
    const hostile = await rawUpgrade(port, { origin: 'https://attacker.example' });
    assert.ok(hostile.head.startsWith('HTTP/1.1 403'), hostile.head);
    hostile.socket.destroy();

    const sameOrigin = await rawUpgrade(port, { origin: `http://127.0.0.1:${port}` });
    assert.ok(sameOrigin.head.startsWith('HTTP/1.1 101'), sameOrigin.head);
    sameOrigin.socket.destroy();
  });
});

test('the runtime can require an Origin and reject raw origin-less upgrades', async () => {
  await withServer({}, async ({ port }) => {
    const response = await rawUpgrade(port);
    assert.ok(response.head.startsWith('HTTP/1.1 403'), response.head);
    response.socket.destroy();
  }, { allowMissingOrigin: false });
});

test('a websocket upgrade must use GET', async () => {
  await withServer({}, async ({ port }) => {
    const response = await rawUpgrade(port, { method: 'POST' });
    assert.ok(response.head.startsWith('HTTP/1.1 405'), response.head);
    response.socket.destroy();
  });
});

test('total and per-address client limits reject excess handshakes without disturbing the first client', async () => {
  await withServer({}, async ({ url, ws }) => {
    const first = new WebSocket(url);
    await opened(first);

    const second = new WebSocket(url);
    await new Promise((resolve) => {
      second.addEventListener('error', resolve, { once: true });
      second.addEventListener('close', resolve, { once: true });
    });
    assert.equal(ws.clients.size, 1);
    assert.equal(first.readyState, WebSocket.OPEN);
    first.close();
    await closedWith(first);
  }, { maxClients: 4, maxClientsPerIp: 1 });
});

test('an outbound frame that would exceed the per-client queue budget closes only that slow client', async () => {
  await withServer({}, async ({ port, ws }) => {
    const raw = await rawUpgrade(port);
    assert.ok(raw.head.startsWith('HTTP/1.1 101'));
    assert.equal(ws.clients.size, 1);
    const [client] = ws.clients;
    assert.equal(client.send('this frame is deliberately larger than the budget'), false);
    assert.equal(client.closed, true);
    assert.equal(ws.clients.size, 0);
    raw.socket.destroy();
  }, { maxBufferedBytes: 8, heartbeatIntervalMs: 0 });
});

test('heartbeat removes a peer that never answers pong', async () => {
  await withServer({}, async ({ port, ws }) => {
    const raw = await rawUpgrade(port);
    assert.ok(raw.head.startsWith('HTTP/1.1 101'));
    const deadline = Date.now() + 1000;
    while (ws.clients.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(ws.clients.size, 0, 'the unresponsive peer should be evicted after one missed pong');
    raw.socket.destroy();
  }, { heartbeatIntervalMs: 25 });
});

test('a standards-compliant client answers heartbeat pings and remains usable', async () => {
  await withServer(
    { onMessage: (client, text) => client.send(`alive:${text}`) },
    async ({ url, ws }) => {
      const socket = new WebSocket(url);
      await opened(socket);
      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.equal(ws.clients.size, 1);
      socket.send('after heartbeat');
      assert.equal(await nextMessage(socket), 'alive:after heartbeat');
      socket.close();
      await closedWith(socket);
    },
    { heartbeatIntervalMs: 25 },
  );
});

test('the wrong path and the wrong version are refused, and plain http still works', async () => {
  await withServer({}, async ({ port }) => {
    const wrongPath = new WebSocket(`ws://127.0.0.1:${port}/not-ws`);
    await new Promise((resolve) => {
      wrongPath.addEventListener('error', resolve, { once: true });
      wrongPath.addEventListener('close', resolve, { once: true });
    });

    // Upgrading is opt-in per path, so the ordinary request path must be untouched -- the real server
    // serves the game's files from the same port.
    const body = await fetch(`http://127.0.0.1:${port}/index.html`).then((r) => r.text());
    assert.equal(body, 'http still works');

    const { connect } = await import('node:net');
    const socket = connect(port, '127.0.0.1');
    await new Promise((resolve) => socket.once('connect', resolve));
    socket.write('GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n'
      + 'Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n'
      + 'Sec-WebSocket-Version: 8\r\n\r\n');
    const reply = await new Promise((resolve) => socket.once('data', resolve));
    assert.ok(reply.toString().startsWith('HTTP/1.1 426'), 'expected 426 Upgrade Required');
    assert.ok(reply.toString().includes('Sec-WebSocket-Version: 13'), 'should advertise 13');
    socket.destroy();
  });
});
