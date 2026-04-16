const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(value: unknown): value is Record<string | symbol, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function deepMerge<T extends Record<string | symbol, unknown>>(
  target: T,
  source: Partial<T>
): T {
  const result: Record<string | symbol, unknown> = { ...target };

  const keys: (string | symbol)[] = [
    ...Object.keys(source),
    ...Object.getOwnPropertySymbols(source),
  ];

  for (const key of keys) {
    if (typeof key === "string" && FORBIDDEN_KEYS.has(key)) {
      continue;
    }

    const sourceVal = (source as Record<string | symbol, unknown>)[key];
    const targetVal = result[key];

    if (sourceVal === undefined) {
      continue;
    }

    if (sourceVal === null) {
      result[key] = null;
      continue;
    }

    if (sourceVal instanceof Date) {
      result[key] = new Date(sourceVal.getTime());
      continue;
    }

    if (Array.isArray(sourceVal)) {
      result[key] = [...sourceVal];
      continue;
    }

    if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      result[key] = deepMerge(
        targetVal as Record<string | symbol, unknown>,
        sourceVal as Record<string | symbol, unknown>
      );
      continue;
    }

    result[key] = sourceVal;
  }

  return result as T;
}
