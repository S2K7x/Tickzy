import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { AppError, newId } from "@tickzy/shared";
import { schema, withWorkspace, type Db } from "@tickzy/db";
import type { MemberContext } from "../../http/auth.ts";

/** Labels and teams: the workspace taxonomy used to classify and route issues (FR-3.3). Archived entries are hidden. */
export interface LabelDto { id: string; name: string; color: string; description: string | null; parent_id: string | null }
export interface TeamDto { id: string; name: string }

/** A pleasant, readable default palette for labels created without a colour (picked by name, so it is stable). */
const PALETTE = ["#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0d9488", "#0891b2", "#6b7280"] as const;
export const defaultLabelColor = (name: string) => PALETTE[[...name.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length]!;

const toLabel = (l: typeof schema.labels.$inferSelect): LabelDto => ({ id: l.id, name: l.name, color: l.color, description: l.description, parent_id: l.parentId });

export function createTaxonomyService(db: Db) {
  return {
    listLabels: (ctx: MemberContext) => withWorkspace(db, ctx, async (tx) => ({
      data: (await tx.select().from(schema.labels).where(isNull(schema.labels.archivedAt)).orderBy(asc(sql`lower(${schema.labels.name})`), asc(schema.labels.id))).map(toLabel),
    })),

    /** Creates a top-level label. Names are unique per workspace (case-insensitive) among active labels. */
    createLabel: (ctx: MemberContext, input: { name: string; color?: string | undefined; description?: string | null | undefined }) => withWorkspace(db, ctx, async (tx) => {
      const name = input.name.trim().replace(/\s+/g, " ");
      const [row] = await tx.insert(schema.labels).values({
        id: newId("label"), workspaceId: ctx.workspaceId, name, color: (input.color ?? defaultLabelColor(name)).toLowerCase(), description: input.description ?? null,
      }).onConflictDoNothing().returning();
      if (!row) {
        const [existing] = await tx.select({ id: schema.labels.id }).from(schema.labels)
          .where(and(isNull(schema.labels.archivedAt), isNull(schema.labels.parentId), eq(sql`lower(${schema.labels.name})`, name.toLowerCase())));
        throw new AppError("conflict", `A label named "${name}" already exists`, existing ? [{ path: "name", issue: `exists as ${existing.id}` }] : undefined);
      }
      return toLabel(row);
    }),

    listTeams: (ctx: MemberContext) => withWorkspace(db, ctx, async (tx) => ({
      data: (await tx.select({ id: schema.teams.id, name: schema.teams.name }).from(schema.teams).where(isNull(schema.teams.archivedAt)).orderBy(asc(sql`lower(${schema.teams.name})`), asc(schema.teams.id))) as TeamDto[],
    })),
  };
}
