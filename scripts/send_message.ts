import { loadConfig } from "../src/config";
import { signEnvelope } from "../src/crypto";
import { deliverEnvelopeOrQueue } from "../src/delivery";
import { originFromUrl } from "../src/handle";
import { FederationStore } from "../src/store";
import type {
  FederationEnvelope,
  MessageKind,
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

function requiredArg(name: string): string {
  const value = arg(name);
  if (!value) {
    console.error(`Missing --${name}`);
    process.exit(1);
  }
  return value;
}

const config = loadConfig();
if (!config.privateKey) {
  console.error("ZOIREE_PRIVATE_KEY is required");
  process.exit(1);
}

const to = requiredArg("to");
const baseUrl = requiredArg("url").replace(/\/$/, "");
const kind = (arg("kind") ?? "user_message") as MessageKind;
const text = arg("text") ?? "";
const partyId =
  arg("party") ??
  (kind === "party_invite" ? `party_${crypto.randomUUID()}` : undefined);
const fromName = arg("from-name");

const path =
  kind === "party_invite" ||
  kind === "party_accept" ||
  kind === "party_decline"
    ? "/api/federation/invite"
    : `/api/federation/party/${encodeURIComponent(requiredArg("party"))}`;

const url = `${baseUrl}${path}`;
const now = new Date().toISOString();
const unsigned: UnsignedEnvelope = {
  id: `msg_${crypto.randomUUID()}`,
  kind,
  from: config.handle,
  ...(fromName ? { from_name: fromName } : {}),
  to,
  ...(partyId ? { party_id: partyId } : {}),
  sent_at: now,
  body: {
    text,
    attachments: [],
    ...(partyId &&
    (kind === "party_invite" || kind === "party_accept")
      ? {
          party: {
            party_id: partyId,
            members: [config.handle, to],
            created_at: now,
            created_by: config.handle,
          },
        }
      : {}),
  },
};

const signature = signEnvelope(
  unsigned,
  {
    method: "POST",
    path,
    recipient_origin: originFromUrl(baseUrl),
  },
  config.privateKey,
);
const envelope = { ...unsigned, signature };
const store = new FederationStore(config.dataDir);
await store.init();
await recordLocalOutbound(store, envelope);

const entry: OutboxEntry = {
  id: envelope.id,
  url,
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
  console.error(`Queued failed send in ${config.dataDir}/outbox.jsonl`);
  process.exit(1);
}

async function recordLocalOutbound(
  store: FederationStore,
  envelope: FederationEnvelope,
): Promise<void> {
  await store.markSeen(envelope.id, envelope);
  if (envelope.kind === "user_message" || envelope.kind === "party_leave") {
    await store.appendMessage(envelope);
    return;
  }
  await store.appendInvite(envelope);
}
