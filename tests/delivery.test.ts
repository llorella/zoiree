import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { deliverEnvelopeOrQueue } from "../src/delivery";
import { describeUnreachable, fetchText } from "../src/http-client";
import { FederationStore } from "../src/store";
import type { OutboxEntry } from "../src/types";

function outboxEntry(id = "msg_delivery"): OutboxEntry {
  return {
    id,
    url: "https://bob.example/api/federation/invite",
    method: "POST",
    path: "/api/federation/invite",
    created_at: new Date().toISOString(),
    envelope: {
      id,
      kind: "party_invite",
      from: "@alice.zo.computer",
      to: "@bob.zo.computer",
      party_id: "party_test",
      sent_at: new Date().toISOString(),
      body: { text: "hello", attachments: [] },
      signature: "sig",
    },
  };
}

test("queues outbound envelope when initial delivery throws", async () => {
  const dir = await mkdtemp(join(import.meta.dir, "tmp-delivery-"));
  try {
    const store = new FederationStore(dir);
    await store.init();
    const entry = outboxEntry("msg_throw");
    const result = await deliverEnvelopeOrQueue(
      store,
      entry,
      20_000,
      async () => {
        throw new Error("network offline");
      },
    );

    expect(result.ok).toBe(false);
    expect(result.queued).toBe(true);
    expect(result.error).toContain("network offline");
    expect(await store.outboxEntries()).toEqual([entry]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("queues outbound envelope when initial delivery returns non-2xx", async () => {
  const dir = await mkdtemp(join(import.meta.dir, "tmp-delivery-"));
  try {
    const store = new FederationStore(dir);
    await store.init();
    const entry = outboxEntry("msg_503");
    const result = await deliverEnvelopeOrQueue(
      store,
      entry,
      20_000,
      async () => new Response("service unavailable", {
        status: 503,
        statusText: "Service Unavailable",
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.queued).toBe(true);
    expect(result.status).toBe(503);
    expect(result.body).toBe("service unavailable");
    expect(await store.outboxEntries()).toEqual([entry]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("does not queue outbound envelope after successful delivery", async () => {
  const dir = await mkdtemp(join(import.meta.dir, "tmp-delivery-"));
  try {
    const store = new FederationStore(dir);
    await store.init();
    const entry = outboxEntry("msg_ok");
    const result = await deliverEnvelopeOrQueue(
      store,
      entry,
      20_000,
      async () => new Response('{"status":"received"}', { status: 201 }),
    );

    expect(result.ok).toBe(true);
    expect(result.queued).toBe(false);
    expect(await store.outboxEntries()).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("fetchText returns unreachable diagnostics without throwing", async () => {
  const result = await fetchText(
    "https://alice.example/health",
    {},
    20_000,
    async () => {
      throw new Error("connection refused");
    },
  );

  expect(result.reached).toBe(false);
  if (!result.reached) {
    expect(describeUnreachable("Alice's Zoiree service", "https://alice.example", result.error))
      .toContain("Alice's Zoiree service is unreachable");
  }
});
