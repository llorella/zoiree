import { loadConfig } from "../src/config";
import { FederationStore } from "../src/store";

const config = loadConfig();
const store = new FederationStore(config.dataDir);
await store.init();

const items = await store.inboxItems();
const actions = await store.inboxActions();
const actedEnvelopeIds = new Set(actions.map((action) => action.envelope_id));
const unreadOnly = !Bun.argv.includes("--all");
const selected = items
  .map((item) => ({
    ...item,
    status: actedEnvelopeIds.has(item.envelope_id) ? "acted" : item.status,
  }))
  .filter((item) => (unreadOnly ? item.status === "unread" : true));

if (selected.length === 0) {
  console.log(unreadOnly ? "No unread Zoiree inbox items." : "No Zoiree inbox items.");
  process.exit(0);
}

for (const item of selected) {
  console.log(`${item.id} ${item.kind} from ${item.from} [${item.status}]`);
  if (item.party_id) console.log(`  party: ${item.party_id}`);
  console.log(`  envelope: ${item.envelope_id}`);
  console.log(`  received: ${item.received_at}`);
  console.log(`  text: ${item.text_preview}`);
  console.log(`  actions: ${item.suggested_actions.join(", ")}`);
  console.log("");
}
