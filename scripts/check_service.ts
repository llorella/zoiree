import { loadConfig } from "../src/config";
import { describeUnreachable, fetchText } from "../src/http-client";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = Bun.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = Bun.argv.indexOf(`--${name}`);
  if (index >= 0) return Bun.argv[index + 1];
  return undefined;
}

const requiredEnv = [
  "ZOIREE_HANDLE",
  "ZOIREE_BASE_URL",
  "ZOIREE_PRIVATE_KEY",
  "ZOIREE_PUBLIC_KEY",
];

const missing = requiredEnv.filter((name) => !Bun.env[name]);
if (missing.length > 0) {
  console.error(`Missing required service env: ${missing.join(", ")}`);
  process.exit(1);
}

const config = loadConfig();
const serviceUrl = (arg("url") ?? config.baseUrl)?.replace(/\/$/, "");
if (!serviceUrl) {
  console.error("Missing --url or ZOIREE_BASE_URL");
  process.exit(1);
}

const health = await fetchText(`${serviceUrl}/health`, {
  headers: { accept: "application/json" },
});
if (!health.reached) {
  console.error(describeUnreachable("Zoiree service", serviceUrl, health.error));
  process.exit(1);
}
if (!health.ok) {
  console.error(`/health failed: ${health.status} ${health.statusText}`);
  console.error(health.text);
  process.exit(1);
}

const key = await fetchText(`${serviceUrl}/api/federation/key`, {
  headers: { accept: "application/json" },
});
if (!key.reached) {
  console.error(describeUnreachable("Zoiree key endpoint", serviceUrl, key.error));
  process.exit(1);
}
if (!key.ok) {
  console.error(`/api/federation/key failed: ${key.status} ${key.statusText}`);
  console.error(key.text);
  process.exit(1);
}

const identity = JSON.parse(key.text) as {
  handle?: string;
  public_key?: string;
  base_url?: string;
};
if (identity.handle !== config.handle) {
  console.error(`Key endpoint handle mismatch: expected ${config.handle}, got ${identity.handle}`);
  process.exit(1);
}
if (!identity.public_key) {
  console.error("Key endpoint is missing public_key");
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      serviceUrl,
      handle: identity.handle,
      baseUrl: identity.base_url,
      publicKeyPresent: true,
      dataDir: config.dataDir,
    },
    null,
    2,
  ),
);
