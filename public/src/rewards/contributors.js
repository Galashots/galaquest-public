// Marks and kill XP use the same per-enemy participation shape. A returning profile receives a
// new connection ID; moving its participation must preserve every enemy's life and replay guard.
export function reassignContributor(ledger, previousId, nextId) {
  if (!ledger || !previousId || previousId === nextId) return ledger;
  const contributorsByEnemy = new Map();
  for (const [enemyId, previous] of ledger.contributorsByEnemy) {
    const contributors = new Set(previous);
    if (contributors.delete(previousId)) contributors.add(nextId);
    contributorsByEnemy.set(enemyId, contributors);
  }
  return { ...ledger, contributorsByEnemy };
}
