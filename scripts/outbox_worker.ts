import { loadConfig } from "../src/config";
import { processOutbox } from "../src/outbox";
import { FederationStore } from "../src/store";

const once = Bun.argv.includes("--once");
const intervalMs = Number(Bun.env.ZOIREE_OUTBOX_INTERVAL_MS ?? 60_000);
const config = loadConfig();
const store = new FederationStore(config.dataDir);

async function tick(): Promise<void> {
  const attempted = await processOutbox(store);
  if (attempted > 0) {
    console.log(`attempted ${attempted} outbox send(s)`);
  }
}

if (once) {
  await tick();
} else {
  console.log(`zoiree outbox worker polling every ${intervalMs}ms`);
  for (;;) {
    await tick().catch((error) => console.error(error));
    await Bun.sleep(intervalMs);
  }
}
