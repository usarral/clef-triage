/** Entry point and composition root: the only place that knows concrete classes. */
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { compare, loadGold, renderReport, scoreTriageRecords } from './evaluation/evaluate.ts';
import { FolderLabeler, GmailLabelLabeler, ImapMailbox, ImapSource, KeywordLabeler } from './mail/imap.ts';
import { EmlDirectorySource, NullLabeler } from './mail/local.ts';
import type { MailLabeler } from './ports.ts';
import { RunLog } from './run-log.ts';
import { SystemOneClient } from './system-one/client.ts';
import { SystemOneClassifier } from './triage/classifier.ts';
import { TriageService, type TriageResult } from './triage/service.ts';

const DEFAULT_SYSTEM_ONE_URL = 'http://127.0.0.1:11434/v1/systemone';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    limit: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    // Where to file the message besides IMAP keywords: folders | labels (Gmail) | none
    target: { type: 'string', default: process.env.TRIAGE_TARGET || 'folders' },
    'eml-dir': { type: 'string', default: 'corpus/eml' },
    gold: { type: 'string', default: 'corpus/emails.jsonl' },
    out: { type: 'string', default: 'runs' },
    // Optional run name appended to the log file names, e.g. `--tag v2`
    tag: { type: 'string' },
    // `score`: one or more triage run .jsonl files to compare with the gold labels
    run: { type: 'string', multiple: true },
  },
});
const limit = values.limit ? Number(values.limit) : undefined;
const systemOneUrl = process.env.SYSTEMONE_URL || DEFAULT_SYSTEM_ONE_URL;
const model = process.env.SYSTEMONE_MODEL || undefined;

const client = new SystemOneClient({ url: systemOneUrl, model, apiKey: process.env.SYSTEMONE_API_KEY || undefined });

const commands: Record<string, (log: RunLog) => Promise<number>> = { ping, evaluate, triage, score };
const commandName = positionals[0] ?? '';
const command = commands[commandName];
if (!command) {
  console.error('Usage: cli.ts <ping|evaluate|triage|score> [--limit N] [--dry-run] [--target folders|labels|none]');
  process.exit(2);
}
const log = new RunLog(values.out, [commandName, values.tag].filter(Boolean).join('-'));
log.line(`# clef-triage ${commandName} · ${new Date().toISOString()}`);
log.line(`# model=${model ?? '(server default)'} url=${redactAccountId(systemOneUrl)} ${JSON.stringify(values)}`);
process.exitCode = await command(log);
console.log(`\nRun saved to ${log.logPath}`);

async function ping(log: RunLog): Promise<number> {
  const { answers, elapsedMs } = await client.ask('Subject: the website is down and we cannot sell', {
    urgent: { type: 'noul', instructions: 'Is this urgent?' },
  } as const);
  log.line(`OK · p(urgent)=${answers.urgent.noul.toFixed(3)} · ${elapsedMs.toFixed(0)} ms`);
  return 0;
}

async function evaluate(log: RunLog): Promise<number> {
  const service = new TriageService({
    source: new EmlDirectorySource(values['eml-dir']),
    classifier: new SystemOneClassifier(client),
    labelers: [new NullLabeler()],
    onResult: (result) => log.line(formatResult(result)),
  });
  const results = await service.run(limit);
  const rows = compare(results, await loadGold(values.gold));
  for (const row of rows) log.record(row);

  log.line();
  log.line(renderReport(rows, results.filter((r) => 'error' in r).length));
  return 0;
}

/** Scores live mailbox runs (one or more `.jsonl`) against the corpus gold labels. */
async function score(log: RunLog): Promise<number> {
  const files = values.run ?? [];
  if (files.length === 0) throw new Error('score needs at least one --run <file.jsonl>');
  const records = (await Promise.all(files.map((file) => readFile(file, 'utf8'))))
    .flatMap((text) => text.split('\n').filter(Boolean))
    .map((line) => JSON.parse(line));
  const rows = scoreTriageRecords(records, await loadGold(values.gold));
  for (const row of rows) log.record(row);
  log.line(`Scored ${rows.length} of ${records.length} records from ${files.join(', ')}`);
  log.line();
  log.line(renderReport(rows, records.filter((r) => r.error).length));
  return 0;
}

async function triage(log: RunLog): Promise<number> {
  const mailbox = new ImapMailbox({
    host: requiredEnv('IMAP_HOST'),
    port: Number(process.env.IMAP_PORT || 993),
    user: requiredEnv('IMAP_USER'),
    password: requiredEnv('IMAP_PASSWORD').trim(),
    inbox: process.env.IMAP_INBOX || 'INBOX',
  });
  await mailbox.open();
  try {
    const service = new TriageService({
      source: new ImapSource(mailbox),
      classifier: new SystemOneClassifier(client),
      labelers: buildLabelers(mailbox),
      onResult: (result) => {
        log.line(formatResult(result));
        log.record(toRecord(result));
      },
    });
    const results = await service.run(limit);
    const errors = results.filter((r) => 'error' in r).length;
    log.line();
    log.line(`${results.length} emails processed, ${errors} errors${values['dry-run'] ? ' (dry run)' : ''}.`);
    return errors ? 1 : 0;
  } finally {
    await mailbox.close();
  }
}

function buildLabelers(mailbox: ImapMailbox): MailLabeler[] {
  if (values['dry-run']) return [new NullLabeler()];
  const root = process.env.IMAP_ROOT_FOLDER || 'Clef';
  // Keywords always go first: they carry `$ClefTriaged`, and once a message
  // is moved its UID is no longer valid in the inbox.
  const keywords = new KeywordLabeler(mailbox);
  switch (values.target) {
    case 'folders':
      return [keywords, new FolderLabeler(mailbox, root)];
    case 'labels':
      return [keywords, new GmailLabelLabeler(mailbox, root)];
    case 'none':
      return [keywords];
    default:
      throw new Error(`Unknown --target ${values.target} (folders | labels | none)`);
  }
}

function formatResult(result: TriageResult): string {
  const id = result.email.uid.padEnd(10);
  const subject = result.email.subject.slice(0, 60);
  if ('error' in result) return `${id} ERROR ${result.error} | ${subject}`;

  const c = result.classification;
  const flags = [c.requiresAction && 'A', c.isNoise && 'N', c.isSuspicious && '!', c.needsReview && '?']
    .filter(Boolean)
    .join('');
  return (
    `${id} ${c.category.padEnd(15)} ${c.priority.padEnd(12)} ${flags.padEnd(4)} ` +
    `${c.categoryConfidence.toFixed(2)} ${c.trace.elapsedMs.toFixed(0).padStart(6)}ms | ${subject}`
  );
}

function toRecord(result: TriageResult) {
  const { uid, messageId, from, subject } = result.email;
  if ('error' in result) return { uid, messageId, from, subject, error: result.error };
  const { trace, ...decision } = result.classification;
  return { uid, messageId, from, subject, decision, ...trace };
}

/** Run logs are committed, so keep Cloudflare account IDs out of them. */
function redactAccountId(url: string): string {
  return url.replace(/\/accounts\/[^/]+\//, '/accounts/<ACCOUNT_ID>/');
}

function requiredEnv(...names: string[]): string {
  const value = names.map((name) => process.env[name]).find(Boolean);
  if (!value) throw new Error(`Missing environment variable ${names.join(' or ')} (see .env.example)`);
  return value;
}
