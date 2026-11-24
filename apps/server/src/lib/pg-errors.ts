/** Helpers for PostgreSQL errors surfaced through Drizzle (the driver error is the `cause`). */

/** Message text of the error and its cause, plus the violated constraint (for substring checks). */
export function pgMessage(err: unknown): string {
  const e = err as { message?: string; cause?: { message?: string; constraint?: string } };
  return `${e.message ?? ""} ${e.cause?.message ?? ""} ${e.cause?.constraint ?? ""}`;
}

/** True for a unique violation (23505), optionally of a specific constraint/index. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const cause = (err as { cause?: { code?: string; constraint?: string } }).cause ?? (err as { code?: string; constraint?: string });
  return cause?.code === "23505" && (constraint === undefined || cause.constraint === constraint);
}
