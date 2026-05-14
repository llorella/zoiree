import type { AppConfig } from "./config";
import { verifyRequestSignature } from "./crypto";
import { candidateRecipientOrigins } from "./handle";
import { HttpError } from "./http";
import { getOrFetchPeer } from "./peers";
import type { FederationStore } from "./store";
import type { RequestBinding, SignedRequestAuth } from "./types";
import { assertTimestampFresh } from "./validation";

export function pathWithQuery(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

function requiredHeader(request: Request, name: string): string {
  const value = request.headers.get(name);
  if (!value) throw new HttpError(401, `${name} is required`);
  return value;
}

export function readSignedRequestAuth(request: Request): SignedRequestAuth {
  return {
    id: requiredHeader(request, "x-zoiree-id"),
    from: requiredHeader(request, "x-zoiree-from"),
    to: requiredHeader(request, "x-zoiree-to"),
    sent_at: requiredHeader(request, "x-zoiree-sent-at"),
    signature: requiredHeader(request, "x-zoiree-signature"),
  };
}

export async function verifySignedRequest(
  request: Request,
  store: FederationStore,
  config: AppConfig,
): Promise<SignedRequestAuth> {
  const auth = readSignedRequestAuth(request);
  if (auth.to.toLowerCase() !== config.handle.toLowerCase()) {
    throw new HttpError(400, "Signed request recipient does not match this Zoiree service");
  }
  assertTimestampFresh(auth.sent_at, config.maxClockSkewMs);

  const peer = await getOrFetchPeer(auth.from, store, config);
  const path = pathWithQuery(request);
  const origins = candidateRecipientOrigins(request, config.baseUrl);
  const ok = origins.some((recipientOrigin) => {
    const binding: RequestBinding = {
      method: request.method,
      path,
      recipient_origin: recipientOrigin,
    };
    return verifyRequestSignature(auth, binding, peer.public_key);
  });

  if (!ok) {
    throw new HttpError(401, "Invalid request signature");
  }

  return auth;
}
