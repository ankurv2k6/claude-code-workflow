// A small JSON Schema validator with no dependencies. It covers every keyword the profile schema
// (templates/workflow-profile.schema.json) declares in its description — type, properties,
// required, additionalProperties, items, enum, minimum, minLength, minItems, maxItems, pattern —
// and a few more, so a later schema revision does not silently pass.
//
// Supported: type, enum, const, properties, required, additionalProperties, patternProperties,
// propertyNames, items, prefixItems, minItems, maxItems, uniqueItems, minimum, maximum,
// exclusiveMinimum, exclusiveMaximum, minLength, maxLength, pattern, minProperties, allOf, anyOf,
// oneOf, not, if/then/else, $ref to local "#/..." pointers. Annotations are ignored.

const typeOf = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
};

const typeOk = (v, t) => {
  const actual = typeOf(v);
  if (t === 'number') return actual === 'number' || actual === 'integer';
  return actual === t;
};

function resolveRef(root, ref) {
  if (!ref.startsWith('#')) throw new Error(`only local $ref is supported: ${ref}`);
  let node = root;
  for (const raw of ref.slice(1).split('/').filter(Boolean)) {
    const k = decodeURIComponent(raw.replace(/~1/g, '/').replace(/~0/g, '~'));
    node = node?.[k];
  }
  if (node === undefined) throw new Error(`unresolved $ref ${ref}`);
  return node;
}

export function validate(value, schema, root = schema, path = '$', errors = []) {
  if (schema === true || schema === undefined) return errors;
  if (schema === false) {
    errors.push(`${path}: not allowed`);
    return errors;
  }
  if (schema.$ref) validate(value, resolveRef(root, schema.$ref), root, path, errors);

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeOk(value, t))) {
      errors.push(`${path}: expected ${types.join(' or ')}, got ${typeOf(value)}`);
      return errors;
    }
  }
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value)))
    errors.push(`${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value))
    errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);

  const t = typeOf(value);
  if (t === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength)
      errors.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      errors.push(`${path}: longer than ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value))
      errors.push(`${path}: does not match /${schema.pattern}/`);
  }
  if (t === 'number' || t === 'integer') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: above ${schema.maximum}`);
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum)
      errors.push(`${path}: must be > ${schema.exclusiveMinimum}`);
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum)
      errors.push(`${path}: must be < ${schema.exclusiveMaximum}`);
  }
  if (t === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems)
      errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems)
      errors.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length)
      errors.push(`${path}: items must be unique`);
    const prefix = schema.prefixItems || (Array.isArray(schema.items) ? schema.items : null);
    value.forEach((v, i) => {
      if (prefix && i < prefix.length) validate(v, prefix[i], root, `${path}[${i}]`, errors);
      else if (schema.items && !Array.isArray(schema.items)) validate(v, schema.items, root, `${path}[${i}]`, errors);
    });
  }
  if (t === 'object') {
    const props = schema.properties || {};
    for (const r of schema.required || []) if (!(r in value)) errors.push(`${path}: missing required "${r}"`);
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties)
      errors.push(`${path}: fewer than ${schema.minProperties} properties`);
    const pats = Object.entries(schema.patternProperties || {}).map(([p, s]) => [new RegExp(p, 'u'), s]);
    for (const [k, v] of Object.entries(value)) {
      const p = `${path}.${k}`;
      if (schema.propertyNames) validate(k, schema.propertyNames, root, `${path}{${k}}`, errors);
      let matched = false;
      if (k in props) {
        matched = true;
        validate(v, props[k], root, p, errors);
      }
      for (const [re, s] of pats)
        if (re.test(k)) {
          matched = true;
          validate(v, s, root, p, errors);
        }
      if (!matched && schema.additionalProperties !== undefined) {
        if (schema.additionalProperties === false) errors.push(`${p}: unknown key`);
        else validate(v, schema.additionalProperties, root, p, errors);
      }
    }
  }
  for (const s of schema.allOf || []) validate(value, s, root, path, errors);
  if (schema.anyOf && !schema.anyOf.some((s) => validate(value, s, root, path, []).length === 0))
    errors.push(`${path}: matches none of anyOf`);
  if (schema.oneOf) {
    const n = schema.oneOf.filter((s) => validate(value, s, root, path, []).length === 0).length;
    if (n !== 1) errors.push(`${path}: must match exactly one of oneOf (matched ${n})`);
  }
  if (schema.not && validate(value, schema.not, root, path, []).length === 0) errors.push(`${path}: must not match`);
  if (schema.if) {
    const ok = validate(value, schema.if, root, path, []).length === 0;
    if (ok && schema.then) validate(value, schema.then, root, path, errors);
    if (!ok && schema.else) validate(value, schema.else, root, path, errors);
  }
  return errors;
}
