import { expect, test } from "bun:test";
import {
  generateIdentityKeys,
  signEnvelope,
  verifyEnvelopeSignature,
} from "../src/crypto";
import type { RequestBinding, UnsignedEnvelope } from "../src/types";

test("signs and verifies an envelope with request binding", () => {
  const keys = generateIdentityKeys();
  const envelope: UnsignedEnvelope = {
    id: "msg_test",
    kind: "user_message",
    from: "@alice.zo.computer",
    to: "@bob.zo.computer",
    party_id: "party_test",
    sent_at: new Date().toISOString(),
    body: { text: "hello", attachments: [] },
  };
  const binding: RequestBinding = {
    method: "POST",
    path: "/api/federation/party/party_test",
    recipient_origin: "https://bob.zo.computer",
  };

  const signature = signEnvelope(envelope, binding, keys.private_key);
  expect(
    verifyEnvelopeSignature(
      { ...envelope, signature },
      binding,
      keys.public_key,
    ),
  ).toBe(true);
});

test("rejects a signature when the route binding changes", () => {
  const keys = generateIdentityKeys();
  const envelope: UnsignedEnvelope = {
    id: "msg_test",
    kind: "user_message",
    from: "@alice.zo.computer",
    to: "@bob.zo.computer",
    party_id: "party_test",
    sent_at: new Date().toISOString(),
    body: { text: "hello", attachments: [] },
  };
  const binding: RequestBinding = {
    method: "POST",
    path: "/api/federation/party/party_test",
    recipient_origin: "https://bob.zo.computer",
  };

  const signature = signEnvelope(envelope, binding, keys.private_key);
  expect(
    verifyEnvelopeSignature(
      { ...envelope, signature },
      { ...binding, path: "/api/federation/invite" },
      keys.public_key,
    ),
  ).toBe(false);
});
