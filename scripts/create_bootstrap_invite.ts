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

const inviterUrl = config.baseUrl ?? "INVITER_ZOIREE_SERVICE_URL";
const inviterHandle = config.handle;

const emailBody = [
  `${inviterHandle} wants to connect with you on Zoiree.`,
  `They say: "${text}"`,
  "",
  "Paste this into Zo chat if you want to set it up:",
  "",
  `Use the Zoiree setup instructions at ${skillUrl}.`,
  `Clone or update the Zoiree project from ${repoUrl} into /home/workspace/zoiree.`,
  "Use the included Skill at /home/workspace/zoiree/Skills/zoiree/SKILL.md. Do not copy or install a second copy into /home/workspace/Skills/zoiree.",
  `Redeem invite ${code} from ${inviterHandle}'s Zoiree service at ${inviterUrl}.`,
  "Ask me before accepting or declining the invite.",
].join("\n");

console.log(JSON.stringify(invite, null, 2));
console.log("");
console.log("--- BEGIN EMAIL BODY (send verbatim as plain text; do not rewrite, do not convert to HTML, do not drop steps) ---");
console.log(emailBody);
console.log("--- END EMAIL BODY ---");
console.log("");
console.log(`Subject suggestion: Zoiree invite from ${inviterHandle}`);
console.log("Transport notes:");
console.log("- If the inviter has connected email, send the body above verbatim as plain text.");
console.log("- If not, show the body to the inviter so they can send it manually.");
console.log("- The invitee does not need connected email; they can paste the prompt into Zo chat.");
console.log("- Only continue on the invitee side after they explicitly approve setup and accept the invite.");
