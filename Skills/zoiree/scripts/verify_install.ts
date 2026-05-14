function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = Bun.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = Bun.argv.indexOf(`--${name}`);
  if (index >= 0) return Bun.argv[index + 1];
  return undefined;
}

const projectDir = arg("project-dir") ?? "/home/workspace/zoiree";
const serviceUrl = arg("url")?.replace(/\/$/, "");

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

if (serviceUrl) {
  const health = await fetch(`${serviceUrl}/health`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!health.ok) {
    console.error(`/health failed: ${health.status}`);
    process.exit(1);
  }

  const key = await fetch(`${serviceUrl}/api/federation/key`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!key.ok) {
    console.error(`/api/federation/key failed: ${key.status}`);
    process.exit(1);
  }

  const identity = (await key.json()) as {
    handle?: string;
    public_key?: string;
    base_url?: string;
  };
  if (!identity.handle || !identity.public_key) {
    console.error("Federation key response is missing handle or public_key");
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, serviceUrl, identity }, null, 2));
} else {
  console.log(JSON.stringify({ ok: true, projectDir }, null, 2));
}

export {};
