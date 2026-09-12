/** Connected Editor gameplay with an isolated backend and a process-local Editor ownership token. */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startOwnedServer } from '../runtime-test/owned-server.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROJECT = resolve(REPO_ROOT, 'unity/GalaQuest');
const argOf = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const cycles = Number(argOf('cycles', '0'));
const holdSeconds = Number(argOf('hold', '20'));
if (!Number.isInteger(cycles) || cycles < 0 || !Number.isFinite(holdSeconds) || holdSeconds <= 0)
  throw new Error('--cycles must be a non-negative integer; --hold must be positive seconds');
const owner = randomUUID();
const controlDirectory = mkdtempSync(join(tmpdir(), 'galaquest-editor-control-'));
const controlFile = join(controlDirectory, 'EditorPlayControl.cs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function unity(args, timeoutSeconds = 120) {
  const result = spawnSync('unity', args, { encoding: 'utf8', shell: true, timeout: (timeoutSeconds + 10) * 1000 });
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { /* bounded diagnostic below */ }
  if (result.status !== 0 || !parsed?.success || parsed?.data?.success === false || parsed?.data?.result?.success === false)
    throw new Error(`Unity command failed: ${JSON.stringify(parsed?.data?.result?.error ?? parsed?.errors ?? result.error ?? result.stderr).slice(0, 600)}`);
  return parsed;
}
function control(body, timeoutSeconds = 120) {
  writeFileSync(controlFile, `using UnityEditor; using GalaQuest; public static class EditorPlayControl { public static object Main() { ${body} } }`);
  return unity(['command', 'run_script', '--project-path', `"${PROJECT}"`, '--file', `"${controlFile}"`, '--timeout', String(timeoutSeconds), '--timeout_ms', String(timeoutSeconds * 1000), '--format', 'json'], timeoutSeconds).data.result.result;
}
let server;
let seamEnabled = false;
let stopping;
let stopRequested = false;
let blockedHold;
async function teardown(reason) {
  stopRequested = true;
  if (stopping) return stopping;
  stopping = (async () => {
    console.log(`Tearing down (${reason})`);
    try {
      if (seamEnabled) {
        const requested = control(`if (!GalaQuestEditorPlaySeam.Owns("${owner}")) return false; EditorApplication.isPlaying = false; return true;`, 15);
        if (!requested) throw new Error('Owner token no longer matches; no Editor state was changed');
        const deadline = Date.now() + 60_000;
        let verified = false;
        let lastError = '';
        while (Date.now() < deadline) {
          try {
            verified = control(`if (!GalaQuestEditorPlaySeam.Owns("${owner}")) throw new System.InvalidOperationException("Owner changed"); return !EditorApplication.isPlayingOrWillChangePlaymode && !EditorApplication.isCompiling && UnityEngine.Object.FindObjectsByType<EditorWebSocketTransport>(UnityEngine.FindObjectsInactive.Include, UnityEngine.FindObjectsSortMode.None).Length == 0;`, 10) === true;
            if (verified) break;
          } catch (error) { lastError = error.message; }
          await sleep(1000);
        }
        if (!verified) throw new Error(`Play Mode stop/runtime destruction not verified within the bounded wait: ${lastError}`);
        if (control(`return GalaQuestEditorPlaySeam.Release("${owner}");`, 15) !== true)
          throw new Error('Owned seam release was not acknowledged');
        seamEnabled = false;
        console.log('Play Mode stopped and runtime transport destruction verified; owned override released');
      }
      if (server && !await server.kill()) throw new Error('Owned backend exit/port release not verified');
      if (server) console.log('Owned backend exit and port release verified');
      rmSync(controlFile, { force: true });
      rmdirSync(controlDirectory);
      clearInterval(blockedHold);
      return true;
    } catch (error) {
      console.error(`Cleanup NOT VERIFIED: ${error.message}. Preserving remaining owned resources; resolve the stop and retry Ctrl+C. Owner token: ${owner}`);
      process.exitCode = 1;
      blockedHold ??= setInterval(() => {}, 60_000);
      return false;
    }
  })();
  const completed = await stopping;
  if (!completed) stopping = null;
  return completed;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (await teardown(signal)) process.exit(process.exitCode || (signal === 'SIGINT' ? 130 : 143));
});
try {
  const available = control('return !EditorApplication.isPlayingOrWillChangePlaymode && !GalaQuestEditorPlaySeam.Enabled;');
  if (!available) throw new Error('Selected Editor is already playing or has a development owner');
  server = await startOwnedServer({ quiet: true });
  const store = server.rewardStore;
  const relativeToTemp = relative(resolve(tmpdir()), resolve(store.rewardStorePath));
  const relativeToRepo = relative(REPO_ROOT, resolve(store.rewardStorePath));
  if (store.kind !== 'temporary' || isAbsolute(relativeToTemp) || relativeToTemp.startsWith('..')
      || (!isAbsolute(relativeToRepo) && !relativeToRepo.startsWith('..')))
    throw new Error('Refusing a reward store outside the disposable OS-temp boundary');
  const endpoint = `ws://127.0.0.1:${server.port}/ws`;
  console.log(`Owned backend pid ${server.child.pid}; endpoint ${endpoint}; temporary store ${store.rewardStorePath}`);
  seamEnabled = control(`return GalaQuestEditorPlaySeam.Acquire("${owner}", "${endpoint}");`) === true;
  if (!seamEnabled) throw new Error('Editor ownership acquisition was not acknowledged');
  console.log(`Editor owner ${owner}; project ${PROJECT}; synthetic profile only`);
  if (cycles > 0) {
    for (let cycle = 1; cycle <= cycles; cycle++) {
      if (stopRequested) break;
      control(`if (!GalaQuestEditorPlaySeam.Owns("${owner}")) throw new System.InvalidOperationException("Owner lost"); EditorApplication.isPlaying = true; return true;`);
      await sleep(holdSeconds * 1000);
      if (stopRequested) break;
      control(`if (!GalaQuestEditorPlaySeam.Owns("${owner}")) throw new System.InvalidOperationException("Owner lost"); EditorApplication.isPlaying = false; return true;`);
      await sleep(4000);
      console.log(`Play cycle ${cycle} requested; gameplay/lifecycle acceptance requires separate evidence`);
    }
    await teardown('cycles complete');
  } else {
    console.log('Ready for interactive Play Mode. Ctrl+C releases only this owned Editor/server session.');
    for (;;) await sleep(60_000);
  }
} catch (error) {
  console.error(`FAILED: ${error.message}`);
  process.exitCode = 1;
  await teardown('failure');
}
