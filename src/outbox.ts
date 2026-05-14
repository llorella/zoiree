import type { FederationStore } from "./store";
import type { OutboxEntry } from "./types";

export async function sendOutboxEntry(entry: OutboxEntry): Promise<{
  ok: boolean;
  status?: number;
  error?: string;
}> {
  try {
    const response = await fetch(entry.url, {
      method: entry.method,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(entry.envelope),
      signal: AbortSignal.timeout(20_000),
    });

    return {
      ok: response.ok,
      status: response.status,
      ...(response.ok ? {} : { error: await response.text() }),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

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

    const result = await sendOutboxEntry(entry);
    await store.appendOutboxAttempt({
      id: entry.id,
      attempted_at: new Date().toISOString(),
      ...result,
    });
    attempted += 1;
  }

  return attempted;
}
