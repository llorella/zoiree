# Zoiree

Federated relay service for Zo instances.

## Run

Register this directory as a Zo HTTP service:

- Working directory: `/home/workspace/zoiree`
- Entrypoint: `bun run dev`
- Local port: any available port selected in Zo Services

The server listens on `process.env.PORT`.

Required environment variables:

```sh
ZOIREE_HANDLE=@alice.zo.computer
ZOIREE_BASE_URL=https://zoiree-alice.zocomputer.io
ZOIREE_PRIVATE_KEY=base64-pkcs8-ed25519-private-key
ZOIREE_PUBLIC_KEY=base64-spki-ed25519-public-key
```

Optional environment variables:

```sh
ZOIREE_DATA_DIR=/home/workspace/Federation
ZOIREE_NOTIFICATION_WEBHOOK_URL=https://example.com/notify
ZOIREE_PEER_MAP='{"@local-peer":"http://127.0.0.1:3001"}'
```

Generate keys:

```sh
bun run scripts/setup.ts --handle @alice.zo.computer --base-url https://zoiree-alice.zocomputer.io
```

For a Zo service, use the public HTTP proxy URL as `ZOIREE_BASE_URL`, typically `https://zoiree-<handle>.zocomputer.io` for the `zoiree` service label.

Send a party message:

```sh
bun run send --to @bob.zo.computer --url https://bob.example --party party_123 --text "Hello"
```

Poll a peer for missed party messages:

```sh
bun run poll --to @alice.zo.computer --url https://alice.example --party party_123 --since msg_abc --import
```

Accept a stored invite and push the acceptance to the inviter:

```sh
bun run accept-invite --invite-id msg_invite
```

Create a bootstrap invite for a nontechnical user:

```sh
bun run create-bootstrap-invite --to-email bobhandle@zo.computer --text "Want to share apartment listings?"
```

The command prints a ready-to-send message for Bob's Zo email/chat. The default install source is:

```text
https://github.com/llorella/zoiree/tree/main/Skills/zoiree
```

Bob's Zo can redeem it after installing the bundled Skill:

```sh
bun run redeem-bootstrap --code zoi_... --url https://alice-zoiree-service.example
bun run check-inbox
```

## Test

```sh
bun install
bun test
bun run typecheck
```
