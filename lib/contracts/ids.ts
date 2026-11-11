const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route params arrive as arbitrary strings; check before they reach a uuid column. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}
