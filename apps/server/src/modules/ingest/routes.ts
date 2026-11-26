import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { sql } from "drizzle-orm";
import { AppError, newId } from "@tickzy/shared";
import { schema, withWorkspace, type Db } from "@tickzy/db";
import { apply as applyRateLimit, type RateLimitStore } from "../../http/rate-limit.ts";
import type { InboundChannel, InboundRoute, IngestRegistry } from "./channel.ts";

/**
 * Provider webhooks: `POST /ingest/{channel}` (T-301, ADR-032, threat model §6.1). Order matters:
 * 1. body read as raw bytes with the channel's size limit; 2. signature verified on those bytes BEFORE parsing;
 * 3. parsed; 4. tenant resolved through a server-side mapping (never from fields the sender controls);
 * 5. per-workspace budget; 6. persisted with dedupe on the provider's event id + outbox event, one transaction;
 * 7. acknowledged. Processing happens in the worker, so the provider gets its answer in milliseconds.
 */
export function ingestRoutes(db: Db, registry: IngestRegistry, opts: { store: RateLimitStore; perWorkspacePerMin: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  return async function routes(app: FastifyInstance): Promise<void> {
    // Raw bodies for this plugin only: signatures are computed over the exact bytes received.
    app.removeAllContentTypeParsers();
    app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    for (const channel of registry.channels()) {
      app.post(`/ingest/${channel.kind}`, { bodyLimit: channel.maxBodyBytes, schema: { hide: true } }, (req, reply) => handle(channel, req, reply));
    }
  };

  async function handle(channel: InboundChannel, req: FastifyRequest, reply: FastifyReply) {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const request = { raw, headers: req.headers, now: now() };
    if (!channel.verify(request)) {
      req.log.warn({ channel: channel.kind }, "ingest: signature verification failed");
      throw new AppError("unauthenticated", "Invalid signature");
    }
    let parsed;
    try {
      parsed = channel.parse(request);
    } catch {
      throw new AppError("validation_failed", "Malformed payload");
    }
    if (parsed.kind === "respond") return reply.code(parsed.status).send(parsed.body);
    if (parsed.kind === "ignore") return { ok: true };

    const route = await resolve(parsed.route, channel.kind);
    if (!route) {
      // Acknowledge (providers would otherwise retry forever) but keep nothing: no tenant claims this event.
      req.log.info({ channel: channel.kind }, "ingest: no workspace for this event");
      return { ok: true };
    }
    const t = now();
    const budget = opts.store.hit(`ingest:${route.workspaceId}`, 60_000, t);
    applyRateLimit(reply, opts.perWorkspacePerMin, budget.count, budget.resetAt, t, "Too many events for this workspace; retry later");

    const stored = await withWorkspace(db, { workspaceId: route.workspaceId }, async (tx) => {
      const [row] = await tx.insert(schema.inboundEvents).values({
        id: newId("inboundEvent"), workspaceId: route.workspaceId, channel: channel.kind, connectionId: route.connectionId,
        endpointId: route.endpointId, providerEventId: parsed.eventId, payload: parsed.payload,
      }).onConflictDoNothing().returning({ id: schema.inboundEvents.id });
      if (row) await tx.insert(schema.outbox).values({ workspaceId: route.workspaceId, type: "inbound.received", payload: { inbound_event_id: row.id, channel: channel.kind } });
      return row ?? null;
    });
    return { ok: true, duplicate: stored === null };
  }

  async function resolve(route: InboundRoute, kind: string): Promise<{ workspaceId: string; connectionId: string | null; endpointId: string | null } | null> {
    const res = route.by === "connection"
      ? await db.execute(sql`SELECT workspace_id, connection_id, NULL::text AS endpoint_id FROM ingest_route_connection(${kind}, ${route.externalTenantId})`)
      : await db.execute(sql`SELECT workspace_id, connection_id, endpoint_id FROM ingest_route_endpoint(${route.endpointKind}, ${route.externalId})`);
    const r = res.rows[0] as { workspace_id: string; connection_id: string | null; endpoint_id: string | null } | undefined;
    return r ? { workspaceId: r.workspace_id, connectionId: r.connection_id, endpointId: r.endpoint_id } : null;
  }
}
