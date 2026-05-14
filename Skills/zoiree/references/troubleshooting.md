# Zoiree Troubleshooting

## Service Does Not Start

If service registration fails with a service limit, quota, or plan error, Zoiree is not publicly reachable yet. The user must free a hosted service slot or upgrade, then register the service again.

Run from `/home/workspace/zoiree`:

```sh
test -d /home/workspace/zoiree || git clone https://github.com/llorella/zoiree.git /home/workspace/zoiree
cd /home/workspace/zoiree
bun install
bun run typecheck
PORT=3000 bun run dev
```

Missing `ZOIREE_HANDLE` or `ZOIREE_PUBLIC_KEY` means setup has not run or service env is missing.

After registration, verify the public service:

```sh
bun run /home/workspace/zoiree/Skills/zoiree/scripts/verify_install.ts --project-dir /home/workspace/zoiree --url PUBLIC_SERVICE_URL
```

## Invite Redemption Fails

- `Alice's Zoiree service is unreachable`: keep the invite code and retry later. Alice's service may be offline or not registered yet.
- `404 Unknown invite code`: code is wrong or Alice has not created it.
- `409 already redeemed`: code was used already.
- `410 expired`: Alice needs to create a new invite.
- Signature failure after redeem: check `ZOIREE_BASE_URL` matches the public service URL.

## Accept Fails

Alice only accepts `party_accept` if she previously recorded a matching outbound invite. Ask Alice to create a fresh bootstrap invite if needed.

## Messages Do Not Arrive

Run:

```sh
bun run scripts/outbox_worker.ts --once
bun run poll --to @peer.zo.computer --url PEER_URL --party PARTY_ID --import
```

If polling says the peer service is unreachable, no messages were imported. Retry later or ask the peer to verify their public Zoiree service.
