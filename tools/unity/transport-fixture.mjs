import { createServer } from 'node:http';
import { attachWebSocketServer } from '../../net/wsServer.mjs';
import { encodeFrame, OPCODE } from '../../net/wsFrame.mjs';
const server = createServer();
const sockets = attachWebSocketServer(server, { onMessage(client, text) {
 if (text === 'connections') { server.getConnections((error, count) => client.send(`connections:${error ? 'error' : count}`)); return; }
 if (text === 'takeover') { client.close(4001, 'same-profile takeover'); return; }
 if (text === 'unicode') {
  const bytes = Buffer.from('a\u{1f525}b');
  const first = encodeFrame(OPCODE.text, bytes.subarray(0, 3));
  first[0] &= 0x7f; // deliberately split a UTF-8 scalar across WebSocket fragments
  client.socket.write(first);
  client.socket.write(encodeFrame(OPCODE.continuation, bytes.subarray(3)));
  return;
 }
 client.send(text);
}}, { allowMissingOrigin: false, heartbeatIntervalMs: 0 });
server.listen(0, '127.0.0.1', () => console.log(server.address().port));
process.stdin.resume();
process.stdin.on('end', () => { sockets.closeAll(); sockets.detach(); server.close(); });
setTimeout(() => process.exit(2), 60000).unref();
