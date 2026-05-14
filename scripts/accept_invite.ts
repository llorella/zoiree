import { join } from "node:path";
import { loadConfig } from "../src/config";
import { signEnvelope } from "../src/crypto";
import { originFromUrl, resolveHandleBaseUrl } from "../src/handle";
import { FederationStore } from "../src/store";
import type {
  FederationEnvelope,
  OutboxEntry,
  PartyRecord,
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

const inviteId = arg("invite-id");
if (!inviteId) {
  console.error("Usage: bun run scripts/accept_invite.ts --invite-id msg_... [--url https://peer]");
  process.exit(1);
}

const config = loadConfig();
if (!config.privateKey) {
  console.error("ZOIREE_PRIVATE_KEY is required");
  process.exit(1);
}

const store = new FederationStore(config.dataDir);
await store.init();

const invites = await store.readJsonl<FederationEnvelope>(
  join(config.dataDir, "invites.jsonl"),
);
const invite = invites.find(
  (entry) => entry.id === inviteId && entry.kind === "party_invite",
);
if (!invite) {
  console.error(`Invite not found: ${inviteId}`);
  process.exit(1);
}
const acceptedInvite = invite;

const partyId = acceptedInvite.party_id ?? acceptedInvite.body.party?.party_id;
if (!partyId) {
  console.error(`Invite ${inviteId} is missing party_id`);
  process.exit(1);
}

const now = new Date().toISOString();
const party: PartyRecord = {
  party_id: partyId,
  members: acceptedInvite.body.party?.members ?? [acceptedInvite.from, config.handle],
  created_at: acceptedInvite.body.party?.created_at ?? acceptedInvite.sent_at,
  created_by: acceptedInvite.body.party?.created_by ?? acceptedInvite.from,
  status: "active",
  updated_at: now,
};
await store.saveParty(party);

const peer = await store.getPeer(acceptedInvite.from);
const baseUrl = (
  arg("url") ??
  peer?.base_url ??
  resolveHandleBaseUrl(acceptedInvite.from, config.peerMap)
).replace(/\/$/, "");
const path = "/api/federation/invite";
const unsigned: UnsignedEnvelope = {
  id: `msg_${crypto.randomUUID()}`,
  kind: "party_accept",
  from: config.handle,
  to: acceptedInvite.from,
  party_id: partyId,
  sent_at: now,
  body: {
    text: "Accepted party invite.",
    attachments: [],
    party,
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

const response = await fetch(`${baseUrl}${path}`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json",
  },
  body: JSON.stringify(envelope),
});
const body = await response.text();
console.log(`${response.status} ${response.statusText}`);
console.log(body);

if (!response.ok) {
  const entry: OutboxEntry = {
    id: envelope.id,
    url: `${baseUrl}${path}`,
    method: "POST",
    path,
    envelope,
    created_at: now,
  };
  await store.appendOutbox(entry);
  console.error(`Queued accept in ${config.dataDir}/outbox.jsonl`);
  process.exit(1);
}

async function markInviteInboxActed(): Promise<void> {
  const inbox = await store.inboxItems();
  const item = inbox.find((entry) => entry.envelope_id === acceptedInvite.id);
  await store.appendInboxAction({
    id: `act_${crypto.randomUUID()}`,
    ...(item ? { inbox_id: item.id } : {}),
    envelope_id: acceptedInvite.id,
    action: "accept",
    acted_at: new Date().toISOString(),
    result: envelope.id,
  });
}
