import type { FederationStore } from "./store";
import type { FederationEnvelope, InboxItem } from "./types";

function preview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 240) return normalized;
  return `${normalized.slice(0, 237)}...`;
}

function suggestedActions(kind: FederationEnvelope["kind"]): string[] {
  if (kind === "party_invite") return ["accept", "decline"];
  if (kind === "user_message") return ["reply"];
  if (kind === "party_accept" || kind === "party_decline") return ["view"];
  if (kind === "party_leave") return ["view"];
  return ["view"];
}

export async function recordInboxItem(
  store: FederationStore,
  envelope: FederationEnvelope,
): Promise<void> {
  const item: InboxItem = {
    id: `inbox_${crypto.randomUUID()}`,
    envelope_id: envelope.id,
    kind: envelope.kind,
    from: envelope.from,
    ...(envelope.from_name ? { from_name: envelope.from_name } : {}),
    ...(envelope.party_id ? { party_id: envelope.party_id } : {}),
    text_preview: preview(envelope.body.text),
    received_at: new Date().toISOString(),
    status: "unread",
    suggested_actions: suggestedActions(envelope.kind),
  };
  await store.appendInbox(item);
}
