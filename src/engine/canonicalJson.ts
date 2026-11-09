/**
 * Deterministic serialization for analysis identity (v1.11).
 *
 * Object keys are sorted; array order is significant. Numbers use JavaScript's
 * shortest round-trip decimal representation at FULL double precision — never
 * toFixed(). Non-finite numbers, sparse arrays, cycles and non-JSON values are
 * rejected explicitly instead of being silently coerced to null. Undefined
 * object properties are omitted, matching JSON.stringify semantics; null is a
 * distinct value. Inputs are the app's JSON-safe site/config/window contracts.
 */
export function canonicalJson(value: unknown): string {
  const active = new WeakSet<object>();

  function encode(v: unknown, path: string): string {
    if (v === null) return 'null';
    switch (typeof v) {
      case 'string': return JSON.stringify(v);
      case 'boolean': return v ? 'true' : 'false';
      case 'number':
        if (!Number.isFinite(v)) throw new TypeError(`Analysis identity requires a finite number at ${path}`);
        return JSON.stringify(v);
      case 'object': break;
      default:
        throw new TypeError(`Analysis identity does not accept ${typeof v} at ${path}`);
    }

    const obj = v as object;
    if (active.has(obj)) throw new TypeError(`Analysis identity contains a cycle at ${path}`);
    active.add(obj);
    try {
      if (Array.isArray(obj)) {
        const items: string[] = [];
        for (let i = 0; i < obj.length; i++) {
          if (!(i in obj)) throw new TypeError(`Analysis identity contains a sparse array at ${path}[${i}]`);
          items.push(encode(obj[i], `${path}[${i}]`));
        }
        return `[${items.join(',')}]`;
      }
      const proto = Object.getPrototypeOf(obj);
      if (proto !== Object.prototype && proto !== null) {
        throw new TypeError(`Analysis identity requires plain JSON objects at ${path}`);
      }
      const record = obj as Record<string, unknown>;
      const fields: string[] = [];
      for (const key of Object.keys(record).sort()) {
        if (record[key] === undefined) continue;
        fields.push(`${JSON.stringify(key)}:${encode(record[key], `${path}.${key}`)}`);
      }
      return `{${fields.join(',')}}`;
    } finally {
      active.delete(obj);
    }
  }

  return encode(value, '$');
}
