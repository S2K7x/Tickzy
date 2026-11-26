import type { IncomingHttpHeaders } from "node:http";
import type { InboundChannelKind, Tx } from "@tickzy/db";

/**
 * Inbound side of the channel adapter contract (ADR-012, ADR-032). Every provider webhook goes through the same
 * pipeline (`routes.ts`): verify the signature on the RAW body → parse → route to a workspace through a server-side
 * mapping → persist (deduplicated) → acknowledge → process asynchronously in the worker (`processor.ts`).
 * Channels implement only what is provider-specific.
 */
export interface InboundRequest {
  raw: Buffer;
  headers: IncomingHttpHeaders;
  /** Epoch ms, injectable for tests (timestamp windows). */
  now: number;
}

/** Where an event belongs: by the provider tenant (Slack team) or by an endpoint address (email, widget key). */
export type InboundRoute =
  | { by: "connection"; externalTenantId: string }
  | { by: "endpoint"; endpointKind: "email_address" | "widget"; externalId: string };

export type ParsedInbound =
  /** Provider handshake answered directly, after verification (e.g. Slack url_verification). */
  | { kind: "respond"; status: number; body: unknown }
  /** Verified but nothing to store (event types we do not handle). */
  | { kind: "ignore"; reason: string }
  | { kind: "event"; eventId: string; route: InboundRoute; payload: unknown };

/** A persisted inbound event as the processor hands it to its channel. */
export interface StoredInboundEvent {
  id: string;
  workspaceId: string;
  connectionId: string | null;
  endpointId: string | null;
  providerEventId: string;
  payload: unknown;
}

export interface InboundChannel {
  readonly kind: InboundChannelKind;
  /** Largest request body accepted (checked before anything is read further). */
  readonly maxBodyBytes: number;
  /**
   * Authenticity of the request, checked BEFORE parsing (threat model §6.1): signature over the raw body with a
   * constant-time comparison, and a freshness window where the provider sends a timestamp.
   */
  verify(req: InboundRequest): boolean;
  /** Parses a verified body; throws on malformed input (→ 400). Must not trust tenant ids for routing beyond `route`. */
  parse(req: InboundRequest): ParsedInbound;
  /** Turns a stored event into messages/issues (inside the event's tenant transaction). Must be idempotent. */
  process(tx: Tx, event: StoredInboundEvent): Promise<"processed" | "ignored">;
}

export interface IngestRegistry {
  channels(): InboundChannel[];
  get(kind: string): InboundChannel | null;
}

export function createIngestRegistry(channels: InboundChannel[] = []): IngestRegistry {
  const byKind = new Map<string, InboundChannel>();
  for (const c of channels) {
    if (byKind.has(c.kind)) throw new Error(`two inbound channels for ${c.kind}`);
    byKind.set(c.kind, c);
  }
  return { channels: () => [...byKind.values()], get: (kind) => byKind.get(kind) ?? null };
}
