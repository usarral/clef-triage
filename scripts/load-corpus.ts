/**
 * Loads the .eml corpus into an IMAP mailbox as unread messages, oldest first,
 * keeping each email's original date. Messages whose Message-ID already exists
 * in the target folder are skipped unless --force is given.
 *
 * Usage: npm run corpus:load -- [--limit N] [--folder INBOX] [--dry-run] [--force] [--delay ms]
 * Credentials come from .env: IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASSWORD.
 */
import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { ImapFlow } from 'imapflow';

interface CorpusItem {
  readonly id: string;
  readonly path: string;
  readonly date: Date;
  readonly subject: string;
  readonly messageId?: string;
}

const { values: args } = parseArgs({
  options: {
    limit: { type: 'string' },
    folder: { type: 'string', default: 'INBOX' },
    'eml-dir': { type: 'string', default: 'corpus/eml' },
    jsonl: { type: 'string', default: 'corpus/emails.jsonl' },
    'dry-run': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    delay: { type: 'string', default: '30' },
  },
});

const items = (await loadCorpus(args['eml-dir'], args.jsonl)).slice(0, args.limit ? Number(args.limit) : undefined);
console.log(`${items.length} emails to load into '${args.folder}'${args['dry-run'] ? ' (dry run)' : ''}`);

if (args['dry-run']) {
  items.forEach((item, i) => console.log(`[${i + 1}/${items.length}] ${item.id} | ${item.date.toISOString()} | ${item.subject}`));
} else {
  await upload(items);
}

async function loadCorpus(emlDir: string, jsonlPath: string): Promise<CorpusItem[]> {
  const metadata = new Map<string, { date?: string; subject?: string; message_id?: string }>();
  for (const line of (await readFile(jsonlPath, 'utf8')).split('\n').filter(Boolean)) {
    const row = JSON.parse(line);
    metadata.set(row.id, row);
  }

  const files = (await readdir(emlDir)).filter((f) => f.endsWith('.eml'));
  const items = files.map((file) => {
    const id = basename(file, '.eml');
    const meta = metadata.get(id);
    return {
      id,
      path: join(emlDir, file),
      date: meta?.date ? new Date(meta.date) : new Date(),
      subject: meta?.subject ?? id,
      messageId: meta?.message_id,
    };
  });
  // Oldest first, so the mailbox looks like it was received over time.
  return items.sort((a, b) => a.date.getTime() - b.date.getTime());
}

async function upload(items: readonly CorpusItem[]): Promise<void> {
  const client = new ImapFlow({
    host: requiredEnv('IMAP_HOST'),
    port: Number(process.env.IMAP_PORT || 993),
    secure: true,
    auth: { user: requiredEnv('IMAP_USER'), pass: requiredEnv('IMAP_PASSWORD').trim() },
    logger: false,
  });
  await client.connect();
  try {
    const existing = args.force ? new Set<string>() : await existingMessageIds(client, args.folder);
    const delayMs = Number(args.delay);
    let uploaded = 0;
    let skipped = 0;
    let failed = 0;

    for (const [i, item] of items.entries()) {
      const progress = `[${i + 1}/${items.length}]`;
      if (item.messageId && existing.has(normalizeMessageId(item.messageId))) {
        skipped++;
        console.log(`${progress} skipped (already in mailbox): ${item.id}`);
        continue;
      }
      try {
        // No flags means no \Seen, so the message arrives unread.
        await client.append(args.folder, await readFile(item.path), [], item.date);
        uploaded++;
        console.log(`${progress} ok: ${item.id} | ${item.subject.slice(0, 55)}`);
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      } catch (error) {
        failed++;
        console.error(`${progress} error in ${item.id}: ${error instanceof Error ? error.message : error}`);
      }
    }

    console.log(`\nUploaded ${uploaded}, skipped ${skipped}, failed ${failed}.`);
    const status = await client.status(args.folder, { messages: true, unseen: true });
    if (status) console.log(`'${args.folder}' now has ${status.messages} messages, ${status.unseen} unread.`);
  } finally {
    await client.logout();
  }
}

async function existingMessageIds(client: ImapFlow, folder: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const lock = await client.getMailboxLock(folder);
  try {
    if (client.mailbox && client.mailbox.exists > 0) {
      for await (const message of client.fetch('1:*', { envelope: true })) {
        if (message.envelope?.messageId) ids.add(normalizeMessageId(message.envelope.messageId));
      }
    }
  } finally {
    lock.release();
  }
  return ids;
}

function normalizeMessageId(id: string): string {
  return id.trim().replace(/^<|>$/g, '');
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}
