import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  type KeyObject,
} from "node:crypto";
import { canonicalJson } from "./canonical";
import type {
  FederationEnvelope,
  RequestBinding,
  SignedRequestAuth,
  UnsignedEnvelope,
  UnsignedRequestAuth,
} from "./types";

export interface GeneratedKeyPair {
  private_key: string;
  public_key: string;
}

export function generateIdentityKeys(): GeneratedKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    private_key: privateKey
      .export({ format: "der", type: "pkcs8" })
      .toString("base64"),
    public_key: publicKey
      .export({ format: "der", type: "spki" })
      .toString("base64"),
  };
}

export function loadPrivateKey(base64Der: string): KeyObject {
  return createPrivateKey({
    key: Buffer.from(base64Der, "base64"),
    format: "der",
    type: "pkcs8",
  });
}

export function loadPublicKey(base64Der: string): KeyObject {
  return createPublicKey({
    key: Buffer.from(base64Der, "base64"),
    format: "der",
    type: "spki",
  });
}

export function sha256Base64(input: string): string {
  return createHash("sha256").update(input).digest("base64");
}

export function stripSignature(
  envelope: FederationEnvelope,
): UnsignedEnvelope {
  const { signature: _signature, ...unsigned } = envelope;
  return unsigned;
}

export function signingPayload(
  envelope: UnsignedEnvelope,
  binding: RequestBinding,
): string {
  const bodyCanonical = canonicalJson(envelope.body);
  return canonicalJson({
    envelope,
    request: {
      method: binding.method.toUpperCase(),
      path: binding.path,
      recipient_origin: binding.recipient_origin,
      body_sha256: sha256Base64(bodyCanonical),
    },
  });
}

export function signingPayloadForRequest(
  auth: UnsignedRequestAuth,
  binding: RequestBinding,
): string {
  return canonicalJson({
    auth,
    request: {
      method: binding.method.toUpperCase(),
      path: binding.path,
      recipient_origin: binding.recipient_origin,
      body_sha256: sha256Base64(""),
    },
  });
}

export function signEnvelope(
  envelope: UnsignedEnvelope,
  binding: RequestBinding,
  privateKeyBase64: string,
): string {
  const privateKey = loadPrivateKey(privateKeyBase64);
  const payload = signingPayload(envelope, binding);
  return nodeSign(null, Buffer.from(payload), privateKey).toString("base64");
}

export function signRequestAuth(
  auth: UnsignedRequestAuth,
  binding: RequestBinding,
  privateKeyBase64: string,
): string {
  const privateKey = loadPrivateKey(privateKeyBase64);
  const payload = signingPayloadForRequest(auth, binding);
  return nodeSign(null, Buffer.from(payload), privateKey).toString("base64");
}

export function verifyEnvelopeSignature(
  envelope: FederationEnvelope,
  binding: RequestBinding,
  publicKeyBase64: string,
): boolean {
  const publicKey = loadPublicKey(publicKeyBase64);
  const payload = signingPayload(stripSignature(envelope), binding);
  return nodeVerify(
    null,
    Buffer.from(payload),
    publicKey,
    Buffer.from(envelope.signature, "base64"),
  );
}

export function verifyRequestSignature(
  auth: SignedRequestAuth,
  binding: RequestBinding,
  publicKeyBase64: string,
): boolean {
  const publicKey = loadPublicKey(publicKeyBase64);
  const { signature: _signature, ...unsigned } = auth;
  const payload = signingPayloadForRequest(unsigned, binding);
  return nodeVerify(
    null,
    Buffer.from(payload),
    publicKey,
    Buffer.from(auth.signature, "base64"),
  );
}
