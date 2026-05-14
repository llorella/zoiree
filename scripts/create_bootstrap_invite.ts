import { randomBytes } from "node:crypto";
import { loadConfig } from "../src/config";
import { FederationStore } from "../src/store";
import type { BootstrapInvite } from "../src/types";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = Bun.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = Bun.argv.indexOf(`--${name}`);
  if (index >= 0) return Bun.argv[index + 1];
  return undefined;
}

function requiredArg(name: string): string {
  const value = arg(name);
  if (!value) {
    console.error(`Missing --${name}`);
    process.exit(1);
  }
  return value;
}

const config = loadConfig();
const text = requiredArg("text");
const toEmail = arg("to-email");
const toHandle = arg("to-handle");
const fromName = arg("from-name");
const expiresHours = Number(arg("expires-hours") ?? 72);
const skillUrl =
  arg("skill-url") ??
  "https://github.com/llorella/zoiree/tree/main/Skills/zoiree";
const repoUrl = arg("repo-url") ?? "https://github.com/llorella/zoiree.git";
const code = `zoi_${randomBytes(12).toString("base64url")}`;
const now = new Date();
const expires = new Date(now.getTime() + expiresHours * 60 * 60 * 1000);

const invite: BootstrapInvite = {
  code,
  party_id: `party_${crypto.randomUUID()}`,
  from: config.handle,
  ...(fromName ? { from_name: fromName } : {}),
  ...(toEmail ? { to_email: toEmail } : {}),
  ...(toHandle ? { to_handle: toHandle } : {}),
  text,
  created_at: now.toISOString(),
  expires_at: expires.toISOString(),
};

const store = new FederationStore(config.dataDir);
await store.init();
await store.saveBootstrapInvite(invite);

const setupLine = `Install Zoiree and redeem invite ${code}`;
const serviceUrlLine = config.baseUrl
  ? `Alice's Zoiree service: ${config.baseUrl}`
  : "Alice will provide her Zoiree service URL separately.";
const aliceUrl = config.baseUrl ?? "ALICE_ZOIREE_SERVICE_URL";

console.log(JSON.stringify(invite, null, 2));
console.log("");
console.log("Suggested email to Bob's Zo:");
console.log("");
console.log(`${config.handle} wants to connect with you on Zoiree.`);
console.log(`They say: "${text}"`);
console.log("");
console.log("Paste this into Zo chat if you want to set it up:");
console.log("");
console.log(`Use the Zoiree setup instructions at ${skillUrl}.`);
console.log(`Clone or update the Zoiree project from ${repoUrl} into /home/workspace/zoiree.`);
console.log("Use the included Skill at /home/workspace/zoiree/Skills/zoiree/SKILL.md; do not install a second copy into /home/workspace/Skills/zoiree.");
console.log(`Redeem invite ${code} from ${aliceUrl}.`);
console.log("Ask me before accepting or declining the invite.");
console.log("");
console.log(`Reference: ${setupLine}.`);
console.log(serviceUrlLine);
console.log("If Alice's Zo can send email, send this prompt to Bob. Otherwise Alice can copy and send it manually.");
console.log("Bob does not need email integration; he only needs to read the invite and paste the prompt into Zo chat.");
console.log("Only continue if Bob explicitly approves setup and accepting the invite.");
