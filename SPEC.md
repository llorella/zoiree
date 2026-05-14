# Zoiree v0.2 - Federated Zo Relay Protocol

## Goal

Zoiree lets two Zo instances exchange user-controlled messages directly. A Zo receives signed relay requests through a public HTTP service, verifies them, writes them to workspace files, and lets the local user or local agent decide what to do next.

Core principle: messages are durable files; APIs only move and verify them.

## Zo Platform Fit

- Zoiree runs as a Zo HTTP service.
- Working directory: `/home/workspace/zoiree`.
- Entrypoint: `bun run dev`.
- Zo injects the configured local port as `PORT`.
- Durable protocol state lives under `/home/workspace/Federation` by default.
- Public HTTP services have no built-in auth, so every relay request must be authenticated by Zoiree signatures.
- Retry/background processing can run as a separate Zo process service using `bun run scripts/outbox_worker.ts`.
- If service registration fails with a hosted-service limit or quota error, setup must stop until the user frees a service slot or upgrades.

## Components

1. Relay API: public HTTP routes under `/api/federation/*`.
2. Federation Store: append-friendly workspace files.
3. Identity Layer: Ed25519 key pair stored in Zo service environment variables.
4. Send Client: local script for signing and POSTing messages.
5. Outbox Worker: process service that retries failed outbound messages.
6. Bootstrap Skill: chat-facing setup instructions for nontechnical invitees.
7. Management UI: later private UI for invites, peers, parties, and delivery status.

## Skill Install Modes

Repo mode is the default direct GitHub onboarding path. Zoiree is cloned to `/home/workspace/zoiree`, and Zo uses the nested Skill at `/home/workspace/zoiree/Skills/zoiree/SKILL.md`. Repo mode must not also copy the Skill to `/home/workspace/Skills/zoiree`, because Zo auto-loads nested workspace skills and a top-level copy would create duplicate Skill entries.

Registry mode is the future Zo Skills Registry path. In that mode, the Skill may live at `/home/workspace/Skills/zoiree` and clone or update `/home/workspace/zoiree` as the app runtime.

## Identity

Each Zo has:

- `ZOIREE_PRIVATE_KEY`: base64 Ed25519 private key in PKCS8 DER format.
- `ZOIREE_PUBLIC_KEY`: base64 Ed25519 public key in SPKI DER format.
- `ZOIREE_HANDLE`: canonical handle, e.g. `@alice.zo.computer`.
- `ZOIREE_BASE_URL`: canonical relay origin, useful for custom domains and required for stable signature verification behind proxies.

Public keys are fetched from `GET /api/federation/key` and pinned on first use. A peer key change is rejected until key rotation is explicitly implemented.

## Signed Envelope

Every inbound request carries a signed envelope:

```json
{
  "id": "msg_01HY...",
  "kind": "user_message",
  "from": "@alice.zo.computer",
  "from_name": "Alice",
  "to": "@bob.zo.computer",
  "party_id": "party_01HY...",
  "sent_at": "2026-05-13T15:36:00Z",
  "body": {
    "text": "Found three listings.",
    "attachments": []
  },
  "signature": "BASE64_SIGNATURE"
}
```

The signature covers canonical JSON excluding `signature`, plus request binding fields:

- HTTP method
- route path
- recipient origin
- SHA-256 digest of the canonical body

Receivers reject invalid signatures, stale timestamps, unknown senders where not allowed, duplicate IDs, oversized payloads, and route/envelope mismatches.

## Message Kinds

User-facing messages remain simple:

- `body.text`
- `body.attachments`

Control-plane events are explicitly typed because they mutate protocol state:

- `party_invite`
- `party_accept`
- `party_decline`
- `party_leave`
- `key_rotation`
- `user_message`

Only `user_message` is treated as freeform user context. Control events are protocol instructions.

## API Routes

### `GET /api/federation/key`

Returns this Zo's public identity.

```json
{
  "handle": "@alice.zo.computer",
  "base_url": "https://alice.zo.computer",
  "public_key": "BASE64_PUBLIC_KEY",
  "created_at": "2026-05-13T15:35:00Z"
}
```

### `POST /api/federation/invite`

Accepts `party_invite`, `party_accept`, and `party_decline`.

Behavior:

1. Verify signature and request binding.
2. Fetch or validate pinned peer key.
3. For `party_accept` and `party_decline`, require a locally recorded outbound `party_invite` from this Zo to the responder for the same `party_id`.
4. Deduplicate by `id`.
5. Append event to `Federation/invites.jsonl`.
6. If accepted, install party metadata from the original local invite, not from the remote acceptance body.
7. Return `201` for new event, `200` for duplicate accepted idempotently.

### `POST /api/federation/bootstrap/redeem`

Redeems a one-time bootstrap invite code. This is used before the invitee already has an active federation party.

Request:

```json
{
  "code": "zoi_abc123",
  "identity": {
    "handle": "@bob.zo.computer",
    "base_url": "https://bob-service.example",
    "public_key": "BASE64_PUBLIC_KEY",
    "created_at": "2026-05-14T12:00:00Z"
  }
}
```

Behavior:

1. Confirm the code exists, is unexpired, and has not been redeemed.
2. If the bootstrap invite names an expected handle, require the redeemer to match it.
3. Pin the redeemer's public key.
4. Create and sign a `party_invite` envelope bound to the redeemer's `base_url`.
5. Record the outbound invite locally.
6. Mark the bootstrap code as redeemed.
7. Return Alice's public identity and the signed invite envelope.

The invitee stores the returned invite locally, verifies the signature, shows it to the user as inbox data, and asks whether to accept or decline.

### `POST /api/federation/party/:party_id`

Accepts `user_message` and `party_leave`.

Behavior:

1. Verify signature and request binding.
2. Confirm `party_id` exists locally.
3. Confirm `from` is an active party member.
4. Deduplicate by `id`.
5. Append to `Federation/messages/{party_id}.jsonl`.
6. Return `201` or idempotent `200`.

### `GET /api/federation/party/:party_id/messages?since=msg_id`

Returns party messages after a known message ID so an offline peer can catch up by polling another party member.

This route requires a signed request using headers:

```text
x-zoiree-id: req_01HY...
x-zoiree-from: @bob.zo.computer
x-zoiree-to: @alice.zo.computer
x-zoiree-sent-at: 2026-05-13T15:36:00Z
x-zoiree-signature: BASE64_SIGNATURE
```

The signature covers method, full path with query string, recipient origin, empty body digest, request ID, sender, recipient, and timestamp.

Behavior:

1. Verify signed request headers.
2. Confirm requester is an active party member.
3. Return all local `Federation/messages/{party_id}.jsonl` entries after `since`.
4. If `since` is absent, return all local messages for that party.
5. If `since` is unknown, return all local messages so the caller can reconcile by ID.

## Storage Layout

```text
Federation/
  identity.json
  bootstrap_invites/
    zoi_abc123.json
  peers/
    alice.zo.computer.json
  parties/
    party_01HY.json
  messages/
    party_01HY.jsonl
  seen/
    msg_01HY.json
  invites.jsonl
  inbox.jsonl
  inbox_actions.jsonl
  notifications.jsonl
  outbox.jsonl
  seen_ids.jsonl
```

Use JSONL for append-heavy data. Use atomic rename for JSON metadata updates. Never rewrite large message arrays in-place during request handling.

## Party Flow

1. If Bob is already set up, Alice sends `party_invite` to Bob's `/api/federation/invite`.
2. Bob verifies, stores, and later shows it in a management UI or chat-facing inbox.
3. Bob accepts with `scripts/accept_invite.ts --invite-id <id>` or equivalent UI action.
4. Bob writes party metadata locally and sends `party_accept` directly to Alice's invite endpoint.
5. Alice verifies Bob's signature, confirms she previously sent Bob a matching `party_invite`, then installs the party metadata from her original invite.
6. Future `user_message` events go through `/api/federation/party/:party_id`.

Party IDs are generated by the inviter and included in the signed invite. Accepting that invite adopts the ID.

If the direct accept POST fails, Bob writes the signed `party_accept` to `outbox.jsonl`; the outbox worker retries. Alice does not learn about the acceptance only by passively polling Bob.

## Bootstrap Flow

For nontechnical Bob:

1. Alice runs `scripts/create_bootstrap_invite.ts`.
2. Alice gets a generated message containing the Skill URL, invite code, Alice's Zoiree service URL, and a request to ask Bob before accepting.
3. If Alice has connected email and approves sending, Alice's Zo sends Bob the generated message. If Alice does not have connected email, Zoiree shows Alice the exact message to send manually.
4. Bob reads the invite in his Zo inbox and pastes the prompt into Zo chat. Bob does not need connected email; if he has it, it is only extra convenience for finding or processing the prompt.
5. Bob tells Zo to clone or update the Zoiree repo and use the bundled `Skills/zoiree` skill from the repo.
6. The skill installs Zoiree, registers the HTTP service, verifies `/health` and `/api/federation/key`, then runs `scripts/redeem_bootstrap.ts`.
7. Bob's Zo stores the signed invite in `inbox.jsonl`.
8. Bob says accept or decline.

Email/bootstrap is optional, untrusted transport. It only carries the code and setup instruction. Bob's local Zo must ask before installation and before accepting.

## Inbox State

`inbox.jsonl` is append-only. User actions append records to `inbox_actions.jsonl`; readers derive acted/unread state by joining on `envelope_id`. This avoids rewriting inbox history while keeping `check-inbox` useful for daily use.

## Polling Flow

Each Zo writes outbound party messages to its local `messages/{party_id}.jsonl` before delivery. If direct delivery fails because the recipient is offline, the recipient can later poll the sender's `GET /api/federation/party/:party_id/messages` endpoint with a signed request and reconcile returned message IDs against its local `seen/` set. `scripts/poll_messages.ts --import` verifies returned envelopes addressed to the local Zo and appends unseen messages locally.

Polling is a recovery path. Direct POST plus outbox retry remains the primary delivery path.

## Outbox

Failed outbound sends are appended to `Federation/outbox.jsonl` with retry metadata. A process service retries with exponential backoff and appends attempt records for inspection.

## Notifications

Inbound invites, party messages, and control events append sanitized notification records to `Federation/notifications.jsonl`.

If `ZOIREE_NOTIFICATION_WEBHOOK_URL` is configured, Zoiree also POSTs the notification event to that webhook. This is intentionally not a shell command or direct tool invocation: inbound federation content must not directly execute local actions. A separate trusted notifier service or Zo automation can read `notifications.jsonl` or receive the webhook and decide whether to SMS, email, Telegram, or ignore.

## Security Rules

- Verify before writing user-visible inbound content.
- Sign route, recipient, timestamp, ID, party ID, and payload digest.
- Reject payloads above configured limits.
- Maintain replay protection by message ID.
- Pin peer keys on first successful verification.
- Never execute inbound content automatically.
- Never let inbound messages directly trigger tools, shell commands, or agent actions.
- Signed polling requests must bind the query string into the signature.

## MVP Scope

Implemented first:

- `GET /api/federation/key`
- `POST /api/federation/bootstrap/redeem`
- `POST /api/federation/invite`
- `POST /api/federation/party/:party_id`
- `GET /api/federation/party/:party_id/messages`
- `scripts/setup.ts`
- `scripts/create_bootstrap_invite.ts`
- `scripts/redeem_bootstrap.ts`
- `scripts/send_message.ts`
- `scripts/accept_invite.ts`
- `scripts/decline_invite.ts`
- `scripts/check_inbox.ts`
- `scripts/poll_messages.ts`
- `scripts/outbox_worker.ts`
- core signing, verification, storage, and tests

Deferred:

- rich notifications
- key rotation UI
- multi-member parties beyond basic metadata
- custom-domain discovery registry
