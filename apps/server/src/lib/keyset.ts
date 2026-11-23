import { and, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { AppError } from "@tickzy/shared";

/**
 * Keyset pagination over an ordered list of columns that may mix directions (e.g. priority rank ASC, id DESC).
 * The cursor is the sort key of the last row: base64url JSON array. `after` builds
 *   (c1 > v1) OR (c1 = v1 AND c2 < v2) OR …   (per column direction)
 */
export interface KeyColumn {
  expr: SQLWrapper;
  dir: "asc" | "desc";
}

export function encodeKeyset(values: (string | number)[]): string {
  return Buffer.from(JSON.stringify(values)).toString("base64url");
}

export function decodeKeyset(cursor: string | undefined, arity: number): (string | number)[] | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (Array.isArray(v) && v.length === arity && v.every((x) => typeof x === "string" || typeof x === "number")) return v as (string | number)[];
  } catch { /* fall through */ }
  throw new AppError("validation_failed", "Invalid cursor", [{ path: "cursor", issue: "invalid" }]);
}

export function after(columns: KeyColumn[], values: (string | number)[]): SQL {
  const branches: SQL[] = [];
  for (let i = 0; i < columns.length; i++) {
    // Plain bound parameters (not column-typed): the cursor holds exact database text, e.g. a microsecond timestamp.
    const equal = columns.slice(0, i).map((c, j) => sql`${c.expr} = ${values[j]}`);
    const col = columns[i]!;
    const beyond = col.dir === "asc" ? sql`${col.expr} > ${values[i]}` : sql`${col.expr} < ${values[i]}`;
    branches.push(and(...equal, beyond)!);
  }
  return or(...branches)!;
}
