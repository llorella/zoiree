import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createServer } from "../src/server";
import {
  generateIdentityKeys,
  signEnvelope,
  signRequestAuth,
  verifyEnvelopeSignature,
} from "../src/crypto";
import { FederationStore } from "../src/store";
import type { AppConfig } from "../src/config";
import type { PeerRecord, RequestBinding, UnsignedEnvelope } from "../src/types";

test("accepts a signed party invite and deduplicates replay", async () => {
  const dir = await mkdtemp(join(import.meta.dir, "tmp-server-"));
  try {
    const localKeys = generateIdentityKeys();
    const peerKeys = generateIdentityKeys();
    const config: AppConfig = {
      handle: "@bob.zo.computer",
      baseUrl: "http://bob.local",
      publicKey: localKeys.public_key,
      privateKey: localKeys.private_key,
      dataDir: dir,
      maxPayloadBytes: 256 * 1024,
      maxClockSkewMs: 10 * 60 * 1000,
      peerMap: {},
    };

    const store = new FederationStore(dir);
    await store.init();
    const now = new Date().toISOString();
    const peer: PeerRecord = {
      handle: "@alice.zo.computer",
      base_url: "http://alice.local",
      public_key: peerKeys.public_key,
      created_at: now,
      first_seen_at: now,
      last_seen_at: now,
    };
    await store.savePeer(peer);

    const unsigned: UnsignedEnvelope = {
      id: "msg_invite",
      kind: "party_invite",
      from: "@alice.zo.computer",
      to: "@bob.zo.computer",
      party_id: "party_test",
      sent_at: now,
      body: {
        text: "Want to federate?",
        attachments: [],
        party: {
          party_id: "party_test",
          members: ["@alice.zo.computer", "@bob.zo.computer"],
          created_at: now,
          created_by: "@alice.zo.computer",
        },
      },
    };
    const binding: RequestBinding = {
      method: "POST",
      path: "/api/federation/invite",
      recipient_origin: "http://bob.local",
    };
    const envelope = {
      ...unsigned,
      signature: signEnvelope(unsigned, binding, peerKeys.private_key),
    };

    const server = createServer(config);
    const first = await server.fetch(
      new Request("http://bob.local/api/federation/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
      }),
    );
    expect(first.status).toBe(201);

    const replay = await server.fetch(
      new Request("http://bob.local/api/federation/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
      }),
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ status: "duplicate", id: "msg_invite" });

    const notifications = await store.notifications();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].envelope_id).toBe("msg_invite");

    const inbox = await store.inboxItems();
    expect(inbox).toHaveLength(1);
    expect(inbox[0].suggested_actions).toEqual(["accept", "decline"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("redeems a bootstrap invite into a signed party_invite", async () => {
  const dir = await mkdtemp(join(import.meta.dir, "tmp-server-"));
  try {
    const aliceKeys = generateIdentityKeys();
    const bobKeys = generateIdentityKeys();
    const now = new Date().toISOString();
    const config: AppConfig = {
      handle: "@alice.zo.computer",
      baseUrl: "http://alice.local",
      publicKey: aliceKeys.public_key,
      privateKey: aliceKeys.private_key,
      dataDir: dir,
      maxPayloadBytes: 256 * 1024,
      maxClockSkewMs: 10 * 60 * 1000,
      peerMap: {},
    };

    const store = new FederationStore(dir);
    await store.init();
    await store.saveBootstrapInvite({
      code: "zoi_test",
      party_id: "party_bootstrap",
      from: "@alice.zo.computer",
      to_handle: "@bob.zo.computer",
      text: "Want to share apartment listings?",
      created_at: now,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    const server = createServer(config);
    const response = await server.fetch(
      new Request("http://alice.local/api/federation/bootstrap/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: "zoi_test",
          identity: {
            handle: "@bob.zo.computer",
            base_url: "http://bob.local",
            public_key: bobKeys.public_key,
            created_at: now,
          },
        }),
      }),
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      inviter: { public_key: string };
      invite: UnsignedEnvelope & { signature: string };
    };
    expect(body.invite.kind).toBe("party_invite");
    expect(body.invite.to).toBe("@bob.zo.computer");
    expect(body.invite.party_id).toBe("party_bootstrap");
    expect(
      verifyEnvelopeSignature(
        body.invite,
        {
          method: "POST",
          path: "/api/federation/invite",
          recipient_origin: "http://bob.local",
        },
        body.inviter.public_key,
      ),
    ).toBe(true);

    const stored = await store.getBootstrapInvite("zoi_test");
    expect(stored?.redeemed_by).toBe("@bob.zo.computer");
    expect(await store.getPeer("@bob.zo.computer")).not.toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("returns party messages through signed polling", async () => {
  const dir = await mkdtemp(join(import.meta.dir, "tmp-server-"));
  try {
    const localKeys = generateIdentityKeys();
    const peerKeys = generateIdentityKeys();
    const config: AppConfig = {
      handle: "@alice.zo.computer",
      baseUrl: "http://alice.local",
      publicKey: localKeys.public_key,
      privateKey: localKeys.private_key,
      dataDir: dir,
      maxPayloadBytes: 256 * 1024,
      maxClockSkewMs: 10 * 60 * 1000,
      peerMap: {},
    };

    const store = new FederationStore(dir);
    await store.init();
    const now = new Date().toISOString();
    await store.savePeer({
      handle: "@bob.zo.computer",
      base_url: "http://bob.local",
      public_key: peerKeys.public_key,
      created_at: now,
      first_seen_at: now,
      last_seen_at: now,
    });
    await store.saveParty({
      party_id: "party_test",
      members: ["@alice.zo.computer", "@bob.zo.computer"],
      created_at: now,
      created_by: "@alice.zo.computer",
      status: "active",
      updated_at: now,
    });
    await store.appendMessage({
      id: "msg_1",
      kind: "user_message",
      from: "@alice.zo.computer",
      to: "@bob.zo.computer",
      party_id: "party_test",
      sent_at: now,
      body: { text: "first", attachments: [] },
      signature: "sig_1",
    });
    await store.appendMessage({
      id: "msg_2",
      kind: "user_message",
      from: "@alice.zo.computer",
      to: "@bob.zo.computer",
      party_id: "party_test",
      sent_at: now,
      body: { text: "second", attachments: [] },
      signature: "sig_2",
    });

    const path = "/api/federation/party/party_test/messages?since=msg_1";
    const auth = {
      id: "req_poll",
      from: "@bob.zo.computer",
      to: "@alice.zo.computer",
      sent_at: now,
    };
    const signature = signRequestAuth(
      auth,
      {
        method: "GET",
        path,
        recipient_origin: "http://alice.local",
      },
      peerKeys.private_key,
    );

    const server = createServer(config);
    const response = await server.fetch(
      new Request(`http://alice.local${path}`, {
        headers: {
          "x-zoiree-id": auth.id,
          "x-zoiree-from": auth.from,
          "x-zoiree-to": auth.to,
          "x-zoiree-sent-at": auth.sent_at,
          "x-zoiree-signature": signature,
        },
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      party_id: string;
      messages: Array<{ id: string }>;
    };
    expect(body.party_id).toBe("party_test");
    expect(body.messages.map((message) => message.id)).toEqual(["msg_2"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects party_accept without a matching outbound invite", async () => {
  const dir = await mkdtemp(join(import.meta.dir, "tmp-server-"));
  try {
    const localKeys = generateIdentityKeys();
    const peerKeys = generateIdentityKeys();
    const now = new Date().toISOString();
    const config: AppConfig = {
      handle: "@alice.zo.computer",
      baseUrl: "http://alice.local",
      publicKey: localKeys.public_key,
      privateKey: localKeys.private_key,
      dataDir: dir,
      maxPayloadBytes: 256 * 1024,
      maxClockSkewMs: 10 * 60 * 1000,
      peerMap: {},
    };

    const store = new FederationStore(dir);
    await store.init();
    await store.savePeer({
      handle: "@bob.zo.computer",
      base_url: "http://bob.local",
      public_key: peerKeys.public_key,
      created_at: now,
      first_seen_at: now,
      last_seen_at: now,
    });

    const unsigned: UnsignedEnvelope = {
      id: "msg_accept_forged",
      kind: "party_accept",
      from: "@bob.zo.computer",
      to: "@alice.zo.computer",
      party_id: "party_forged",
      sent_at: now,
      body: {
        text: "Accepted.",
        attachments: [],
        party: {
          party_id: "party_forged",
          members: ["@alice.zo.computer", "@bob.zo.computer"],
          created_at: now,
          created_by: "@bob.zo.computer",
        },
      },
    };
    const envelope = {
      ...unsigned,
      signature: signEnvelope(
        unsigned,
        {
          method: "POST",
          path: "/api/federation/invite",
          recipient_origin: "http://alice.local",
        },
        peerKeys.private_key,
      ),
    };

    const server = createServer(config);
    const response = await server.fetch(
      new Request("http://alice.local/api/federation/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
      }),
    );

    expect(response.status).toBe(403);
    expect(await store.getParty("party_forged")).toBeNull();
    expect(await store.hasSeen("msg_accept_forged")).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("installs party_accept only from a matching outbound invite", async () => {
  const dir = await mkdtemp(join(import.meta.dir, "tmp-server-"));
  try {
    const localKeys = generateIdentityKeys();
    const peerKeys = generateIdentityKeys();
    const now = new Date().toISOString();
    const config: AppConfig = {
      handle: "@alice.zo.computer",
      baseUrl: "http://alice.local",
      publicKey: localKeys.public_key,
      privateKey: localKeys.private_key,
      dataDir: dir,
      maxPayloadBytes: 256 * 1024,
      maxClockSkewMs: 10 * 60 * 1000,
      peerMap: {},
    };

    const store = new FederationStore(dir);
    await store.init();
    await store.savePeer({
      handle: "@bob.zo.computer",
      base_url: "http://bob.local",
      public_key: peerKeys.public_key,
      created_at: now,
      first_seen_at: now,
      last_seen_at: now,
    });

    await store.appendInvite({
      id: "msg_invite_outbound",
      kind: "party_invite",
      from: "@alice.zo.computer",
      to: "@bob.zo.computer",
      party_id: "party_real",
      sent_at: now,
      body: {
        text: "Want to federate?",
        attachments: [],
        party: {
          party_id: "party_real",
          members: ["@alice.zo.computer", "@bob.zo.computer"],
          created_at: now,
          created_by: "@alice.zo.computer",
        },
      },
      signature: "alice_sig",
    });

    const unsigned: UnsignedEnvelope = {
      id: "msg_accept_real",
      kind: "party_accept",
      from: "@bob.zo.computer",
      to: "@alice.zo.computer",
      party_id: "party_real",
      sent_at: now,
      body: {
        text: "Accepted.",
        attachments: [],
        party: {
          party_id: "party_real",
          members: [
            "@alice.zo.computer",
            "@bob.zo.computer",
            "@mallory.zo.computer",
          ],
          created_at: now,
          created_by: "@bob.zo.computer",
        },
      },
    };
    const envelope = {
      ...unsigned,
      signature: signEnvelope(
        unsigned,
        {
          method: "POST",
          path: "/api/federation/invite",
          recipient_origin: "http://alice.local",
        },
        peerKeys.private_key,
      ),
    };

    const server = createServer(config);
    const response = await server.fetch(
      new Request("http://alice.local/api/federation/invite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(envelope),
      }),
    );

    expect(response.status).toBe(201);
    const party = await store.getParty("party_real");
    expect(party?.members).toEqual([
      "@alice.zo.computer",
      "@bob.zo.computer",
    ]);
    expect(party?.created_by).toBe("@alice.zo.computer");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
