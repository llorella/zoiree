import { HttpError } from "./http";
import { resolveHandleBaseUrl } from "./handle";
import type { AppConfig } from "./config";
import type { FederationStore } from "./store";
import type { PeerRecord, PublicIdentity } from "./types";

export async function getOrFetchPeer(
  handle: string,
  store: FederationStore,
  config: AppConfig,
): Promise<PeerRecord> {
  const cached = await store.getPeer(handle);
  if (cached) return cached;

  const baseUrl = resolveHandleBaseUrl(handle, config.peerMap);
  const response = await fetch(`${baseUrl}/api/federation/key`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new HttpError(401, `Could not fetch peer key for ${handle}`);
  }

  const identity = (await response.json()) as PublicIdentity;
  if (identity.handle.toLowerCase() !== handle.toLowerCase()) {
    throw new HttpError(401, "Peer key handle mismatch");
  }
  if (!identity.public_key) {
    throw new HttpError(401, "Peer key response missing public key");
  }

  const now = new Date().toISOString();
  const peer: PeerRecord = {
    handle: identity.handle,
    base_url: identity.base_url ?? baseUrl,
    public_key: identity.public_key,
    created_at: identity.created_at ?? now,
    first_seen_at: now,
    last_seen_at: now,
  };
  await store.savePeer(peer);
  return peer;
}
