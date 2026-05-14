import type { AppConfig } from "./config";
import type { FederationStore } from "./store";
import type { FederationEnvelope, NotificationEvent } from "./types";

function preview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 240) return normalized;
  return `${normalized.slice(0, 237)}...`;
}

export async function recordNotification(
  store: FederationStore,
  config: AppConfig,
  envelope: FederationEnvelope,
  reason: NotificationEvent["reason"],
): Promise<void> {
  const event: NotificationEvent = {
    id: `notif_${crypto.randomUUID()}`,
    envelope_id: envelope.id,
    kind: envelope.kind,
    from: envelope.from,
    ...(envelope.from_name ? { from_name: envelope.from_name } : {}),
    ...(envelope.party_id ? { party_id: envelope.party_id } : {}),
    text_preview: preview(envelope.body.text),
    received_at: new Date().toISOString(),
    reason,
  };

  await store.appendNotification(event);

  const webhookUrl = Bun.env.ZOIREE_NOTIFICATION_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...event,
        local_handle: config.handle,
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    await store.appendJsonl(`${config.dataDir}/notification_errors.jsonl`, {
      notification_id: event.id,
      envelope_id: envelope.id,
      error: error instanceof Error ? error.message : String(error),
      failed_at: new Date().toISOString(),
    });
  }
}
