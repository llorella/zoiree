import type { PublicIdentity } from "./types";

export interface AppConfig {
  handle: string;
  baseUrl?: string;
  publicKey: string;
  privateKey?: string;
  dataDir: string;
  maxPayloadBytes: number;
  maxClockSkewMs: number;
  peerMap: Record<string, string>;
}

function requiredEnv(name: string): string {
  const value = Bun.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parsePeerMap(): Record<string, string> {
  const raw = Bun.env.ZOIREE_PEER_MAP;
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ZOIREE_PEER_MAP must be a JSON object");
  }
  return parsed as Record<string, string>;
}

export function loadConfig(options: Partial<AppConfig> = {}): AppConfig {
  return {
    handle: options.handle ?? requiredEnv("ZOIREE_HANDLE"),
    baseUrl: options.baseUrl ?? Bun.env.ZOIREE_BASE_URL,
    publicKey: options.publicKey ?? requiredEnv("ZOIREE_PUBLIC_KEY"),
    privateKey: options.privateKey ?? Bun.env.ZOIREE_PRIVATE_KEY,
    dataDir:
      options.dataDir ?? Bun.env.ZOIREE_DATA_DIR ?? "/home/workspace/Federation",
    maxPayloadBytes:
      options.maxPayloadBytes ??
      Number(Bun.env.ZOIREE_MAX_PAYLOAD_BYTES ?? 256 * 1024),
    maxClockSkewMs:
      options.maxClockSkewMs ??
      Number(Bun.env.ZOIREE_MAX_CLOCK_SKEW_MS ?? 10 * 60 * 1000),
    peerMap: options.peerMap ?? parsePeerMap(),
  };
}

export function publicIdentity(config: AppConfig): PublicIdentity {
  return {
    handle: config.handle,
    ...(config.baseUrl ? { base_url: config.baseUrl } : {}),
    public_key: config.publicKey,
    created_at: new Date().toISOString(),
  };
}
