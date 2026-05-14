import type { FederationStore } from "./store";
import type { OutboxEntry } from "./types";

export interface DeliveryAttempt {
  ok: boolean;
  status?: number;
  statusText?: string;
  body?: string;
  error?: string;
}

export interface QueuedDeliveryAttempt extends DeliveryAttempt {
  queued: boolean;
}

export async function postEnvelope(
  entry: OutboxEntry,
  timeoutMs = 20_000,
): Promise<DeliveryAttempt> {
  try {
    const response = await fetch(entry.url, {
      method: entry.method,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(entry.envelope),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body,
      ...(response.ok ? {} : { error: body }),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function deliverEnvelopeOrQueue(
  store: FederationStore,
  entry: OutboxEntry,
): Promise<QueuedDeliveryAttempt> {
  const result = await postEnvelope(entry);
  if (result.ok) {
    return { ...result, queued: false };
  }

  await store.appendOutbox(entry);
  return { ...result, queued: true };
}
