import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import type { WebSocket } from "ws";
import { and, eq } from "drizzle-orm";
import { isId } from "@tickzy/shared";
import { schema, withUser, withWorkspace, type Db } from "@tickzy/db";
import type { AuthService } from "../auth/service.ts";

/**
 * Realtime gateway (T-208, FR-3.9; architecture §6): WebSocket `/v1/realtime`.
 * Client → server: {op:"sub"|"unsub", topic} · {op:"presence", issue_id, state:"viewing"|"typing"|"left"} · {op:"ping"}.
 * Server → client: {op:"subscribed"|"error", …} · {op:"event", topic, type, issue_id, message_id} (ids only: the client
 * refetches through the API, so RLS stays the single gate for data) · {op:"presence", issue_id, viewers:[…]} · {op:"pong"}.
 * Topics: `workspace:{ws}:inbox` (needs active membership), `issue:{id}` (issue must belong to a subscribed workspace).
 * Fan-out across nodes: Postgres NOTIFY `tz_events` (migration 0011). Presence is in-memory per node (Redis when there
 * is more than one API node — ADR-008).
 */
export interface GatewayOptions {
  db: Db;
  pool: pg.Pool;
  sessions: Pick<AuthService, "validateSession">;
  allowedOrigins: string[];
  log: (msg: string, err?: unknown) => void;
  /** Revalidation (session + memberships) and stale-presence sweep interval. */
  sweepMs?: number;
}

type PresenceState = "viewing" | "typing";
interface Conn {
  id: number;
  socket: WebSocket;
  userId: string;
  name: string;
  sessionToken: string | null;
  workspaces: Set<string>;               // authorised `workspace:{ws}:inbox` subscriptions
  issues: Map<string, string>;           // issue id → workspace id
  presence: Map<string, { state: PresenceState; at: number }>;
  window: { start: number; count: number };
  /** Messages are handled strictly in order (a sub for an issue relies on the workspace sub before it). */
  queue: Promise<void>;
}

const MAX_SUBS = 50;
const MAX_MSG_BYTES = 4096;
const MAX_MSGS_PER_SEC = 20;
const PRESENCE_TTL_MS = 60_000;

export function realtimeGateway(opts: GatewayOptions) {
  const conns = new Map<number, Conn>();
  let nextId = 1;
  let listener: pg.PoolClient | null = null;
  let sweeper: NodeJS.Timeout | null = null;
  let stopped = false;
  const allowed = new Set(opts.allowedOrigins);

  const send = (c: Conn, msg: unknown) => { if (c.socket.readyState === 1) c.socket.send(JSON.stringify(msg)); };

  /** One entry per person on an issue; "typing" wins over "viewing" across their tabs. */
  function viewersOf(issueId: string) {
    const byUser = new Map<string, { user_id: string; name: string; state: PresenceState }>();
    for (const c of conns.values()) {
      const p = c.presence.get(issueId);
      if (!p) continue;
      const prev = byUser.get(c.userId);
      if (!prev || p.state === "typing") byUser.set(c.userId, { user_id: c.userId, name: c.name, state: p.state });
    }
    return [...byUser.values()];
  }
  function broadcastPresence(issueId: string) {
    const viewers = viewersOf(issueId);
    for (const c of conns.values()) if (c.issues.has(issueId)) send(c, { op: "presence", issue_id: issueId, viewers });
  }

  async function activeMember(userId: string, ws: string): Promise<boolean> {
    if (!isId(ws, "workspace")) return false;
    const rows = await withWorkspace(opts.db, { workspaceId: ws, userId }, (tx) =>
      tx.select({ id: schema.memberships.id }).from(schema.memberships)
        .where(and(eq(schema.memberships.userId, userId), eq(schema.memberships.status, "active"))));
    return rows.length > 0;
  }

  async function subscribe(c: Conn, topic: string) {
    if (c.workspaces.size + c.issues.size >= MAX_SUBS) return send(c, { op: "error", topic, error: "too_many_subscriptions" });
    const w = /^workspace:([\w]+):inbox$/.exec(topic);
    if (w) {
      if (!(await activeMember(c.userId, w[1]!))) return send(c, { op: "error", topic, error: "forbidden" });
      c.workspaces.add(w[1]!);
      return send(c, { op: "subscribed", topic });
    }
    const i = /^issue:(iss_[0-9A-HJKMNP-TV-Z]{26})$/.exec(topic);
    if (i) {
      for (const ws of c.workspaces) {
        const found = await withWorkspace(opts.db, { workspaceId: ws, userId: c.userId }, (tx) =>
          tx.select({ id: schema.issues.id }).from(schema.issues).where(eq(schema.issues.id, i[1]!)));
        if (found.length) {
          c.issues.set(i[1]!, ws);
          send(c, { op: "subscribed", topic });
          return send(c, { op: "presence", issue_id: i[1], viewers: viewersOf(i[1]!) });
        }
      }
      return send(c, { op: "error", topic, error: "forbidden" });
    }
    send(c, { op: "error", topic, error: "unknown_topic" });
  }

  function unsubscribe(c: Conn, topic: string) {
    const w = /^workspace:([\w]+):inbox$/.exec(topic);
    if (w) {
      c.workspaces.delete(w[1]!);
      for (const [issue, ws] of c.issues) if (ws === w[1]) c.issues.delete(issue);
    }
    const i = /^issue:(\S+)$/.exec(topic);
    if (i && c.issues.delete(i[1]!) && c.presence.delete(i[1]!)) broadcastPresence(i[1]!);
  }

  /** Rate and size limits apply on receipt (before queueing), so a flood cannot build an unbounded backlog. */
  function receive(c: Conn, raw: Buffer) {
    const now = Date.now();
    if (now - c.window.start > 1000) c.window = { start: now, count: 0 };
    if (++c.window.count > MAX_MSGS_PER_SEC) return c.socket.close(1008, "rate limit");
    if (raw.length > MAX_MSG_BYTES) return c.socket.close(1009, "message too big");
    c.queue = c.queue.then(() => onMessage(c, raw)).catch((err) => opts.log("realtime message failed", err));
  }

  async function onMessage(c: Conn, raw: Buffer) {
    const now = Date.now();
    let msg: { op?: unknown; topic?: unknown; issue_id?: unknown; state?: unknown };
    try { msg = JSON.parse(raw.toString("utf8")); } catch { return send(c, { op: "error", error: "bad_json" }); }
    if (msg.op === "ping") return send(c, { op: "pong" });
    if ((msg.op === "sub" || msg.op === "unsub") && typeof msg.topic === "string" && msg.topic.length <= 100) {
      return msg.op === "sub" ? subscribe(c, msg.topic) : unsubscribe(c, msg.topic);
    }
    if (msg.op === "presence" && typeof msg.issue_id === "string" && c.issues.has(msg.issue_id)) {
      if (msg.state === "left") c.presence.delete(msg.issue_id);
      else if (msg.state === "viewing" || msg.state === "typing") c.presence.set(msg.issue_id, { state: msg.state, at: now });
      else return send(c, { op: "error", error: "bad_state" });
      return broadcastPresence(msg.issue_id);
    }
    send(c, { op: "error", error: "bad_message" });
  }

  function onEvent(payload: string) {
    let e: { w?: string; t?: string; i?: string | null; m?: string | null };
    try { e = JSON.parse(payload); } catch { return; }
    if (!e.w || !e.t) return;
    for (const c of conns.values()) {
      if (c.workspaces.has(e.w)) send(c, { op: "event", topic: `workspace:${e.w}:inbox`, type: e.t, issue_id: e.i ?? null, message_id: e.m ?? null });
      if (e.i && c.issues.get(e.i) === e.w) send(c, { op: "event", topic: `issue:${e.i}`, type: e.t, issue_id: e.i, message_id: e.m ?? null });
    }
  }

  async function listen() {
    if (stopped) return;
    try {
      listener = await opts.pool.connect();
      listener.on("notification", (n) => { if (n.channel === "tz_events" && n.payload) onEvent(n.payload); });
      listener.on("error", (err) => { opts.log("realtime listener error", err); reconnect(); });
      await listener.query("LISTEN tz_events");
    } catch (err) {
      opts.log("realtime LISTEN failed", err);
      reconnect();
    }
  }
  function reconnect() {
    const l = listener;
    listener = null;
    l?.release(true);
    if (!stopped) setTimeout(() => void listen(), 1000).unref();
  }

  /** Every sweep: drop stale presence, close sockets whose session ended, drop workspaces the user left. */
  async function sweep() {
    const now = Date.now();
    for (const c of conns.values()) {
      for (const [issue, p] of c.presence) if (now - p.at > PRESENCE_TTL_MS) { c.presence.delete(issue); broadcastPresence(issue); }
      try {
        if (c.sessionToken && !(await opts.sessions.validateSession(c.sessionToken))) { c.socket.close(4401, "session ended"); continue; }
        for (const ws of [...c.workspaces]) {
          if (!(await activeMember(c.userId, ws))) { unsubscribe(c, `workspace:${ws}:inbox`); send(c, { op: "error", topic: `workspace:${ws}:inbox`, error: "forbidden" }); }
        }
      } catch (err) { opts.log("realtime revalidation failed", err); }
    }
  }

  return {
    get connections() { return conns.size; },
    async register(app: FastifyInstance) {
      await listen();
      sweeper = setInterval(() => void sweep(), opts.sweepMs ?? 60_000);
      sweeper.unref();
      app.addHook("onClose", async () => {
        stopped = true;
        if (sweeper) clearInterval(sweeper);
        for (const c of conns.values()) c.socket.close(1001, "server shutting down");
        if (listener) { await listener.query("UNLISTEN tz_events").catch(() => undefined); listener.release(); listener = null; }
      });
      app.get("/v1/realtime", {
        websocket: true,
        schema: { hide: true },
        // Before the upgrade: authenticated user, and a browser Origin must be allow-listed (cross-site WebSocket hijacking).
        preValidation: async (req: FastifyRequest, reply) => {
          const origin = req.headers.origin;
          if (origin !== undefined && !allowed.has(origin)) return reply.code(403).send({ error: { code: "forbidden", message: "Origin not allowed", request_id: req.id } });
          if (!req.principal || req.principal.type !== "user") return reply.code(401).send({ error: { code: "unauthenticated", message: "Sign in to use realtime updates", request_id: req.id } });
        },
      }, (socket: WebSocket, req: FastifyRequest) => {
        // Attach listeners synchronously: messages that arrive while the connection initialises are buffered,
        // never dropped (a client may send `sub` right after `open`).
        const p = req.principal as { type: "user"; userId: string };
        let c: Conn | null = null;
        const early: Buffer[] = [];
        socket.on("message", (data: Buffer) => {
          if (!c) { if (early.length < MAX_MSGS_PER_SEC) early.push(data); return; }
          receive(c, data);
        });
        socket.on("close", () => {
          if (!c) return;
          conns.delete(c.id);
          for (const issue of c.presence.keys()) broadcastPresence(issue);
        });
        void (async () => {
          const [u] = await withUser(opts.db, p.userId, (tx) => tx.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, p.userId)));
          c = {
            id: nextId++, socket, userId: p.userId, name: u?.name || u?.email || "Teammate",
            sessionToken: req.cookies?.tz_session ?? null, workspaces: new Set(), issues: new Map(), presence: new Map(), window: { start: Date.now(), count: 0 }, queue: Promise.resolve(),
          };
          if (socket.readyState !== 1) return;
          conns.set(c.id, c);
          send(c, { op: "ready" });
          for (const data of early.splice(0)) receive(c, data);
        })().catch((err) => { opts.log("realtime connection setup failed", err); socket.close(1011, "setup failed"); });
      });
    },
    /** Test hook: run the revalidation sweep now. */
    sweepNow: sweep,
  };
}

declare module "fastify" {
  interface FastifyInstance {
    realtime: ReturnType<typeof realtimeGateway>;
  }
}
