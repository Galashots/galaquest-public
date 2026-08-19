/**
 * Run a review suite and bundle everything a reviewer needs to judge the RUNNING GAME.
 *
 *   node tools/runtime-test/run-review-suite.mjs <keeper|hero|full> [--launch-chrome] [--out DIR]
 *
 * WHY THIS EXISTS (Phase RP1). `drive-village.mjs` already says its captures are meant to be opened
 * and judged by "a person (or an agent standing in for one)". The captures existed; what did not was
 * a way to get them out of one machine's gitignored `.local/` and in front of an independent
 * reviewer, together with enough context to know WHAT was reviewed. A screenshot with no SHA is an
 * anecdote.
 *
 * This orchestrates the existing hermetic harnesses. It deliberately contains no CDP code, no browser
 * automation and no game knowledge: every harness still owns its own server on its own port, still
 * clears storage before navigating (GQ-008), and still decides its own pass/fail. Adding a second
 * automation framework beside the proven one is exactly the kind of thing that rots.
 *
 * Evidence is attributed PER COMMAND by snapshotting `.local/runtime-test/` around each run, so the
 * manifest can say which harness produced which picture rather than handing over an undifferentiated
 * folder. That also means a harness that crashes before writing anything is visible as a command with
 * no artifacts, instead of silently contributing nothing.
 */

import { execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HARNESSES, SUITES } from './review-suites.mjs';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const HARNESS_DIR = join(REPO_ROOT, 'tools', 'runtime-test');
const SCRATCH = join(REPO_ROOT, '.local', 'runtime-test');
const CHROME_PORT = 9224;

// ── cli ─────────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const suite = argv.find((a) => !a.startsWith('--'));
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? null : argv[at + 1];
};

if (!suite || !SUITES[suite]) {
  console.error(`usage: run-review-suite.mjs <${Object.keys(SUITES).join('|')}> [--launch-chrome] [--out DIR]`);
  process.exit(2);
}

function git(args) {
  try {
    return execSync(`git ${args}`, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const head = {
  sha: git('rev-parse HEAD'),
  shortSha: git('rev-parse --short HEAD'),
  branch: git('rev-parse --abbrev-ref HEAD'),
  subject: git('log -1 --pretty=%s'),
  // A review of a dirty tree is a review of something that is not on any branch. Recorded, loudly.
  dirty: (git('status --porcelain') ?? '').length > 0,
};

const startedAt = new Date().toISOString();
const outDir = value('out')
  ? join(REPO_ROOT, value('out'))
  : join(REPO_ROOT, '.local', 'review', `${suite}-${head.shortSha}-${startedAt.replace(/[:.]/g, '-')}`);
const evidenceDir = join(outDir, 'evidence');
mkdirSync(evidenceDir, { recursive: true });
mkdirSync(SCRATCH, { recursive: true });

// ── chrome ──────────────────────────────────────────────────────────────────────────────────────
const CHROME_CANDIDATES = [
  process.env.GALAQUEST_CHROME,
  'google-chrome-stable', 'google-chrome', 'chromium-browser', 'chromium',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);

async function chromeVersion() {
  try {
    const r = await fetch(`http://127.0.0.1:${CHROME_PORT}/json/version`, { signal: AbortSignal.timeout(2000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

let chromeChild = null;
async function ensureChrome() {
  const already = await chromeVersion();
  if (already) return { version: already, launched: false };
  if (!flag('launch-chrome')) {
    throw new Error(
      `no CDP endpoint on 127.0.0.1:${CHROME_PORT}. Start the automation Chrome, or pass --launch-chrome.`,
    );
  }
  const profile = join(REPO_ROOT, '.local', `chrome-${CHROME_PORT}-review`);
  mkdirSync(profile, { recursive: true });
  for (const bin of CHROME_CANDIDATES) {
    // Port 9224 on purpose: 9223 is the owner's signed-in browser and this must never attach to it.
    chromeChild = spawn(bin, [
      `--remote-debugging-port=${CHROME_PORT}`,
      `--user-data-dir=${profile}`,
      '--headless=new',
      '--no-sandbox',                     // required in the CI container; harmless locally
      '--disable-dev-shm-usage',          // /dev/shm is small on runners and Chrome will crash without this
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ], { stdio: 'ignore', detached: false });
    chromeChild.on('error', () => {});
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 500));
      const v = await chromeVersion();
      if (v) return { version: v, launched: true, binary: bin };
      if (chromeChild.exitCode !== null) break;   // this binary is not on this machine; try the next
    }
    try { chromeChild.kill(); } catch { /* already gone */ }
    chromeChild = null;
  }
  throw new Error(`could not launch any of: ${CHROME_CANDIDATES.join(', ')}`);
}

// These files exit through process.exit(), which SKIPS a finally block but always runs 'exit'
// handlers -- the same lesson owned-server.mjs records.
process.on('exit', () => { if (chromeChild && chromeChild.exitCode === null) chromeChild.kill(); });

// ── evidence attribution ────────────────────────────────────────────────────────────────────────
function snapshot(dir) {
  const seen = new Map();
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const s = statSync(full);
        seen.set(full, `${s.size}:${s.mtimeMs}`);
      }
    }
  };
  walk(dir);
  return seen;
}

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** VIEWPORT is declared as a one-line literal in every harness; parsed from source, not assumed. */
function viewportOf(name) {
  try {
    const src = readFileSync(join(HARNESS_DIR, `${name}.mjs`), 'utf8');
    const m = src.match(/const VIEWPORT = (\{[^}]*\})/);
    return m ? JSON.parse(m[1].replace(/(\w+):/g, '"$1":').replace(/,\s*}/, '}')) : null;
  } catch {
    return null;
  }
}

function run(name) {
  const script = join('tools', 'runtime-test', `${name}.mjs`);
  return new Promise((resolve) => {
    const startedAtMs = Date.now();
    const child = spawn(process.execPath, [script], { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const tee = (stream, sink) => stream.on('data', (b) => {
      const text = b.toString();
      out += text;
      sink.write(text);
    });
    tee(child.stdout, process.stdout);
    tee(child.stderr, process.stderr);
    child.on('close', (code) => resolve({ exitCode: code, stdout: out, durationMs: Date.now() - startedAtMs }));
    child.on('error', (err) => resolve({ exitCode: -1, stdout: `${out}\nspawn failed: ${err.message}`, durationMs: Date.now() - startedAtMs }));
  });
}

// ── go ──────────────────────────────────────────────────────────────────────────────────────────
console.log(`GalaQuest review suite "${suite}"`);
console.log(`  HEAD ${head.sha}${head.dirty ? '  *** WORKING TREE DIRTY ***' : ''}`);
console.log(`  ${head.branch} — ${head.subject}`);
console.log(`  review dir ${relative(REPO_ROOT, outDir)}`);

const chrome = await ensureChrome();
console.log(`  chrome ${chrome.version.Browser} on :${CHROME_PORT}${chrome.launched ? ' (launched by this runner)' : ' (already running)'}\n`);

const commands = [];
const evidence = new Map();

for (const name of SUITES[suite]) {
  const meta = HARNESSES[name];
  console.log(`── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}`);
  const before = snapshot(SCRATCH);
  const result = await run(name);
  const after = snapshot(SCRATCH);

  const artifacts = [];
  for (const [path, stampNow] of after) {
    if (before.get(path) === stampNow) continue;      // untouched by this command
    const rel = relative(SCRATCH, path).split('\\').join('/');
    const dest = join(evidenceDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(path, dest);
    artifacts.push(rel);
    evidence.set(rel, { path: rel, bytes: statSync(dest).size, sha256: sha256(dest), from: name });
  }

  commands.push({
    name,
    argv: ['node', `tools/runtime-test/${name}.mjs`],
    exitCode: result.exitCode,
    exitCodeIsGate: meta.gate,
    why: meta.why,
    durationMs: result.durationMs,
    viewport: viewportOf(name),
    artifacts,
    stdoutTail: result.stdout.trim().split('\n').slice(-25).join('\n'),
  });
  console.log(`   → exit ${result.exitCode}${meta.gate ? '' : ' (not a gate)'}, ${artifacts.length} file(s), ${(result.durationMs / 1000).toFixed(1)}s\n`);
}

const failed = commands.filter((c) => c.exitCodeIsGate && c.exitCode !== 0);

const manifest = {
  schema: 'galaquest.review-manifest/1',
  suite,
  startedAt,
  finishedAt: new Date().toISOString(),
  head,
  runner: {
    node: process.version,
    platform: process.platform,
    cdpPort: CHROME_PORT,
    chrome: chrome.version.Browser,
    chromeLaunchedByRunner: chrome.launched,
    chromeBinary: chrome.binary ?? null,
  },
  notes: {
    viewportSource: 'parsed from each harness\'s own `const VIEWPORT = {...}` line',
    serverOwnership: 'every harness spawns and owns its own server on an isolated port (phase H1)',
    guestDiscipline: 'every navigating harness clears storage before its first navigation (GQ-008)',
    exitCodeCaveat: 'fit-sword, fit-carry and fit-lantern always exit 0 by design; they are measuring '
      + 'instruments, not gates. Read their baked JSON and captures instead.',
  },
  commands,
  evidence: [...evidence.values()].sort((a, b) => a.path.localeCompare(b.path)),
  totals: {
    commands: commands.length,
    gatingCommands: commands.filter((c) => c.exitCodeIsGate).length,
    failedGating: failed.length,
    evidenceFiles: evidence.size,
    evidenceBytes: [...evidence.values()].reduce((n, e) => n + e.bytes, 0),
  },
};

writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log('═'.repeat(70));
console.log(`REVIEW MANIFEST — suite "${suite}" @ ${head.sha}`);
console.log(`  ${manifest.totals.evidenceFiles} evidence file(s), ${(manifest.totals.evidenceBytes / 1024).toFixed(0)} KB`);
for (const c of commands) {
  const verdict = c.exitCodeIsGate ? (c.exitCode === 0 ? 'PASS' : 'FAIL') : 'INFO';
  console.log(`  ${verdict.padEnd(5)} ${c.name.padEnd(18)} exit ${String(c.exitCode).padStart(3)}  ${String(c.artifacts.length).padStart(2)} file(s)  ${(c.durationMs / 1000).toFixed(1)}s`);
}
console.log(`  ${failed.length ? `${failed.length} GATING FAILURE(S): ${failed.map((c) => c.name).join(', ')}` : 'all gating harnesses passed'}`);
console.log(`  manifest: ${relative(REPO_ROOT, join(outDir, 'manifest.json'))}`);
console.log('═'.repeat(70));

process.exit(failed.length ? 1 : 0);
