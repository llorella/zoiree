import { publicIdentity, type AppConfig } from "./config";
import { signEnvelope, verifyEnvelopeSignature } from "./crypto";
import { candidateRecipientOrigins, originFromUrl } from "./handle";
import { HttpError, readJsonWithLimit } from "./http";
import { recordInboxItem } from "./inbox";
import { recordNotification } from "./notifications";
import { getOrFetchPeer } from "./peers";
import { verifySignedRequest } from "./request-auth";
import type { FederationStore } from "./store";
import type {
  BootstrapRedeemRequest,
  BootstrapRedeemResponse,
  FederationEnvelope,
  PartyRecord,
  PeerRecord,
  PublicIdentity,
  RequestBinding,
  UnsignedEnvelope,
} from "./types";
import {
  assertEnvelope,
  assertEnvelopeForLocalRecipient,
  assertInviteRouteKind,
  assertPartyRouteKind,
  assertTimestampFresh,
} from "./validation";

export async function parseAndVerifyInbound(
  request: Request,
  path: string,
  store: FederationStore,
  config: AppConfig,
): Promise<FederationEnvelope> {
  const envelope = await readJsonWithLimit<unknown>(
    request,
    config.maxPayloadBytes,
  );
  assertEnvelope(envelope);
  assertEnvelopeForLocalRecipient(envelope, config.handle);
  assertTimestampFresh(envelope.sent_at, config.maxClockSkewMs);

  const peer = await getOrFetchPeer(envelope.from, store, config);
  const origins = candidateRecipientOrigins(request, config.baseUrl);

  const ok = origins.some((recipientOrigin) => {
    const binding: RequestBinding = {
      method: request.method,
      path,
      recipient_origin: recipientOrigin,
    };
    return verifyEnvelopeSignature(envelope, binding, peer.public_key);
  });

  if (!ok) {
    throw new HttpError(401, "Invalid signature");
  }

  return envelope;
}

export async function handleKey(config: AppConfig): Promise<Response> {
  return Response.json(publicIdentity(config));
}

export async function handleInvite(
  request: Request,
  store: FederationStore,
  config: AppConfig,
): Promise<Response> {
  const envelope = await parseAndVerifyInbound(
    request,
    "/api/federation/invite",
    store,
    config,
  );
  assertInviteRouteKind(envelope.kind);

  const matchingInvite =
    envelope.kind === "party_accept" || envelope.kind === "party_decline"
      ? await requireMatchingOutboundInvite(envelope, store, config)
      : null;

  const fresh = await store.markSeen(envelope.id, envelope);
  if (!fresh) {
    return Response.json({ status: "duplicate", id: envelope.id }, { status: 200 });
  }

  await store.appendInvite(envelope);
  await recordInboxItem(store, envelope);

  if (envelope.kind === "party_accept") {
    await installPartyFromInvite(matchingInvite!, envelope, store, config);
  }
  await recordNotification(store, config, envelope, "invite");

  return Response.json(
    { status: "received", id: envelope.id, kind: envelope.kind },
    { status: 201 },
  );
}

export async function handleParty(
  request: Request,
  partyId: string,
  store: FederationStore,
  config: AppConfig,
): Promise<Response> {
  const path = `/api/federation/party/${encodeURIComponent(partyId)}`;
  const envelope = await parseAndVerifyInbound(request, path, store, config);
  assertPartyRouteKind(envelope.kind);

  if (envelope.party_id !== partyId) {
    throw new HttpError(400, "party_id mismatch");
  }

  const party = await store.getParty(partyId);
  if (!party || party.status !== "active") {
    throw new HttpError(404, "Unknown party");
  }
  if (!party.members.map((m) => m.toLowerCase()).includes(envelope.from.toLowerCase())) {
    throw new HttpError(403, "Sender is not a party member");
  }

  const fresh = await store.markSeen(envelope.id, envelope);
  if (!fresh) {
    return Response.json({ status: "duplicate", id: envelope.id }, { status: 200 });
  }

  await store.appendMessage(envelope);
  await recordInboxItem(store, envelope);
  await recordNotification(
    store,
    config,
    envelope,
    envelope.kind === "user_message" ? "message" : "control",
  );

  if (envelope.kind === "party_leave") {
    await store.saveParty({
      ...party,
      status: "left",
      updated_at: new Date().toISOString(),
    });
  }

  return Response.json(
    { status: "received", id: envelope.id, kind: envelope.kind },
    { status: 201 },
  );
}

export async function handleBootstrapRedeem(
  request: Request,
  store: FederationStore,
  config: AppConfig,
): Promise<Response> {
  if (!config.privateKey) {
    throw new HttpError(500, "ZOIREE_PRIVATE_KEY is required");
  }

  const payload = await readJsonWithLimit<BootstrapRedeemRequest>(
    request,
    config.maxPayloadBytes,
  );
  assertRedeemRequest(payload);

  const bootstrap = await store.getBootstrapInvite(payload.code);
  if (!bootstrap) {
    throw new HttpError(404, "Unknown invite code");
  }
  if (bootstrap.redeemed_at) {
    throw new HttpError(409, "Invite code already redeemed");
  }
  if (Date.parse(bootstrap.expires_at) <= Date.now()) {
    throw new HttpError(410, "Invite code expired");
  }
  if (
    bootstrap.to_handle &&
    !sameHandle(bootstrap.to_handle, payload.identity.handle)
  ) {
    throw new HttpError(403, "Invite code is not for this handle");
  }

  const now = new Date().toISOString();
  const peer: PeerRecord = {
    handle: payload.identity.handle,
    ...(payload.identity.base_url ? { base_url: payload.identity.base_url } : {}),
    public_key: payload.identity.public_key,
    created_at: payload.identity.created_at,
    first_seen_at: now,
    last_seen_at: now,
  };
  await store.savePeer(peer);

  const unsigned: UnsignedEnvelope = {
    id: `msg_${crypto.randomUUID()}`,
    kind: "party_invite",
    from: config.handle,
    ...(bootstrap.from_name ? { from_name: bootstrap.from_name } : {}),
    to: payload.identity.handle,
    party_id: bootstrap.party_id,
    sent_at: now,
    body: {
      text: bootstrap.text,
      attachments: [],
      party: {
        party_id: bootstrap.party_id,
        members: [config.handle, payload.identity.handle],
        created_at: bootstrap.created_at,
        created_by: config.handle,
      },
    },
  };

  const invite: FederationEnvelope = {
    ...unsigned,
    signature: signEnvelope(
      unsigned,
      {
        method: "POST",
        path: "/api/federation/invite",
        recipient_origin: originFromUrl(payload.identity.base_url!),
      },
      config.privateKey,
    ),
  };

  await store.appendInvite(invite);
  await store.markSeen(invite.id, invite);
  await store.saveBootstrapInvite({
    ...bootstrap,
    redeemed_at: now,
    redeemed_by: payload.identity.handle,
    redeemed_base_url: payload.identity.base_url,
    invite_id: invite.id,
  });

  const response: BootstrapRedeemResponse = {
    status: "redeemed",
    inviter: publicIdentity(config),
    invite,
  };
  return Response.json(response, { status: 201 });
}

export async function handlePartyMessages(
  request: Request,
  partyId: string,
  store: FederationStore,
  config: AppConfig,
): Promise<Response> {
  const auth = await verifySignedRequest(request, store, config);
  const party = await store.getParty(partyId);
  if (!party || party.status !== "active") {
    throw new HttpError(404, "Unknown party");
  }
  if (!party.members.map((m) => m.toLowerCase()).includes(auth.from.toLowerCase())) {
    throw new HttpError(403, "Requester is not a party member");
  }

  const since = new URL(request.url).searchParams.get("since");
  const messages = await store.messagesSince(partyId, since);
  return Response.json({
    party_id: partyId,
    since: since || null,
    messages,
  });
}

function assertRedeemRequest(
  payload: BootstrapRedeemRequest,
): asserts payload is BootstrapRedeemRequest {
  if (!payload || typeof payload !== "object") {
    throw new HttpError(400, "Request body must be an object");
  }
  if (typeof payload.code !== "string" || !payload.code) {
    throw new HttpError(400, "code is required");
  }
  const identity = (payload as { identity?: PublicIdentity }).identity;
  if (!identity || typeof identity !== "object") {
    throw new HttpError(400, "identity is required");
  }
  if (typeof identity.handle !== "string" || !identity.handle) {
    throw new HttpError(400, "identity.handle is required");
  }
  if (typeof identity.public_key !== "string" || !identity.public_key) {
    throw new HttpError(400, "identity.public_key is required");
  }
  if (typeof identity.base_url !== "string" || !identity.base_url) {
    throw new HttpError(400, "identity.base_url is required");
  }
  if (typeof identity.created_at !== "string" || !identity.created_at) {
    throw new HttpError(400, "identity.created_at is required");
  }
}

function partyIdOf(envelope: FederationEnvelope): string | undefined {
  return envelope.party_id ?? envelope.body.party?.party_id;
}

function sameHandle(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

async function requireMatchingOutboundInvite(
  response: FederationEnvelope,
  store: FederationStore,
  config: AppConfig,
): Promise<FederationEnvelope> {
  const partyId = partyIdOf(response);
  if (!partyId) {
    throw new HttpError(400, "party_id is required for invite responses");
  }

  const invites = await store.invites();
  const matching = invites.find((invite) => {
    const party = invite.body.party;
    if (invite.kind !== "party_invite") return false;
    if (!sameHandle(invite.from, config.handle)) return false;
    if (!sameHandle(invite.to, response.from)) return false;
    if (partyIdOf(invite) !== partyId) return false;
    if (!party) return false;

    const members = party.members.map((member) => member.toLowerCase());
    return (
      members.includes(config.handle.toLowerCase()) &&
      members.includes(response.from.toLowerCase())
    );
  });

  if (!matching) {
    throw new HttpError(403, "No matching outbound invite");
  }

  return matching;
}

async function installPartyFromInvite(
  invite: FederationEnvelope,
  acceptance: FederationEnvelope,
  store: FederationStore,
  config: AppConfig,
): Promise<void> {
  const party = invite.body.party;
  const partyId = partyIdOf(invite);
  if (!partyId) {
    throw new HttpError(400, "party_id is required to accept a party");
  }
  if (partyIdOf(acceptance) !== partyId) {
    throw new HttpError(400, "party_accept party_id mismatch");
  }

  const record: PartyRecord = {
    party_id: partyId,
    members: party?.members ?? [config.handle, acceptance.from],
    created_at: party?.created_at ?? invite.sent_at,
    created_by: party?.created_by ?? config.handle,
    status: "active",
    updated_at: new Date().toISOString(),
  };
  await store.saveParty(record);
}
