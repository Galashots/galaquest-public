/**
 * Pure protocol logic for the Sol review bridge (SR1), split out of worker.mjs so it is importable
 * without pulling in git/filesystem/Drive I/O -- test/sol-review-protocol.test.mjs exercises this
 * directly.
 */

/**
 * A small JSON Schema subset interpreter -- just the keywords sol-review/request.schema.json
 * actually uses (const, enum, if/then/else, object/string/integer/number/array with
 * required/additionalProperties/maxProperties/minLength/maxLength/pattern/minimum/minItems/maxItems/
 * items). Not a general validator: the schema file on sol-review-control is the single source of
 * truth for the contract; this is only enough machinery to enforce it, so a phase can extend the
 * schema (SR3 added studioCapture, keyed off `mode` via if/then/else) without a second, drifting
 * copy of the rules here.
 *
 * type-specific checks accumulate into `errors` rather than returning early, so a schema node that
 * combines a `type` with `if`/`then`/`else` (this schema's top level does exactly that) still gets
 * both: the base object shape is checked, AND the conditional branch selected by `mode` is checked,
 * in the same pass.
 */
export function validate(schema, data, path = '$') {
  const errors = [];
  if (schema.const !== undefined && data !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(data)}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(`${path}: ${JSON.stringify(data)} is not one of ${JSON.stringify(schema.enum)}`);
    return errors;
  }

  // A schema.if/then/else branch (e.g. { properties: { mode: { const: 'ping' } } }) commonly omits
  // an explicit `type: 'object'` -- real JSON Schema still applies `properties`/`required` whenever
  // they're present, regardless of a declared type, so this checks for their presence rather than
  // requiring `type` to be spelled out. Caught by two tests that both silently reported zero errors
  // instead of the expected rejections, because this branch never ran for an untyped if/then schema.
  const isObjectSchema = schema.type === 'object' || schema.properties !== undefined || schema.required !== undefined;
  if (isObjectSchema) {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      errors.push(`${path}: expected an object`);
    } else {
      for (const key of schema.required ?? []) {
        if (!(key in data)) errors.push(`${path}: missing required field "${key}"`);
      }
      if (schema.additionalProperties === false) {
        const allowed = new Set(Object.keys(schema.properties ?? {}));
        for (const key of Object.keys(data)) {
          if (!allowed.has(key)) errors.push(`${path}: unknown field "${key}"`);
        }
      }
      if (schema.maxProperties !== undefined && Object.keys(data).length > schema.maxProperties) {
        errors.push(`${path}: has ${Object.keys(data).length} fields, max is ${schema.maxProperties}`);
      }
      for (const [key, subschema] of Object.entries(schema.properties ?? {})) {
        if (key in data) errors.push(...validate(subschema, data[key], `${path}.${key}`));
      }
    }
  } else if (schema.type === 'string') {
    if (typeof data !== 'string') {
      errors.push(`${path}: expected a string`);
    } else {
      if (schema.minLength !== undefined && data.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
      if (schema.maxLength !== undefined && data.length > schema.maxLength) errors.push(`${path}: longer than ${schema.maxLength}`);
      if (schema.pattern && !new RegExp(schema.pattern).test(data)) errors.push(`${path}: does not match ${schema.pattern}`);
    }
  } else if (schema.type === 'integer') {
    if (!Number.isInteger(data)) {
      errors.push(`${path}: expected an integer`);
    } else {
      if (schema.minimum !== undefined && data < schema.minimum) errors.push(`${path}: below minimum ${schema.minimum}`);
      if (schema.maximum !== undefined && data > schema.maximum) errors.push(`${path}: above maximum ${schema.maximum}`);
    }
  } else if (schema.type === 'number') {
    if (typeof data !== 'number' || Number.isNaN(data)) {
      errors.push(`${path}: expected a number`);
    } else {
      if (schema.minimum !== undefined && data < schema.minimum) errors.push(`${path}: below minimum ${schema.minimum}`);
      if (schema.maximum !== undefined && data > schema.maximum) errors.push(`${path}: above maximum ${schema.maximum}`);
    }
  } else if (schema.type === 'boolean') {
    if (typeof data !== 'boolean') errors.push(`${path}: expected a boolean`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(data)) {
      errors.push(`${path}: expected an array`);
    } else {
      if (schema.minItems !== undefined && data.length < schema.minItems) errors.push(`${path}: has ${data.length} items, min is ${schema.minItems}`);
      if (schema.maxItems !== undefined && data.length > schema.maxItems) errors.push(`${path}: has ${data.length} items, max is ${schema.maxItems}`);
      if (schema.items) data.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
    }
  }

  // Standard JSON Schema conditional: if `data` matches `if` with zero errors, `then` must also
  // hold; otherwise `else` must hold (when present). Evaluated regardless of `type` above, since
  // this schema's top level carries both an object `type` and an if/then/else sibling.
  if (schema.if) {
    const ifErrors = validate(schema.if, data, path);
    if (ifErrors.length === 0 && schema.then) errors.push(...validate(schema.then, data, path));
    else if (ifErrors.length > 0 && schema.else) errors.push(...validate(schema.else, data, path));
  }

  return errors;
}

/** True if `(sessionId, seq)` is already recorded in a `loadSeen()`-shaped store. */
export function alreadySeen(seen, sessionId, seq) {
  return Array.isArray(seen[sessionId]) && seen[sessionId].includes(seq);
}

/** Returns a NEW seen-store with `(sessionId, seq)` added -- does not mutate `seen`, so a caller
 *  (or a test) can compare before/after without cloning first. */
export function withSeen(seen, sessionId, seq) {
  return { ...seen, [sessionId]: [...(seen[sessionId] ?? []), seq] };
}
