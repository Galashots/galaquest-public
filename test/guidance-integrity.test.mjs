import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));

// Active guidance is explicit at the top level, then recursive inside stable guidance directories so
// new product/runbook/skill Markdown is picked up automatically. docs/MISTAKES.md is historical and
// deliberately not current-path linted: it must be allowed to explain removed implementations.
const GUIDANCE_FILES = [
  'AGENTS.md',
  'README.md',
  '.github/pull_request_template.md',
  'docs/CODEBASE.md',
  'docs/GLOSSARY.md',
  'docs/GUIDANCE.md',
  'docs/WORKFLOW.md',
  'docs/GALAQUEST_VISUAL_AUTHORITY.md',
  'docs/public-playtest.md',
  'tools/foundry/README.md',
  'tools/meshy/README.md',
];

const GUIDANCE_DIRS = [
  'docs/product',
  'docs/pipeline',
  'docs/review-guides',
  // Briefs, asset-production records, and foundry/teardown authorities are guidance too: every dead
  // path the 2026-08-25 repo audit found lived in exactly these then-unlinted trees, while the
  // linted corpus was clean. Historical documents in them stay linted -- a record whose paths have
  // left the public tree must say so (banner/`MISSING IN PUBLIC` prose) rather than keep presenting
  // them as current, which is the same bar docs/GALAQUEST_VISUAL_AUTHORITY.md already meets.
  'docs/briefs',
  'docs/asset-production',
  'docs/foundry',
  'docs/teardown',
  '.agents/skills',
];

// The visual-authority document is also an explicit gap inventory: it may name a missing reference so
// readers know the authority is absent. Links in it are still checked. Ordinary runbooks/skills do not
// get this exception; a command/path they present as usable must resolve in the public checkout.
const REPO_PATH_SCAN_EXEMPT = new Set(['docs/GALAQUEST_VISUAL_AUTHORITY.md']);

function walkMarkdown(relDir) {
  const root = join(REPO, relDir);
  assert.ok(existsSync(root), `guidance root is missing: ${relDir}`);
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.md$/i.test(entry.name)) out.push(relative(REPO, full).split(sep).join('/'));
    }
  };
  walk(root);
  return out;
}

const guidanceFiles = [...new Set([
  ...GUIDANCE_FILES,
  ...GUIDANCE_DIRS.flatMap(walkMarkdown),
])].sort();

function lineAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function markdownLinks(source) {
  const links = [];
  // Deliberately simple CommonMark subset: active guidance uses ordinary inline links. External URLs
  // and same-file anchors are skipped because network/heading lint would be brittle and low-value.
  const pattern = /!?\[[^\]]*\]\(([^)\n]+)\)/g;
  for (const match of source.matchAll(pattern)) {
    let target = match[1].trim();
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim();
    const title = target.match(/^([^\s]+)\s+["'][^"']*["']$/);
    if (title) target = title[1];
    links.push({ target, index: match.index ?? 0 });
  }
  return links;
}

function isExternalOrAnchor(target) {
  return target.startsWith('#')
    || /^[a-z][a-z0-9+.-]*:/i.test(target)
    || target.startsWith('//');
}

function brokenRelativeLinks(relFile, source, root = REPO) {
  const failures = [];
  for (const { target, index } of markdownLinks(source)) {
    if (isExternalOrAnchor(target)) continue;
    const rawPath = target.split('#')[0].split('?')[0];
    if (!rawPath) continue;
    let decoded;
    try { decoded = decodeURIComponent(rawPath); } catch { decoded = rawPath; }
    const resolved = resolve(root, dirname(relFile), decoded);
    const rootPrefix = `${resolve(root)}${sep}`;
    if (resolved !== resolve(root) && !resolved.startsWith(rootPrefix)) {
      failures.push(`${relFile}:${lineAt(source, index)} link escapes repository: ${target}`);
      continue;
    }
    if (!existsSync(resolved)) failures.push(`${relFile}:${lineAt(source, index)} missing link target: ${target}`);
  }
  return failures;
}

const REPO_PATH = /(?:^|[\s`'"(=])((?:\.agents|\.github|docs|tools|public|test|net|data)[\\/][A-Za-z0-9_.@+~\\/-]+)/gm;

function repoPathReferences(source) {
  const refs = [];
  for (const match of source.matchAll(REPO_PATH)) {
    let value = match[1].replaceAll('\\', '/');
    value = value.replace(/[.,;:]+$/, '');
    refs.push({ path: value, index: (match.index ?? 0) + match[0].indexOf(match[1]) });
  }
  return refs;
}

function brokenRepoPaths(relFile, source, root = REPO) {
  const failures = [];
  for (const { path, index } of repoPathReferences(source)) {
    if (!existsSync(resolve(root, path))) failures.push(`${relFile}:${lineAt(source, index)} missing repo path: ${path}`);
  }
  return failures;
}

test('active guidance corpus is explicit and substantial', () => {
  assert.ok(guidanceFiles.length >= 15, `only ${guidanceFiles.length} guidance files found; scope likely regressed`);
  for (const rel of GUIDANCE_FILES) {
    assert.ok(existsSync(join(REPO, rel)), `required guidance file is missing: ${rel}`);
    assert.ok(statSync(join(REPO, rel)).isFile(), `required guidance path is not a file: ${rel}`);
  }
});

test('Claude bootstrap imports the canonical root authority exactly', () => {
  const claude = join(REPO, 'CLAUDE.md');
  assert.ok(existsSync(claude), 'root CLAUDE.md is missing');
  assert.equal(readFileSync(claude, 'utf8'), '@AGENTS.md\n',
    'root CLAUDE.md must remain the exact pointer-only bootstrap');
});

test('active guidance has no broken relative Markdown links', () => {
  const failures = [];
  for (const rel of guidanceFiles) failures.push(...brokenRelativeLinks(rel, readFileSync(join(REPO, rel), 'utf8')));
  assert.deepEqual(failures, [], `broken guidance links:\n${failures.join('\n')}`);
});

test('active runbooks and skills only name repo-local paths that exist', () => {
  const failures = [];
  for (const rel of guidanceFiles) {
    if (REPO_PATH_SCAN_EXEMPT.has(rel)) continue;
    failures.push(...brokenRepoPaths(rel, readFileSync(join(REPO, rel), 'utf8')));
  }
  assert.deepEqual(failures, [], `dead repo paths in active guidance:\n${failures.join('\n')}`);
});

test('active guidance does not hardcode a machine-local absolute path', () => {
  const failures = [];
  const absolute = /(?:[A-Za-z]:\\(?:Users|Program Files|ProgramData)\\|\/(?:Users|home)\/[A-Za-z0-9._-]+\/)/g;
  for (const rel of guidanceFiles) {
    const source = readFileSync(join(REPO, rel), 'utf8');
    for (const match of source.matchAll(absolute)) failures.push(`${rel}:${lineAt(source, match.index ?? 0)} ${match[0]}`);
  }
  assert.deepEqual(failures, [], `machine-local paths in durable guidance:\n${failures.join('\n')}`);
});

test('durable authority does not encode transient PR routing or provider spend permission', () => {
  const durable = ['AGENTS.md', 'docs/WORKFLOW.md', 'docs/GUIDANCE.md', 'tools/meshy/README.md']
    .map((rel) => `${rel}\n${readFileSync(join(REPO, rel), 'utf8')}`).join('\n');

  assert.doesNotMatch(durable, /\bcurrent\s+(?:private\s+|public\s+)?PR\s+#\d+/i,
    'durable guidance must not route future work through a PR number that will go stale');
  assert.doesNotMatch(durable, /\bcurrent owner authorization\b/i,
    'repository prose must not turn a session-scoped provider authorization into durable permission');

  const meshy = readFileSync(join(REPO, 'tools/meshy/README.md'), 'utf8');
  assert.match(meshy, /does not grant spend authority/i,
    'Meshy client guidance must say explicitly that budgets/ceilings are not authorization');
  assert.match(meshy, /explicit owner authorization for that specific current work/i,
    'Meshy client guidance must preserve per-work spend authorization');
});

test('sabotage: guidance scanners detect the objective failure modes they claim to prevent', () => {
  const root = mkdtempSync(join(tmpdir(), 'gq-guidance-'));
  try {
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(root, 'tools'), { recursive: true });
    writeFileSync(join(root, 'docs', 'ok.md'), '# ok\n');
    const source = '[ok](ok.md) [bad](missing.md)\n`node tools/missing.mjs`\n';
    assert.deepEqual(brokenRelativeLinks('docs/check.md', source, root),
      ['docs/check.md:1 missing link target: missing.md']);
    assert.deepEqual(repoPathReferences(source).map((x) => x.path), ['tools/missing.mjs']);
    assert.deepEqual(brokenRepoPaths('docs/check.md', source, root),
      ['docs/check.md:2 missing repo path: tools/missing.mjs']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
