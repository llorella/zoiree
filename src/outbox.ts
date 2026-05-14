import { postEnvelope } from "./delivery";
import type { FederationStore } from "./store";

export async function processOutbox(store: FederationStore): Promise<number> {
  await store.init();
  const entries = await store.outboxEntries();
  const attempts = await store.outboxAttempts();
  const delivered = new Set(
    attempts.filter((attempt) => attempt.ok).map((attempt) => attempt.id),
  );

  const now = Date.now();
  let attempted = 0;

  for (const entry of entries) {
    if (delivered.has(entry.id)) continue;
    if (entry.next_attempt_at && Date.parse(entry.next_attempt_at) > now) {
      continue;
    }

    const result = await postEnvelope(entry);
    await store.appendOutboxAttempt({
      id: entry.id,
      attempted_at: new Date().toISOString(),
      ...result,
    });
    attempted += 1;
  }

  return attempted;
}
