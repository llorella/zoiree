import { join } from "node:path";
import { loadConfig } from "../src/config";
import { signEnvelope } from "../src/crypto";
import { deliverEnvelopeOrQueue } from "../src/delivery";
import { originFromUrl, resolveHandleBaseUrl } from "../src/handle";
import { resolveEnvelopeId } from "../src/inbox";
import { FederationStore } from "../src/store";
import type {
  FederationEnvelope,
  OutboxEntry,
  UnsignedEnvelope,
} from "../src/types";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = Bun.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = Bun.argv.indexOf(`--${name}`);
  if (index >= 0) return Bun.argv[index + 1];
  return undefined;
}

const inputId = arg("invite-id");
if (!inputId) {
  console.error("Usage: bun run decline-invite -- --invite-id msg_... | inbox_... [--url https://peer]");
  process.exit(1);
}

const config = loadConfig();
if (!config.privateKey) {
  console.error("ZOIREE_PRIVATE_KEY is required");
  process.exit(1);
}

const store = new FederationStore(config.dataDir);
await store.init();

const inviteId = await resolveEnvelopeId(store, inputId);
if (!inviteId) {
  console.error(`Invite not found: ${inputId}`);
  process.exit(1);
}

const invites = await store.readJsonl<FederationEnvelope>(
  join(config.dataDir, "invites.jsonl"),
);
const invite = invites.find(
  (entry) => entry.id === inviteId && entry.kind === "party_invite",
);
if (!invite) {
  console.error(`Invite not found: ${inputId}`);
  process.exit(1);
}
const declinedInvite = invite;

const partyId = declinedInvite.party_id ?? declinedInvite.body.party?.party_id;
if (!partyId) {
  console.error(`Invite ${inviteId} is missing party_id`);
  process.exit(1);
}

const peer = await store.getPeer(declinedInvite.from);
const baseUrl = (
  arg("url") ??
  peer?.base_url ??
  resolveHandleBaseUrl(declinedInvite.from, config.peerMap)
).replace(/\/$/, "");
const path = "/api/federation/invite";
const now = new Date().toISOString();
const unsigned: UnsignedEnvelope = {
  id: `msg_${crypto.randomUUID()}`,
  kind: "party_decline",
  from: config.handle,
  to: declinedInvite.from,
  party_id: partyId,
  sent_at: now,
  body: {
    text: "Declined party invite.",
    attachments: [],
  },
};
const envelope: FederationEnvelope = {
  ...unsigned,
  signature: signEnvelope(
    unsigned,
    {
      method: "POST",
      path,
      recipient_origin: originFromUrl(baseUrl),
    },
    config.privateKey,
  ),
};

await store.markSeen(envelope.id, envelope);
await store.appendInvite(envelope);
await markInviteInboxActed();

const entry: OutboxEntry = {
  id: envelope.id,
  url: `${baseUrl}${path}`,
  method: "POST",
  path,
  envelope,
  created_at: now,
};
const result = await deliverEnvelopeOrQueue(store, entry);
console.log(result.status ? `${result.status} ${result.statusText ?? ""}` : "0 DELIVERY_FAILED");
if (result.body) console.log(result.body);
if (!result.ok) {
  if (result.error && !result.body) console.error(result.error);
  console.error(`Queued decline in ${config.dataDir}/outbox.jsonl`);
  process.exit(1);
}

async function markInviteInboxActed(): Promise<void> {
  const inbox = await store.inboxItems();
  const item = inbox.find((entry) => entry.envelope_id === declinedInvite.id);
  await store.appendInboxAction({
    id: `act_${crypto.randomUUID()}`,
    ...(item ? { inbox_id: item.id } : {}),
    envelope_id: declinedInvite.id,
    action: "decline",
    acted_at: new Date().toISOString(),
    result: envelope.id,
  });
}
