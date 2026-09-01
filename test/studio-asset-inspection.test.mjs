// Studio Inspect (#92 STUDIO-V2A): pure fact-shaping from a registry record. The load-bearing
// property is negative: an UNKNOWN field in the registry must render as the literal string
// "UNKNOWN" here too -- never 0, never null, never silently dropped.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildInspectionFacts, mergeMeasuredFacts } from '../public/src/studio/assetInspection.js';

const root = resolve(import.meta.dirname, '..');
const registry = JSON.parse(readFileSync(resolve(root, 'docs/asset-production/asset-registry-v1.json'), 'utf8'));
const records = registry.records;

function find(id) {
  const record = records.find((r) => r.asset_id === id);
  if (!record) throw new Error(`fixture missing: ${id}`);
  return record;
}

test('an unaudited asset\'s UNKNOWN structural metrics stay the literal string, never defaulted', () => {
  const facts = buildInspectionFacts(find('enemy.wolf'));
  assert.equal(facts.declaredStructuralMetrics.mesh_count, 'UNKNOWN');
  assert.equal(facts.declaredStructuralMetrics.triangle_count, 'UNKNOWN');
  assert.notEqual(facts.declaredStructuralMetrics.mesh_count, 0);
  assert.notEqual(facts.declaredStructuralMetrics.mesh_count, null);
});

test('an audited asset\'s real numbers pass through unchanged', () => {
  const facts = buildInspectionFacts(find('cinderfang-raider-v1'));
  assert.equal(facts.declaredStructuralMetrics.mesh_count, 1);
  assert.equal(facts.declaredStructuralMetrics.joint_count, 24);
  assert.equal(facts.declaredStructuralMetrics.animation_clip_count, 1);
});

test('custody/provenance/qualification facts are all present, not a curated subset', () => {
  const facts = buildInspectionFacts(find('hero.base'));
  assert.equal(facts.assetId, 'hero.base');
  assert.equal(facts.custody, 'IN_GIT');
  assert.equal(facts.recoverability, 'VERIFIED_FROM_GIT');
  assert.ok(Array.isArray(facts.custodyLocations) && facts.custodyLocations.length > 0);
  assert.ok(facts.qualificationGates.provenance);
  assert.ok(facts.qualificationGates.rig);
  assert.equal(facts.rights.license.status, 'UNKNOWN');
  assert.equal(facts.rights.license.value, null);
});

test('a provider/Drive-only record with no measurable structural facts stays UNKNOWN across the board', () => {
  const facts = buildInspectionFacts(find('animation-source.hero.meshy.hdus9c'));
  assert.equal(facts.declaredStructuralMetrics.animation_clip_count, 'UNKNOWN');
  assert.equal(facts.recoverability, 'UNAVAILABLE_CURRENT_PROVIDER_CONTEXT');
  assert.equal(facts.measuredStructuralMetrics, null, 'nothing was ever loaded, so nothing was measured');
});

test('measured facts (from an actually-loaded GLB) merge in without erasing the declared registry facts', () => {
  const declared = buildInspectionFacts(find('enemy.wolf'));
  const merged = mergeMeasuredFacts(declared, { meshCount: 3, triangleCount: 5120, materialCount: 2, animationClipCount: 4 });
  assert.equal(merged.declaredStructuralMetrics.mesh_count, 'UNKNOWN', 'declared value is untouched');
  assert.equal(merged.measuredStructuralMetrics.meshCount, 3);
  assert.equal(merged.measuredStructuralMetrics.triangleCount, 5120);
});

test('an unknown asset id produces null, never a guessed nearest record', () => {
  assert.equal(buildInspectionFacts(null), null);
});

test('runtimeAvailability is passed through when present and null when the record was never augmented', () => {
  const augmented = { ...find('hero.base'), runtime_availability: { loadable: true, runtimeUrl: '/assets/hero/hero.glb', reason: null } };
  assert.equal(buildInspectionFacts(augmented).runtimeAvailability.loadable, true);

  const unaugmented = find('hero.base');
  assert.equal(buildInspectionFacts(unaugmented).runtimeAvailability, null);
});
