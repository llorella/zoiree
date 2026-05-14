import { mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sanitizeFilePart } from "./handle";
import type {
  BootstrapInvite,
  FederationEnvelope,
  InboxAction,
  InboxItem,
  NotificationEvent,
  OutboxAttempt,
  OutboxEntry,
  PartyRecord,
  PeerRecord,
} from "./types";

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function ensureParent(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

export class FederationStore {
  readonly peersDir: string;
  readonly partiesDir: string;
  readonly messagesDir: string;
  readonly seenDir: string;
  readonly bootstrapInvitesDir: string;

  constructor(readonly root: string) {
    this.peersDir = join(root, "peers");
    this.partiesDir = join(root, "parties");
    this.messagesDir = join(root, "messages");
    this.seenDir = join(root, "seen");
    this.bootstrapInvitesDir = join(root, "bootstrap_invites");
  }

  async init(): Promise<void> {
    await mkdir(this.peersDir, { recursive: true });
    await mkdir(this.partiesDir, { recursive: true });
    await mkdir(this.messagesDir, { recursive: true });
    await mkdir(this.seenDir, { recursive: true });
    await mkdir(this.bootstrapInvitesDir, { recursive: true });
  }

  peerPath(handle: string): string {
    return join(this.peersDir, `${sanitizeFilePart(handle)}.json`);
  }

  partyPath(partyId: string): string {
    return join(this.partiesDir, `${sanitizeFilePart(partyId)}.json`);
  }

  messagesPath(partyId: string): string {
    return join(this.messagesDir, `${sanitizeFilePart(partyId)}.jsonl`);
  }

  bootstrapInvitePath(code: string): string {
    return join(this.bootstrapInvitesDir, `${sanitizeFilePart(code)}.json`);
  }

  async readJson<T>(path: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async writeJsonAtomic(path: string, value: unknown): Promise<void> {
    await ensureParent(path);
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
    await rename(tmp, path);
  }

  async appendJsonl(path: string, value: unknown): Promise<void> {
    await ensureParent(path);
    const file = await open(path, "a");
    try {
      await file.appendFile(`${JSON.stringify(value)}\n`);
    } finally {
      await file.close();
    }
  }

  async readJsonl<T>(path: string): Promise<T[]> {
    try {
      const text = await readFile(path, "utf8");
      return text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as T);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async getPeer(handle: string): Promise<PeerRecord | null> {
    return this.readJson<PeerRecord>(this.peerPath(handle));
  }

  async savePeer(peer: PeerRecord): Promise<void> {
    await this.writeJsonAtomic(this.peerPath(peer.handle), peer);
  }

  async getParty(partyId: string): Promise<PartyRecord | null> {
    return this.readJson<PartyRecord>(this.partyPath(partyId));
  }

  async saveParty(party: PartyRecord): Promise<void> {
    await this.writeJsonAtomic(this.partyPath(party.party_id), party);
  }

  async getBootstrapInvite(code: string): Promise<BootstrapInvite | null> {
    return this.readJson<BootstrapInvite>(this.bootstrapInvitePath(code));
  }

  async saveBootstrapInvite(invite: BootstrapInvite): Promise<void> {
    await this.writeJsonAtomic(this.bootstrapInvitePath(invite.code), invite);
  }

  async markSeen(id: string, envelope: FederationEnvelope): Promise<boolean> {
    const marker = join(this.seenDir, `${sanitizeFilePart(id)}.json`);
    await ensureParent(marker);

    let file;
    try {
      file = await open(marker, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }

    try {
      await file.writeFile(
        `${JSON.stringify({
          id,
          from: envelope.from,
          kind: envelope.kind,
          seen_at: new Date().toISOString(),
        })}\n`,
      );
    } finally {
      await file.close();
    }

    await this.appendJsonl(join(this.root, "seen_ids.jsonl"), {
      id,
      from: envelope.from,
      kind: envelope.kind,
      seen_at: new Date().toISOString(),
    });
    return true;
  }

  async appendInvite(envelope: FederationEnvelope): Promise<void> {
    await this.appendJsonl(join(this.root, "invites.jsonl"), envelope);
  }

  async invites(): Promise<FederationEnvelope[]> {
    return this.readJsonl<FederationEnvelope>(join(this.root, "invites.jsonl"));
  }

  async appendMessage(envelope: FederationEnvelope): Promise<void> {
    if (!envelope.party_id) throw new Error("party_id is required");
    await this.appendJsonl(this.messagesPath(envelope.party_id), envelope);
  }

  async messagesSince(
    partyId: string,
    since?: string | null,
  ): Promise<FederationEnvelope[]> {
    const messages = await this.readJsonl<FederationEnvelope>(
      this.messagesPath(partyId),
    );
    if (!since) return messages;

    const index = messages.findIndex((message) => message.id === since);
    if (index < 0) return messages;
    return messages.slice(index + 1);
  }

  async appendNotification(event: NotificationEvent): Promise<void> {
    await this.appendJsonl(join(this.root, "notifications.jsonl"), event);
  }

  async notifications(): Promise<NotificationEvent[]> {
    return this.readJsonl<NotificationEvent>(join(this.root, "notifications.jsonl"));
  }

  async appendInbox(item: InboxItem): Promise<void> {
    await this.appendJsonl(join(this.root, "inbox.jsonl"), item);
  }

  async inboxItems(): Promise<InboxItem[]> {
    return this.readJsonl<InboxItem>(join(this.root, "inbox.jsonl"));
  }

  async appendInboxAction(action: InboxAction): Promise<void> {
    await this.appendJsonl(join(this.root, "inbox_actions.jsonl"), action);
  }

  async inboxActions(): Promise<InboxAction[]> {
    return this.readJsonl<InboxAction>(join(this.root, "inbox_actions.jsonl"));
  }

  async appendOutbox(entry: OutboxEntry): Promise<void> {
    await this.appendJsonl(join(this.root, "outbox.jsonl"), entry);
  }

  async appendOutboxAttempt(attempt: OutboxAttempt): Promise<void> {
    await this.appendJsonl(join(this.root, "outbox_attempts.jsonl"), attempt);
  }

  async outboxEntries(): Promise<OutboxEntry[]> {
    return this.readJsonl<OutboxEntry>(join(this.root, "outbox.jsonl"));
  }

  async outboxAttempts(): Promise<OutboxAttempt[]> {
    return this.readJsonl<OutboxAttempt>(join(this.root, "outbox_attempts.jsonl"));
  }

  async hasSeen(id: string): Promise<boolean> {
    return exists(join(this.seenDir, `${sanitizeFilePart(id)}.json`));
  }
}
