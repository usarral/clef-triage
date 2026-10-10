/**
 * IMAP adapters built on imapflow.
 *
 * - Fetching `source` uses BODY.PEEK, so messages stay unread.
 * - `$ClefTriaged` makes runs idempotent: a second run skips tagged mail.
 * - Everything goes by UID, which stays stable while other messages move.
 */
import { ImapFlow, type MailboxLockObject } from 'imapflow';
import type { Classification, Email } from '../domain.ts';
import type { MailLabeler, MailSource } from '../ports.ts';
import { TRIAGED_KEYWORD, folderFor, keywordsFor, labelsFor } from '../triage/routing.ts';
import { parseEmail } from './parse.ts';

export interface ImapSettings {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly inbox: string;
}

/** Owns the connection and the inbox lock; the adapters below share it. */
export class ImapMailbox {
  readonly #client: ImapFlow;
  readonly #inbox: string;
  #lock?: MailboxLockObject;

  constructor(settings: ImapSettings) {
    this.#inbox = settings.inbox;
    this.#client = new ImapFlow({
      host: settings.host,
      port: settings.port,
      secure: true,
      auth: { user: settings.user, pass: settings.password },
      logger: false,
    });
  }

  async open(): Promise<void> {
    await this.#client.connect();
    this.#lock = await this.#client.getMailboxLock(this.#inbox);
  }

  async close(): Promise<void> {
    this.#lock?.release();
    await this.#client.logout();
  }

  async searchUntriagedUnseen(): Promise<number[]> {
    const uids = await this.#client.search({ seen: false, unKeyword: TRIAGED_KEYWORD }, { uid: true });
    return uids || [];
  }

  async fetchRaw(uid: number): Promise<Buffer> {
    const message = await this.#client.fetchOne(String(uid), { source: true }, { uid: true });
    if (!message || !message.source) throw new Error(`Message UID ${uid} not found`);
    return message.source;
  }

  async addKeywords(uid: number, keywords: string[]): Promise<void> {
    await this.#client.messageFlagsAdd(String(uid), keywords, { uid: true });
  }

  /** Gmail only (X-GM-LABELS). Gmail creates missing labels on the fly. */
  async addGmailLabels(uid: number, labels: string[]): Promise<void> {
    const ok = await this.#client.messageFlagsAdd(String(uid), labels, { uid: true, useLabels: true });
    if (!ok) throw new Error(`Could not label UID ${uid}`);
  }

  /** Path segments are joined with the server's own delimiter ("/" or "."). */
  async move(uid: number, folder: string[]): Promise<void> {
    await this.#client.mailboxCreate(folder); // No-op if it already exists.
    const moved = await this.#client.messageMove(String(uid), folder, { uid: true });
    if (!moved) throw new Error(`Could not move UID ${uid} to ${folder.join('/')}`);
  }
}

export class ImapSource implements MailSource {
  readonly #mailbox: ImapMailbox;

  constructor(mailbox: ImapMailbox) {
    this.#mailbox = mailbox;
  }

  async *fetchUnread(limit?: number): AsyncIterable<Email> {
    const uids = (await this.#mailbox.searchUntriagedUnseen()).slice(0, limit);
    for (const uid of uids) {
      yield parseEmail(String(uid), await this.#mailbox.fetchRaw(uid));
    }
  }
}

/** Tags with IMAP keywords; Thunderbird and most clients show them as tags. */
export class KeywordLabeler implements MailLabeler {
  readonly #mailbox: ImapMailbox;

  constructor(mailbox: ImapMailbox) {
    this.#mailbox = mailbox;
  }

  async apply(email: Email, classification: Classification): Promise<void> {
    await this.#mailbox.addKeywords(Number(email.uid), keywordsFor(classification));
  }
}

/**
 * Gmail labels: visible in the web UI and, unlike a move, the message stays
 * in the inbox carrying several labels at once.
 */
export class GmailLabelLabeler implements MailLabeler {
  readonly #mailbox: ImapMailbox;
  readonly #root: string;

  constructor(mailbox: ImapMailbox, root = 'Clef') {
    this.#mailbox = mailbox;
    this.#root = root;
  }

  async apply(email: Email, classification: Classification): Promise<void> {
    await this.#mailbox.addGmailLabels(Number(email.uid), labelsFor(classification, this.#root));
  }
}

/** Moves each message to `<root>/<Folder>`. */
export class FolderLabeler implements MailLabeler {
  readonly #mailbox: ImapMailbox;
  readonly #root: string;

  constructor(mailbox: ImapMailbox, root = 'Clef') {
    this.#mailbox = mailbox;
    this.#root = root;
  }

  async apply(email: Email, classification: Classification): Promise<void> {
    await this.#mailbox.move(Number(email.uid), [this.#root, folderFor(classification)]);
  }
}
