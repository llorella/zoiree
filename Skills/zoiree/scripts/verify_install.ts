function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = Bun.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = Bun.argv.indexOf(`--${name}`);
  if (index >= 0) return Bun.argv[index + 1];
  return undefined;
}

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [key, ...rest] = line.split("=");
    if (!key || rest.length === 0) continue;
    env[key] = rest.join("=").replace(/^["']|["']$/g, "");
  }
  return env;
}

async function readProjectEnv(projectDir: string): Promise<Record<string, string>> {
  const envFile = Bun.file(`${projectDir}/.env`);
  if (!(await envFile.exists())) return {};
  return parseEnv(await envFile.text());
}

async function fetchJson(url: string): Promise<{
  ok: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
  error?: string;
}> {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Keep the raw body for diagnostics.
    }
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body,
      ...(response.ok ? {} : { error: text }),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const projectDir = arg("project-dir") ?? "/home/workspace/zoiree";
const packageFile = Bun.file(`${projectDir}/package.json`);
if (!(await packageFile.exists())) {
  console.error(`Zoiree project not found at ${projectDir}`);
  process.exit(1);
}

const pkg = (await packageFile.json()) as { scripts?: Record<string, string> };
if (pkg.scripts?.dev !== "bun run src/server.ts") {
  console.error("package.json does not expose the expected dev script");
  process.exit(1);
}

const projectEnv = await readProjectEnv(projectDir);
const mergedEnv = { ...projectEnv, ...Bun.env };
const requiredEnv = [
  "ZOIREE_HANDLE",
  "ZOIREE_BASE_URL",
  "ZOIREE_PRIVATE_KEY",
  "ZOIREE_PUBLIC_KEY",
  "ZOIREE_DATA_DIR",
];
const missingEnv = requiredEnv.filter((name) => !mergedEnv[name]);
if (missingEnv.length > 0) {
  console.error(`Missing Zoiree env var(s): ${missingEnv.join(", ")}`);
  process.exit(1);
}

const serviceUrl = (arg("url") ?? mergedEnv.ZOIREE_BASE_URL)?.replace(/\/$/, "");
if (!serviceUrl) {
  console.error("Missing --url or ZOIREE_BASE_URL");
  process.exit(1);
}

const health = await fetchJson(`${serviceUrl}/health`);
if (!health.ok) {
  console.error(`/health failed for ${serviceUrl}: ${health.status ?? "unreachable"} ${health.statusText ?? ""}`.trim());
  if (health.error) console.error(health.error);
  process.exit(1);
}

const key = await fetchJson(`${serviceUrl}/api/federation/key`);
if (!key.ok) {
  console.error(`/api/federation/key failed for ${serviceUrl}: ${key.status ?? "unreachable"} ${key.statusText ?? ""}`.trim());
  if (key.error) console.error(key.error);
  process.exit(1);
}

const identity = key.body as {
  handle?: string;
  public_key?: string;
  base_url?: string;
};
if (identity.handle !== mergedEnv.ZOIREE_HANDLE || !identity.public_key) {
  console.error("Federation key response does not match configured identity");
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      projectDir,
      serviceUrl,
      identity: {
        handle: identity.handle,
        base_url: identity.base_url,
        public_key_present: Boolean(identity.public_key),
      },
      env: requiredEnv,
    },
    null,
    2,
  ),
);

export {};
