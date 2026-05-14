export type MessageKind =
  | "party_invite"
  | "party_accept"
  | "party_decline"
  | "party_leave"
  | "key_rotation"
  | "user_message";

export interface Attachment {
  type: string;
  url?: string;
  label?: string;
  [key: string]: unknown;
}

export interface PartyDescriptor {
  party_id: string;
  members: string[];
  created_at: string;
  created_by: string;
}

export interface EnvelopeBody {
  text: string;
  attachments: Attachment[];
  party?: PartyDescriptor;
  [key: string]: unknown;
}

export interface FederationEnvelope {
  id: string;
  kind: MessageKind;
  from: string;
  from_name?: string;
  to: string;
  party_id?: string;
  sent_at: string;
  body: EnvelopeBody;
  signature: string;
}

export type UnsignedEnvelope = Omit<FederationEnvelope, "signature">;

export interface RequestBinding {
  method: string;
  path: string;
  recipient_origin: string;
}

export interface SignedRequestAuth {
  id: string;
  from: string;
  to: string;
  sent_at: string;
  signature: string;
}

export type UnsignedRequestAuth = Omit<SignedRequestAuth, "signature">;

export interface PublicIdentity {
  handle: string;
  base_url?: string;
  public_key: string;
  created_at: string;
}

export interface PeerRecord extends PublicIdentity {
  first_seen_at: string;
  last_seen_at: string;
}

export interface PartyRecord extends PartyDescriptor {
  status: "active" | "left" | "declined";
  updated_at: string;
}

export interface OutboxEntry {
  id: string;
  url: string;
  method: "POST";
  path: string;
  envelope: FederationEnvelope;
  created_at: string;
  next_attempt_at?: string;
  attempts?: number;
}

export interface OutboxAttempt {
  id: string;
  attempted_at: string;
  ok: boolean;
  status?: number;
  statusText?: string;
  body?: string;
  error?: string;
}

export interface NotificationEvent {
  id: string;
  envelope_id: string;
  kind: MessageKind;
  from: string;
  from_name?: string;
  party_id?: string;
  text_preview: string;
  received_at: string;
  reason: "invite" | "message" | "control";
}

export interface InboxItem {
  id: string;
  envelope_id: string;
  kind: MessageKind;
  from: string;
  from_name?: string;
  party_id?: string;
  text_preview: string;
  received_at: string;
  status: "unread" | "acted";
  suggested_actions: string[];
}

export interface InboxAction {
  id: string;
  inbox_id?: string;
  envelope_id: string;
  action: "accept" | "decline" | "reply" | "view" | "archive";
  acted_at: string;
  result?: string;
}

export interface BootstrapInvite {
  code: string;
  party_id: string;
  from: string;
  from_name?: string;
  to_handle?: string;
  to_email?: string;
  text: string;
  created_at: string;
  expires_at: string;
  redeemed_at?: string;
  redeemed_by?: string;
  redeemed_base_url?: string;
  invite_id?: string;
}

export interface BootstrapRedeemRequest {
  code: string;
  identity: PublicIdentity;
}

export interface BootstrapRedeemResponse {
  status: "redeemed";
  inviter: PublicIdentity;
  invite: FederationEnvelope;
}
