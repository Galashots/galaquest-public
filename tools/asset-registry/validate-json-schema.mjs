const typeMatches = (value, expected) => {
  if (expected === 'null') return value === null;
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (expected === 'integer') return Number.isInteger(value);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === expected;
};

const pointer = (root, ref) => {
  if (!ref.startsWith('#/')) throw new Error(`unsupported external schema ref: ${ref}`);
  return ref.slice(2).split('/').reduce((value, segment) => value[segment.replaceAll('~1', '/').replaceAll('~0', '~')], root);
};

export function validateJsonSchema(instance, schema) {
  const errors = [];
  const visit = (value, rule, path = '$') => {
    if (rule.$ref) return visit(value, pointer(schema, rule.$ref), path);
    if (rule.anyOf) {
      const matches = rule.anyOf.filter((candidate) => {
        const before = errors.length;
        visit(value, candidate, path);
        const ok = errors.length === before;
        errors.splice(before);
        return ok;
      });
      if (!matches.length) errors.push(`${path}: does not match anyOf`);
      return;
    }
    if (rule.const !== undefined && value !== rule.const) errors.push(`${path}: expected const ${JSON.stringify(rule.const)}`);
    if (rule.enum && !rule.enum.some((candidate) => Object.is(candidate, value))) errors.push(`${path}: value ${JSON.stringify(value)} not in enum`);
    if (rule.type) {
      const expected = Array.isArray(rule.type) ? rule.type : [rule.type];
      if (!expected.some((type) => typeMatches(value, type))) {
        errors.push(`${path}: expected type ${expected.join('|')}`);
        return;
      }
    }
    if (typeof value === 'string') {
      if (rule.minLength !== undefined && value.length < rule.minLength) errors.push(`${path}: shorter than minLength ${rule.minLength}`);
      if (rule.pattern && !new RegExp(rule.pattern).test(value)) errors.push(`${path}: does not match ${rule.pattern}`);
    }
    if (typeof value === 'number' && rule.minimum !== undefined && value < rule.minimum) errors.push(`${path}: less than minimum ${rule.minimum}`);
    if (Array.isArray(value)) {
      if (rule.minItems !== undefined && value.length < rule.minItems) errors.push(`${path}: fewer than minItems ${rule.minItems}`);
      if (rule.uniqueItems) {
        const encoded = value.map((item) => JSON.stringify(item));
        if (new Set(encoded).size !== encoded.length) errors.push(`${path}: duplicate array items`);
      }
      if (rule.items) value.forEach((item, index) => visit(item, rule.items, `${path}[${index}]`));
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const required of rule.required ?? []) if (!(required in value)) errors.push(`${path}.${required}: required property missing`);
      for (const [key, child] of Object.entries(rule.properties ?? {})) if (key in value) visit(value[key], child, `${path}.${key}`);
      if (rule.additionalProperties === false) {
        const allowed = new Set(Object.keys(rule.properties ?? {}));
        for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key}: additional property not allowed`);
      }
    }
  };
  visit(instance, schema);
  return errors;
}
