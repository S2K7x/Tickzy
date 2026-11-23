import { PRIORITIES, STATUS_CATEGORIES } from "@tickzy/shared";
import { bigserial, bigint, boolean, customType, inet, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

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

// --- Customers & taxonomy (migration 0007, T-201) ---------------------------------------------
export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  tier: text("tier"),
  ownerMembershipId: text("owner_membership_id"),
  externalIds: jsonb("external_ids").$type<Record<string, string>>().notNull().default({}),
  custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
});

export const accountDomains = pgTable("account_domains", {
  workspaceId: text("workspace_id").notNull(),
  domain: text("domain").notNull(),
  accountId: text("account_id").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.domain] })]);

export const contacts = pgTable("contacts", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  accountId: text("account_id"),
  accountSource: text("account_source", { enum: ["auto", "manual"] }).notNull().default("auto"),
  name: text("name").notNull().default(""),
  roleInAccount: text("role_in_account"),
  custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
});

export const IDENTITY_KINDS = ["email", "slack", "teams", "widget"] as const;
export const contactIdentities = pgTable("contact_identities", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  contactId: text("contact_id").notNull(),
  kind: text("kind", { enum: IDENTITY_KINDS }).notNull(),
  externalKey: text("external_key").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  assignmentStrategy: text("assignment_strategy", { enum: ["manual", "round_robin"] }).notNull().default("manual"),
  roundRobinCursor: text("round_robin_cursor"),
  createdAt: ts("created_at").notNull().defaultNow(),
  archivedAt: ts("archived_at"),
});

export const teamMembers = pgTable("team_members", {
  workspaceId: text("workspace_id").notNull(),
  teamId: text("team_id").notNull(),
  membershipId: text("membership_id").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.teamId, t.membershipId] })]);

export { STATUS_CATEGORIES, type StatusCategory } from "@tickzy/shared";
export const statuses = pgTable("statuses", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  category: text("category", { enum: STATUS_CATEGORIES }).notNull(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  archivedAt: ts("archived_at"),
});

export const labels = pgTable("labels", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6b7280"),
  description: text("description"),
  parentId: text("parent_id"),
  aiEnabled: boolean("ai_enabled").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
  archivedAt: ts("archived_at"),
});

export const CUSTOM_FIELD_ENTITIES = ["issue", "account", "contact"] as const;
export const CUSTOM_FIELD_TYPES = ["text", "number", "boolean", "date", "select", "multi_select", "url"] as const;
export const customFieldDefs = pgTable("custom_field_defs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  entity: text("entity", { enum: CUSTOM_FIELD_ENTITIES }).notNull(),
  key: text("key").notNull(),
  label: text("label").notNull(),
  type: text("type", { enum: CUSTOM_FIELD_TYPES }).notNull(),
  options: jsonb("options").$type<{ id: string; label: string }[]>().notNull().default([]),
  required: boolean("required").notNull().default(false),
  position: integer("position").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
  archivedAt: ts("archived_at"),
});

// --- Issues & messages (migration 0008, T-202) -------------------------------------------------
export const CHANNEL_KINDS = ["slack", "email", "widget", "api", "ui"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  channelKind: text("channel_kind", { enum: CHANNEL_KINDS }).notNull(),
  endpointId: text("endpoint_id"),
  externalThreadKey: text("external_thread_key"),
  lastMessageAt: ts("last_message_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const issues = pgTable("issues", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  number: integer("number").notNull(),
  title: text("title").notNull(),
  statusCategory: text("status_category", { enum: STATUS_CATEGORIES }).notNull(),
  statusId: text("status_id").notNull(),
  priority: text("priority", { enum: PRIORITIES }).notNull().default("normal"),
  assigneeMembershipId: text("assignee_membership_id"),
  teamId: text("team_id"),
  accountId: text("account_id"),
  requesterContactId: text("requester_contact_id"),
  channelKind: text("channel_kind", { enum: CHANNEL_KINDS }).notNull(),
  productArea: text("product_area"),
  custom: jsonb("custom").$type<Record<string, unknown>>().notNull().default({}),
  firstResponseAt: ts("first_response_at"),
  resolvedAt: ts("resolved_at"),
  closedAt: ts("closed_at"),
  lastCustomerMessageAt: ts("last_customer_message_at"),
  lastTeamMessageAt: ts("last_team_message_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
});

export const issueLabels = pgTable("issue_labels", {
  workspaceId: text("workspace_id").notNull(),
  issueId: text("issue_id").notNull(),
  labelId: text("label_id").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.issueId, t.labelId] })]);

export const messages = pgTable("messages", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  conversationId: text("conversation_id").notNull(),
  issueId: text("issue_id"),
  direction: text("direction", { enum: ["in", "out"] }).notNull(),
  visibility: text("visibility", { enum: ["public", "internal"] }).notNull(),
  authorType: text("author_type", { enum: ["contact", "member", "ai", "system"] }).notNull(),
  authorId: text("author_id"),
  bodyText: text("body_text").notNull().default(""),
  bodyAst: jsonb("body_ast"),
  source: text("source", { enum: CHANNEL_KINDS }).notNull(),
  externalId: text("external_id"),
  deliveryState: text("delivery_state", { enum: ["pending", "sent", "failed", "received"] }),
  createdAt: ts("created_at").notNull().defaultNow(),
  editedAt: ts("edited_at"),
  deletedAt: ts("deleted_at"),
});

export const attachments = pgTable("attachments", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  messageId: text("message_id").notNull(),
  objectKey: text("object_key").notNull(),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  size: bigint("size", { mode: "number" }).notNull(),
  scanState: text("scan_state", { enum: ["pending", "clean", "infected", "error"] }).notNull().default("pending"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const issueEvents = pgTable("issue_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  issueId: text("issue_id").notNull(),
  type: text("type").notNull(),
  actorType: text("actor_type", { enum: ["user", "api_token", "system", "ai", "contact"] }).notNull(),
  actorId: text("actor_id"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
});
