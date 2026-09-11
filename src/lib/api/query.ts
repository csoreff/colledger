/**
 * List-endpoint conventions: paging, and the envelope every collection is
 * returned in.
 *
 * Offset paging rather than cursors — these are one person's collection, in
 * the thousands of rows at most, and offsets let a seeding script say "give me
 * page 3" without holding state between calls.
 */
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

export type Paging = { limit: number; offset: number };

export function paging(request: Request): Paging {
  const params = new URL(request.url).searchParams;

  const rawLimit = Number(params.get("limit"));
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), MAX_LIMIT)
      : DEFAULT_LIMIT;

  const rawOffset = Number(params.get("offset"));
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

  return { limit, offset };
}

export type Page<T> = {
  data: T[];
  pagination: { limit: number; offset: number; total: number; hasMore: boolean };
};

export function page<T>(data: T[], total: number, { limit, offset }: Paging): Page<T> {
  return {
    data,
    pagination: { limit, offset, total, hasMore: offset + data.length < total },
  };
}

/** Reads a repeated or comma-separated query parameter into a list. */
export function listParam(request: Request, name: string): string[] {
  const params = new URL(request.url).searchParams;
  return params
    .getAll(name)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function stringParam(request: Request, name: string): string | null {
  const value = new URL(request.url).searchParams.get(name);
  return value?.trim() ? value.trim() : null;
}

export function boolParam(request: Request, name: string): boolean {
  const value = stringParam(request, name)?.toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
