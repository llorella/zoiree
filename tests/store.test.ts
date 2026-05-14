import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { FederationStore } from "../src/store";
import type { FederationEnvelope, PartyRecord } from "../src/types";

test("marks duplicate message IDs atomically", async () => {
  const dir = await mkdtemp(join(import.meta.dir, "tmp-store-"));
  try {
    const store = new FederationStore(dir);
    await store.init();
    const envelope: FederationEnvelope = {
      id: "msg_duplicate",
      kind: "user_message",
      from: "@alice.zo.computer",
      to: "@bob.zo.computer",
      party_id: "party_test",
      sent_at: new Date().toISOString(),
      body: { text: "hello", attachments: [] },
      signature: "sig",
    };

    expect(await store.markSeen(envelope.id, envelope)).toBe(true);
    expect(await store.markSeen(envelope.id, envelope)).toBe(false);
    expect(await store.hasSeen(envelope.id)).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writes parties and appends party messages", async () => {
  const dir = await mkdtemp(join(import.meta.dir, "tmp-store-"));
  try {
    const store = new FederationStore(dir);
    await store.init();
    const party: PartyRecord = {
      party_id: "party_test",
      members: ["@alice.zo.computer", "@bob.zo.computer"],
      created_at: new Date().toISOString(),
      created_by: "@alice.zo.computer",
      status: "active",
      updated_at: new Date().toISOString(),
    };
    await store.saveParty(party);

    expect(await store.getParty("party_test")).toEqual(party);

    const envelope: FederationEnvelope = {
      id: "msg_1",
      kind: "user_message",
      from: "@alice.zo.computer",
      to: "@bob.zo.computer",
      party_id: "party_test",
      sent_at: new Date().toISOString(),
      body: { text: "hello", attachments: [] },
      signature: "sig",
    };
    await store.appendMessage(envelope);

    const messages = await store.readJsonl<FederationEnvelope>(
      store.messagesPath("party_test"),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("msg_1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
