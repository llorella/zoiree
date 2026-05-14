import { loadConfig } from "../src/config";
import { signRequestAuth, verifyEnvelopeSignature } from "../src/crypto";
import { originFromUrl } from "../src/handle";
import { getOrFetchPeer } from "../src/peers";
import { FederationStore } from "../src/store";
import type {
  FederationEnvelope,
  UnsignedRequestAuth,
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
const partyId = requiredArg("party");
const baseUrl = requiredArg("url").replace(/\/$/, "");
const since = arg("since");
const shouldImport = Bun.argv.includes("--import");

const query = since ? `?since=${encodeURIComponent(since)}` : "";
const path = `/api/federation/party/${encodeURIComponent(partyId)}/messages${query}`;
const auth: UnsignedRequestAuth = {
  id: `req_${crypto.randomUUID()}`,
  from: config.handle,
  to,
  sent_at: new Date().toISOString(),
};
const signature = signRequestAuth(
  auth,
  {
    method: "GET",
    path,
    recipient_origin: originFromUrl(baseUrl),
  },
  config.privateKey,
);

const response = await fetch(`${baseUrl}${path}`, {
  headers: {
    accept: "application/json",
    "x-zoiree-id": auth.id,
    "x-zoiree-from": auth.from,
    "x-zoiree-to": auth.to,
    "x-zoiree-sent-at": auth.sent_at,
    "x-zoiree-signature": signature,
  },
});

console.log(`${response.status} ${response.statusText}`);
const text = await response.text();
console.log(text);
if (!response.ok) process.exit(1);

if (shouldImport) {
  const payload = JSON.parse(text) as { messages?: FederationEnvelope[] };
  const store = new FederationStore(config.dataDir);
  await store.init();
  let imported = 0;

  for (const message of payload.messages ?? []) {
    if (message.to.toLowerCase() !== config.handle.toLowerCase()) continue;
    if (!message.party_id) continue;
    if (await store.hasSeen(message.id)) continue;

    const peer = await getOrFetchPeer(message.from, store, config);
    const valid = verifyEnvelopeSignature(
      message,
      {
        method: "POST",
        path: `/api/federation/party/${encodeURIComponent(message.party_id)}`,
        recipient_origin: originFromUrl(config.baseUrl ?? requiredArg("base-url")),
      },
      peer.public_key,
    );
    if (!valid) continue;

    await store.markSeen(message.id, message);
    await store.appendMessage(message);
    imported += 1;
  }

  console.error(`Imported ${imported} message(s)`);
}
