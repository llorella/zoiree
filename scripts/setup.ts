import { mkdir, readFile, writeFile } from "node:fs/promises";
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

const handleArg = arg("handle");
const baseUrl = arg("base-url");
const writeEnv = Bun.argv.includes("--write-env");
const preserveKeys = Bun.argv.includes("--preserve-keys");
const dataDir = Bun.env.ZOIREE_DATA_DIR ?? "/home/workspace/Federation";

async function readExistingEnv(): Promise<Record<string, string>> {
  try {
    const text = await readFile(".env", "utf8");
    const map: Record<string, string> = {};
    for (const line of text.split("\n")) {
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      map[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    return map;
  } catch {
    return {};
  }
}

const existing = preserveKeys ? await readExistingEnv() : {};

const handle = handleArg ?? existing.ZOIREE_HANDLE;
if (!handle) {
  console.error(
    "Usage: bun run scripts/setup.ts --handle @alice.zo.computer [--base-url https://...] [--write-env] [--preserve-keys]",
  );
  process.exit(1);
}

const keys = preserveKeys && existing.ZOIREE_PRIVATE_KEY && existing.ZOIREE_PUBLIC_KEY
  ? { private_key: existing.ZOIREE_PRIVATE_KEY, public_key: existing.ZOIREE_PUBLIC_KEY }
  : generateIdentityKeys();

const resolvedBaseUrl = baseUrl ?? (preserveKeys ? existing.ZOIREE_BASE_URL : undefined);

const env = [
  `ZOIREE_HANDLE=${handle}`,
  ...(resolvedBaseUrl ? [`ZOIREE_BASE_URL=${resolvedBaseUrl}`] : []),
  `ZOIREE_PRIVATE_KEY=${keys.private_key}`,
  `ZOIREE_PUBLIC_KEY=${keys.public_key}`,
  `ZOIREE_DATA_DIR=${dataDir}`,
].join("\n");

const identity = {
  handle,
  ...(resolvedBaseUrl ? { base_url: resolvedBaseUrl } : {}),
  public_key: keys.public_key,
  created_at: new Date().toISOString(),
};

await mkdir(dataDir, { recursive: true }).catch(() => {});
await writeFile(
  join(dataDir, "identity.json"),
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
