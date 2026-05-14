function assertPlainJson(value: unknown): void {
  if (value === undefined) {
    throw new Error("Cannot canonicalize undefined");
  }
  if (typeof value === "function" || typeof value === "symbol") {
    throw new Error(`Cannot canonicalize ${typeof value}`);
  }
}

export function canonicalJson(value: unknown): string {
  assertPlainJson(value);

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();

  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
