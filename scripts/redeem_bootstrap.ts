import { loadConfig, publicIdentity } from "../src/config";
import { verifyEnvelopeSignature } from "../src/crypto";
import { originFromUrl } from "../src/handle";
import { describeUnreachable, fetchText } from "../src/http-client";
import { recordInboxItem } from "../src/inbox";
import { recordNotification } from "../src/notifications";
import { FederationStore } from "../src/store";
import type {
  BootstrapRedeemResponse,
  FederationEnvelope,
  PeerRecord,
} from "../src/types";
import { assertEnvelopeForLocalRecipient, assertTimestampFresh } from "../src/validation";

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
if (!config.baseUrl) {
  console.error("ZOIREE_BASE_URL is required to redeem bootstrap invites");
  process.exit(1);
}

const code = requiredArg("code");
const inviterUrl = requiredArg("url").replace(/\/$/, "");
const response = await fetchText(`${inviterUrl}/api/federation/bootstrap/redeem`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json",
  },
  body: JSON.stringify({
    code,
    identity: publicIdentity(config),
  }),
});

if (!response.reached) {
  console.error(
    describeUnreachable(
      "Alice's Zoiree service",
      inviterUrl,
      response.error,
    ),
  );
  console.error("Keep this invite code and retry redemption later.");
  process.exit(1);
}

console.log(`${response.status} ${response.statusText}`);
console.log(response.text);
if (!response.ok) process.exit(1);

const payload = JSON.parse(response.text) as BootstrapRedeemResponse;
const invite: FederationEnvelope = payload.invite;
assertEnvelopeForLocalRecipient(invite, config.handle);
assertTimestampFresh(invite.sent_at, config.maxClockSkewMs);

const valid = verifyEnvelopeSignature(
  invite,
  {
    method: "POST",
    path: "/api/federation/invite",
    recipient_origin: originFromUrl(config.baseUrl),
  },
  payload.inviter.public_key,
);
if (!valid) {
  console.error("Redeemed invite signature is invalid");
  process.exit(1);
}

const store = new FederationStore(config.dataDir);
await store.init();
const now = new Date().toISOString();
const peer: PeerRecord = {
  handle: payload.inviter.handle,
  ...(payload.inviter.base_url ? { base_url: payload.inviter.base_url } : {}),
  public_key: payload.inviter.public_key,
  created_at: payload.inviter.created_at,
  first_seen_at: now,
  last_seen_at: now,
};
await store.savePeer(peer);

if (await store.markSeen(invite.id, invite)) {
  await store.appendInvite(invite);
  await recordInboxItem(store, invite);
  await recordNotification(store, config, invite, "invite");
}

console.error(`Redeemed invite ${invite.id} from ${invite.from}`);
