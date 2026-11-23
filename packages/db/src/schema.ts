import { bigserial, bigint, customType, inet, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

const customBytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

// Mirrors migrations/*.sql (the SQL files are the source of truth; ADR-010 amendment).
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  issuePrefix: text("issue_prefix").notNull(),
  region: text("region", { enum: ["us", "eu"] }).notNull().default("us"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const ROLES = ["admin", "agent", "collaborator", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const memberships = pgTable("memberships", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role", { enum: ROLES }).notNull(),
  status: text("status", { enum: ["active", "deactivated"] }).notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const workspaceCounters = pgTable(
  "workspace_counters",
  {
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    value: bigint("value", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.name] })],
);

export const auditLog = pgTable("audit_log", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  actorType: text("actor_type", { enum: ["user", "api_token", "system", "ai"] }).notNull(),
  actorId: text("actor_id"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  ip: inet("ip"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const outbox = pgTable("outbox", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  type: text("type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  publishedAt: ts("published_at"),
});

export const invitations = pgTable("invitations", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  email: text("email").notNull(),
  role: text("role", { enum: ROLES }).notNull(),
  tokenId: text("token_id").notNull(),
  secretHash: customBytea("secret_hash").notNull(),
  invitedBy: text("invited_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  acceptedAt: ts("accepted_at"),
  acceptedBy: text("accepted_by"),
  revokedAt: ts("revoked_at"),
});

export const apiTokens = pgTable("api_tokens", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  tokenId: text("token_id").notNull(),
  secretHash: customBytea("secret_hash").notNull(),
  scopes: text("scopes").array().notNull(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
