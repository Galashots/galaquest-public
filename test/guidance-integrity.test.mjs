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

// Active guidance is intentionally explicit at the top level, then recursive inside stable guidance
// directories so a new runbook/skill is picked up automatically. docs/MISTAKES.md is a historical
// ledger and is deliberately not current-path linted: it must be allowed to discuss removed systems.
const GUIDANCE_FILES = [
  'AGENTS.md',
  'README.md',
  'docs/GUIDANCE.md',
  'docs/WORKFLOW.md',
  'docs/GALAQUEST_VISUAL_AUTHORITY.md',
  'docs/public-playtest.md',
  'tools/foundry/README.md',
  'tools/meshy/README.md',
];

const GUIDANCE_DIRS = [
  'docs/pipeline',
  'docs/review-guides',
  '.agents/skills',
];

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
    // Drop an optional Markdown title: path "title" or path 'title'.
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
    if (!existsSync(resolved)) {
      failures.push(`${relFile}:${lineAt(source, index)} missing link target: ${target}`);
    }
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
    // A token ending at a real directory before a placeholder/glob is useful and should pass.
    const resolved = resolve(root, path);
    if (!existsSync(resolved)) {
      failures.push(`${relFile}:${lineAt(source, index)} missing repo path: ${path}`);
    }
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

test('active guidance has no broken relative Markdown links', () => {
  const failures = [];
  for (const rel of guidanceFiles) {
    const source = readFileSync(join(REPO, rel), 'utf8');
    failures.push(...brokenRelativeLinks(rel, source));
  }
  assert.deepEqual(failures, [], `broken guidance links:\n${failures.join('\n')}`);
});

test('active guidance only names repo-local paths that exist', () => {
  const failures = [];
  for (const rel of guidanceFiles) {
    const source = readFileSync(join(REPO, rel), 'utf8');
    failures.push(...brokenRepoPaths(rel, source));
  }
  assert.deepEqual(failures, [], `dead repo paths in active guidance:\n${failures.join('\n')}`);
});

test('durable authority does not encode transient PR routing or provider spend permission', () => {
  const durable = [
    'AGENTS.md',
    'docs/WORKFLOW.md',
    'docs/GUIDANCE.md',
    'tools/meshy/README.md',
  ].map((rel) => `${rel}\n${readFileSync(join(REPO, rel), 'utf8')}`).join('\n');

  assert.doesNotMatch(
    durable,
    /\bcurrent\s+(?:private\s+|public\s+)?PR\s+#\d+/i,
    'durable guidance must not route future work through a PR number that will go stale',
  );
  assert.doesNotMatch(
    durable,
    /\bcurrent owner authorization\b/i,
    'repository prose must not turn a session-scoped provider authorization into durable permission',
  );

  const meshy = readFileSync(join(REPO, 'tools/meshy/README.md'), 'utf8');
  assert.match(meshy, /does not grant spend authority/i,
    'Meshy client guidance must say explicitly that budgets/ceilings are not authorization');
  assert.match(meshy, /explicit owner authorization for that specific current work/i,
    'Meshy client guidance must preserve per-work spend authorization');
});

test('sabotage: the guidance scanners detect the failure modes they claim to prevent', () => {
  const root = mkdtempSync(join(tmpdir(), 'gq-guidance-'));
  try {
    const docs = join(root, 'docs');
    const tools = join(root, 'tools');
    mkdirSync(docs, { recursive: true });
    mkdirSync(tools, { recursive: true });
    writeFileSync(join(docs, 'ok.md'), '# ok\n');
    const source = '[ok](ok.md) [bad](missing.md)\n`node tools/missing.mjs`\n';
    assert.deepEqual(
      brokenRelativeLinks('docs/check.md', source, root),
      ['docs/check.md:1 missing link target: missing.md'],
    );
    assert.deepEqual(repoPathReferences(source).map((x) => x.path), ['tools/missing.mjs']);
    assert.equal(existsSync(join(root, 'tools/missing.mjs')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
