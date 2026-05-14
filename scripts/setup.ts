import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateIdentityKeys } from "../src/crypto";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = Bun.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = Bun.argv.indexOf(`--${name}`);
  if (index >= 0) return Bun.argv[index + 1];
  return undefined;
}

const handle = arg("handle");
const baseUrl = arg("base-url");
const writeEnv = Bun.argv.includes("--write-env");

if (!handle) {
  console.error("Usage: bun run scripts/setup.ts --handle @alice.zo.computer [--base-url https://alice.zo.computer] [--write-env]");
  process.exit(1);
}

const keys = generateIdentityKeys();
const env = [
  `ZOIREE_HANDLE=${handle}`,
  ...(baseUrl ? [`ZOIREE_BASE_URL=${baseUrl}`] : []),
  `ZOIREE_PRIVATE_KEY=${keys.private_key}`,
  `ZOIREE_PUBLIC_KEY=${keys.public_key}`,
].join("\n");

const identity = {
  handle,
  ...(baseUrl ? { base_url: baseUrl } : {}),
  public_key: keys.public_key,
  created_at: new Date().toISOString(),
};

await mkdir("/home/workspace/Federation", { recursive: true }).catch(() => {});
await writeFile(
  join(Bun.env.ZOIREE_DATA_DIR ?? "/home/workspace/Federation", "identity.json"),
  `${JSON.stringify(identity, null, 2)}\n`,
).catch(() => {});

if (writeEnv) {
  await writeFile(".env", `${env}\n`);
  console.log("Wrote .env and Federation/identity.json");
} else {
  console.log(env);
  console.log("");
  console.log("Set these as service environment variables. Pass --write-env only for local development.");
}
