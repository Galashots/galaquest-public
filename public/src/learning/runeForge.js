export const MAGMALORD_ENTITLEMENT_ID = 'emberworks.rune-forge.magmalord-helmet.v1';
export const MAGMALORD_HELMET_ID = 'helmet_magmalord';
export const FORGE_PACK_SELECTED = 'forge-pack-selected';
export const FORGE_TASK_ATTEMPTED = 'forge-task-attempted';
export const FORGE_TASK_ASSISTED = 'forge-task-assisted';
export const FORGE_TASK_COMPLETED = 'forge-task-completed';
// P3-CP1: the completing profile's own Relight fact. A profile fact (private forge family), NOT
// a task completion: it names the finale the profile took part in, not one more hammered rune.
export const FORGE_RELIGHT_COMPLETED = 'forge-relight-completed';
// P3-CP1: the ONE shared-world row the finale writes. Fixed identity on the beacon-lit pattern
// (`beacon-lit:old-beacon`): type names the shared truth, suffix names the place. The guestId on
// the row is provenance only, never a scope.
export const EMBERWORKS_FORGE_LIT_EVENT_ID = 'emberworks-forge-lit:rune-forge';

const ID = /^[a-z0-9][a-z0-9._-]{1,79}$/;

function requireText(value, label, max = 180) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max)
    throw new Error(`${label} must be non-empty text no longer than ${max}`);
  return value;
}

function requireId(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(`${label} is not a stable id`);
  return value;
}

export function validateRuneForgeCatalog(candidate) {
  if (!candidate || candidate.schema !== 'galaquest-rune-forge-catalog' || candidate.schemaVersion !== 1)
    throw new Error('Rune Forge catalog must use schema version 1.');
  const entitlement = candidate.entitlement;
  requireId(entitlement?.id, 'entitlement.id');
  requireId(entitlement?.itemId, 'entitlement.itemId');
  requireText(entitlement?.displayName, 'entitlement.displayName', 48);
  if (entitlement.id !== MAGMALORD_ENTITLEMENT_ID || entitlement.itemId !== MAGMALORD_HELMET_ID)
    throw new Error('Rune Forge catalog cannot redirect the selected MagmaLord entitlement.');
  if (!Array.isArray(candidate.packs) || candidate.packs.length !== 2)
    throw new Error('Rune Forge V1 requires exactly the two selected packs.');
  const packIds = new Set();
  // Task ids are a single namespace across the whole catalog, not per pack: completionFact()
  // resolves a task id to its owning pack by scanning packs in declaration order and returning
  // the first match, so two packs sharing a task id would let a completion meant for the second
  // pack silently record against the first pack's identically-named task instead. #159.
  const taskIds = new Set();
  for (const pack of candidate.packs) {
    requireId(pack?.id, 'pack.id');
    if (packIds.has(pack.id)) throw new Error(`duplicate pack id ${pack.id}`);
    packIds.add(pack.id);
    requireText(pack.contentVersion, `${pack.id}.contentVersion`, 32);
    requireText(pack.title, `${pack.id}.title`, 32);
    requireText(pack.sourceBasis, `${pack.id}.sourceBasis`, 240);
    if (pack.interaction !== 'rune-hammer') throw new Error(`${pack.id} must use rune-hammer`);
    if (pack.requiredSuccesses !== 2) throw new Error(`${pack.id} must require two successes`);
    if (!Array.isArray(pack.tasks) || pack.tasks.length < 3 || pack.tasks.length > 8)
      throw new Error(`${pack.id} needs three to eight bounded tasks`);
    for (const task of pack.tasks) {
      requireId(task?.id, `${pack.id}.task.id`);
      if (taskIds.has(task.id)) throw new Error(`duplicate task id ${task.id} across packs`);
      taskIds.add(task.id);
      requireId(task.skill, `${task.id}.skill`);
      requireText(task.spokenPrompt, `${task.id}.spokenPrompt`, 180);
      requireText(task.displayPrompt, `${task.id}.displayPrompt`, 180);
      requireText(task.hint, `${task.id}.hint`, 180);
      if (!Array.isArray(task.choices) || task.choices.length !== 3)
        throw new Error(`${task.id} needs exactly three physical rune choices`);
      const choiceIds = new Set();
      for (const choice of task.choices) {
        requireId(choice?.id, `${task.id}.choice.id`);
        if (choiceIds.has(choice.id)) throw new Error(`duplicate choice id ${choice.id}`);
        choiceIds.add(choice.id);
        requireText(choice.label, `${task.id}.${choice.id}.label`, 40);
        if (typeof choice.correct !== 'boolean') throw new Error(`${task.id}.${choice.id}.correct must be boolean`);
      }
      if (task.choices.filter(choice => choice.correct).length !== 1)
        throw new Error(`${task.id} needs exactly one correct choice`);
    }
  }
  return candidate;
}

function parseCompletion(fact) {
  if (fact?.type !== FORGE_TASK_COMPLETED || typeof fact.value !== 'string') return null;
  try {
    const value = JSON.parse(fact.value);
    if (value?.entitlementId !== MAGMALORD_ENTITLEMENT_ID || typeof value.packId !== 'string'
      || typeof value.taskId !== 'string' || typeof value.contentVersion !== 'string'
      || !['independent', 'assisted'].includes(value.outcome)) return null;
    return value;
  } catch { return null; }
}

export function deriveRuneForgeState(catalogInput, factsInput = []) {
  const catalog = validateRuneForgeCatalog(catalogInput);
  const facts = Array.isArray(factsInput) ? factsInput : [];
  const selectedFact = facts.find(fact => fact?.type === FORGE_PACK_SELECTED
    && catalog.packs.some(pack => pack.id === fact.value));
  const pack = selectedFact ? catalog.packs.find(item => item.id === selectedFact.value) : null;
  const history = facts.map(parseCompletion).filter(Boolean)
    .filter(entry => !pack || entry.packId === pack.id);
  const completedIds = new Set(history.map(entry => entry.taskId));
  const completedCount = pack ? pack.tasks.filter(task => completedIds.has(task.id)).length : 0;
  const task = pack?.tasks.find(item => !completedIds.has(item.id)) ?? null;
  const owned = facts.some(fact => fact?.type === 'gear-owned' && fact.value === catalog.entitlement.itemId);
  return {
    status: owned ? 'owned' : completedCount >= (pack?.requiredSuccesses ?? Infinity) ? 'ready-to-claim'
      : pack ? 'active' : 'choose-pack',
    entitlement: catalog.entitlement,
    packs: catalog.packs.map(item => ({ id: item.id, title: item.title })),
    selectedPackId: pack?.id ?? null,
    contentVersion: pack?.contentVersion ?? null,
    completedCount,
    requiredSuccesses: pack?.requiredSuccesses ?? 2,
    readyToClaim: !owned && completedCount >= (pack?.requiredSuccesses ?? Infinity),
    owned,
    task,
    history,
  };
}

export function isCorrectChoice(task, choiceId) {
  return task?.choices?.some(choice => choice.id === choiceId && choice.correct === true) === true;
}

export function entitlementEventId(profileId, entitlementId = MAGMALORD_ENTITLEMENT_ID) {
  return `forge-entitlement:${profileId}:${entitlementId}`;
}

export function selectPackFact(profileId, catalogInput, packId) {
  const catalog = validateRuneForgeCatalog(catalogInput);
  if (!catalog.packs.some(pack => pack.id === packId)) throw new Error(`unknown Rune Forge pack ${packId}`);
  return {
    eventId: `forge-pack:${profileId}:${catalog.entitlement.id}`,
    type: FORGE_PACK_SELECTED,
    value: packId,
  };
}

/**
 * P3-CP1: whether this profile has earned the finale -- the same derived state the presenter
 * already reads, so the client's own ask and the server's allow are one rule (the discipline
 * world/rowanSpeech.js's rowanOwesBlade already follows for the Blade). Ready OR owned: a child
 * who hammered the runes but has not yet claimed the helmet still did the work the Relight asks
 * about, and claiming stays its own explicit moment.
 */
export function isRelightEligible(forgeState) {
  return forgeState?.readyToClaim === true || forgeState?.owned === true;
}

/**
 * P3-CP1: the completing profile's own Relight fact, minted by the server as part of the final
 * completion transaction (net/gameServerCore.mjs's claimForgeRelight). Stable by construction --
 * a pure function of the profile and the entitlement line -- so a retried finale is the same row,
 * and the later selected wearable reward joins that same transaction under its own stable id
 * without a second framework or identity path.
 */
export function relightCompletionFact(profileId, entitlementId = MAGMALORD_ENTITLEMENT_ID) {
  return {
    eventId: `forge-relight:${profileId}:${entitlementId}`,
    type: FORGE_RELIGHT_COMPLETED,
    value: JSON.stringify({ entitlementId }),
  };
}

export function completionFact(profileId, catalogInput, task, assisted) {
  const catalog = validateRuneForgeCatalog(catalogInput);
  const pack = catalog.packs.find(item => item.tasks.some(candidate => candidate.id === task?.id));
  if (!pack) throw new Error('completion requires a catalog task');
  return {
    eventId: `forge-complete:${profileId}:${catalog.entitlement.id}:${task.id}`,
    type: FORGE_TASK_COMPLETED,
    value: JSON.stringify({
      entitlementId: catalog.entitlement.id,
      packId: pack.id,
      taskId: task.id,
      contentVersion: pack.contentVersion,
      outcome: assisted ? 'assisted' : 'independent',
    }),
  };
}
