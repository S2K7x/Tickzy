import type { ChannelKind } from "@tickzy/db";

/**
 * Outbound delivery seam of the channel adapter contract (ADR-012: normalize / segment / deliver / sync / limits).
 * Only `deliver` exists until the first real channel (Slack, email — M3) brings the rest. A channel without an
 * adapter (api, ui) has nothing to deliver: its public messages are read through the API/app.
 */
export interface OutboundMessage {
  workspaceId: string;
  messageId: string;
  conversationId: string;
  /** Provider thread to reply into (Slack thread_ts, email root Message-ID); null for a new thread. */
  externalThreadKey: string | null;
  endpointId: string | null;
  bodyText: string;
  bodyAst: unknown;
}

export interface ChannelAdapter {
  readonly kind: ChannelKind;
  /** Sends one message. Must be safe to retry (the worker retries on errors); returns the provider's message id. */
  deliver(message: OutboundMessage): Promise<{ externalId: string }>;
}

export interface DeliveryRegistry {
  adapterFor(kind: ChannelKind): ChannelAdapter | null;
}

export function createDeliveryRegistry(adapters: ChannelAdapter[] = []): DeliveryRegistry {
  const byKind = new Map<ChannelKind, ChannelAdapter>();
  for (const a of adapters) {
    if (byKind.has(a.kind)) throw new Error(`two delivery adapters for ${a.kind}`);
    byKind.set(a.kind, a);
  }
  return { adapterFor: (kind) => byKind.get(kind) ?? null };
}
