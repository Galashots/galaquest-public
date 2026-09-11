/**
 * Run connected GalaQuest gameplay inside the local Unity Editor.
 *
 *   node tools/unity/editor-play.mjs                 # start server, enable the seam, hold until Ctrl+C
 *   node tools/unity/editor-play.mjs --cycles 2      # enter and exit Play Mode twice, then tear down
 *   node tools/unity/editor-play.mjs --hold 30       # seconds to stay in Play Mode per cycle
 *
 * WHAT IT OWNS. One isolated Node server on a harness port with a throwaway reward store, and the
 * Editor-only development seam. It starts them, proves what it selected BEFORE anything connects,
 * and puts both back afterwards. It stops only the server it spawned and disables only the seam it
 * enabled; it never touches the Editor's project, scenes, or another session's server.
 *
 * WHY THE PROOF COMES FIRST. An inherited GALAQUEST_REWARD_STORE_PATH, or a stale server already
 * holding the port, would silently point connected play at the family's real saves. The selected
 * store and port are printed and asserted before the Editor is told where to connect, so a run that
 * would have reached real data fails here instead of succeeding quietly.
 *
 * It deliberately owns no gameplay. The server is the existing one, the client is the existing one,
 * and this script only decides which server the Editor talks to.
 */

import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startOwnedServer } from '../runtime-test/owned-server.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROJECT = resolve(REPO_ROOT, 'unity/GalaQuest');

const argOf = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const cycles = Number(argOf('cycles', '0'));
const holdSeconds = Number(argOf('hold', '20'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function unity(args, { allowFailure = false } = {}) {
  const result = spawnSync('unity', args, { encoding: 'utf8', shell: true });
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* reported below */ }
  if (!allowFailure && !parsed?.success) {
    throw new Error(`unity ${args.join(' ')} failed: ${parsed?.errors?.[0]?.message ?? text.slice(0, 300)}`);
  }
  return parsed;
}

const editorCommand = (tool, extra = []) =>
  unity(['command', tool, '--project-path', `"${PROJECT}"`, ...extra, '--timeout', '120', '--format', 'json']);

// EditorPrefs is the seam's own switch; setting it through eval keeps one source of truth.
const setPref = (expression) =>
  unity(['command', 'eval', '--project-path', `"${PROJECT}"`, `"${expression}"`, '--timeout', '120', '--format', 'json']);

let server = null;
let seamEnabled = false;

async function teardown(reason) {
  console.log(`\nTearing down (${reason})`);
  try { editorCommand('editor_stop'); } catch { /* already stopped */ }
  if (seamEnabled) {
    try {
      setPref('UnityEditor.EditorPrefs.SetBool(\\"GalaQuest.EditorPlaySeam.Enabled\\", false); return \\"off\\";');
      console.log('  development seam disabled');
    } catch (error) { console.log(`  WARNING: could not disable the seam: ${error.message}`); }
  }
  if (server && !server.exited) {
    server.kill();
    console.log(`  owned server pid ${server.child.pid} stopped`);
  }
}

process.on('SIGINT', async () => { await teardown('interrupted'); process.exit(130); });

try {
  server = await startOwnedServer({ quiet: true });

  // Prove isolation before the Editor is pointed anywhere.
  const store = server.rewardStore;
  if (store.kind !== 'temporary') {
    throw new Error(`refusing to run: reward store is '${store.kind}', not an isolated temporary store`);
  }
  const storePath = store.rewardStorePath;
  if (!storePath.startsWith(tmpdir())) {
    throw new Error(`refusing to run: reward store ${storePath} is outside the OS temp directory`);
  }
  const fromRepo = relative(REPO_ROOT, storePath);
  if (!fromRepo.startsWith('..')) {
    throw new Error(`refusing to run: reward store ${storePath} is inside the checkout`);
  }

  const endpoint = `ws://127.0.0.1:${server.port}/ws`;
  console.log('Owned local runtime');
  console.log(`  server pid    ${server.child.pid}`);
  console.log(`  port          ${server.port}`);
  console.log(`  endpoint      ${endpoint}`);
  console.log(`  reward store  ${storePath}  (${store.kind}, outside the checkout)`);
  console.log(`  real saves    untouched: data/rewards.db is never opened by this run`);

  setPref(`UnityEditor.EditorPrefs.SetString(\\"GalaQuest.EditorPlaySeam.ServerUrl\\", \\"${endpoint}\\"); return \\"set\\";`);
  setPref('UnityEditor.EditorPrefs.SetBool(\\"GalaQuest.EditorPlaySeam.Enabled\\", true); return \\"on\\";');
  seamEnabled = true;
  console.log('  development seam enabled with a synthetic profile');

  if (cycles > 0) {
    for (let cycle = 1; cycle <= cycles; cycle += 1) {
      console.log(`\nPlay Mode cycle ${cycle} of ${cycles}`);
      editorCommand('editor_play');
      await sleep(holdSeconds * 1000);
      editorCommand('editor_stop');
      await sleep(4000);
      console.log(`  cycle ${cycle} complete`);
    }
    await teardown('cycles complete');
  } else {
    console.log('\nEditor is ready to enter Play Mode. Press Ctrl+C here to stop and clean up.');
    // Hold the server open for interactive play.
    for (;;) await sleep(60_000);
  }
} catch (error) {
  console.error(`\nFAILED: ${error.message}`);
  await teardown('failure');
  process.exitCode = 1;
}
