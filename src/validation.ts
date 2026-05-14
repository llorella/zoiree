import { HttpError } from "./http";
import type { FederationEnvelope, MessageKind } from "./types";

const MESSAGE_KINDS = new Set<MessageKind>([
  "party_invite",
  "party_accept",
  "party_decline",
  "party_leave",
  "key_rotation",
  "user_message",
]);

export function assertEnvelope(value: unknown): asserts value is FederationEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Envelope must be an object");
  }

  const record = value as Record<string, unknown>;
  for (const field of ["id", "kind", "from", "to", "sent_at", "signature"]) {
    if (typeof record[field] !== "string" || !record[field]) {
      throw new HttpError(400, `${field} is required`);
    }
  }

  if (!MESSAGE_KINDS.has(record.kind as MessageKind)) {
    throw new HttpError(400, "Unsupported message kind");
  }

  if (record.from_name !== undefined && typeof record.from_name !== "string") {
    throw new HttpError(400, "from_name must be a string");
  }

  if (record.party_id !== undefined && typeof record.party_id !== "string") {
    throw new HttpError(400, "party_id must be a string");
  }

  if (!record.body || typeof record.body !== "object" || Array.isArray(record.body)) {
    throw new HttpError(400, "body must be an object");
  }

  const body = record.body as Record<string, unknown>;
  if (typeof body.text !== "string") {
    throw new HttpError(400, "body.text is required");
  }
  if (!Array.isArray(body.attachments)) {
    throw new HttpError(400, "body.attachments must be an array");
  }
}

export function assertTimestampFresh(sentAt: string, maxClockSkewMs: number): void {
  const time = Date.parse(sentAt);
  if (!Number.isFinite(time)) {
    throw new HttpError(400, "sent_at must be an ISO timestamp");
  }

  if (Math.abs(Date.now() - time) > maxClockSkewMs) {
    throw new HttpError(400, "sent_at is outside allowed clock skew");
  }
}

export function assertEnvelopeForLocalRecipient(
  envelope: FederationEnvelope,
  localHandle: string,
): void {
  if (envelope.to.toLowerCase() !== localHandle.toLowerCase()) {
    throw new HttpError(400, "Envelope recipient does not match this Zoiree service");
  }
}

export function assertInviteRouteKind(kind: MessageKind): void {
  if (!["party_invite", "party_accept", "party_decline"].includes(kind)) {
    throw new HttpError(400, "Unsupported invite route message kind");
  }
}

export function assertPartyRouteKind(kind: MessageKind): void {
  if (!["user_message", "party_leave"].includes(kind)) {
    throw new HttpError(400, "Unsupported party route message kind");
  }
}
