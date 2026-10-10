/**
 * Offline evaluation against the corpus gold labels. Produces the article's
 * numbers: accuracy per field and per subset (ambiguous, English, injection,
 * long), category confusion, review rate and latency.
 */
import { readFile } from 'node:fs/promises';
import type { Classification } from '../domain.ts';
import type { TriageResult } from '../triage/service.ts';

export const FIELDS = ['categoria', 'prioridad', 'es_ruido', 'sospechoso', 'requiere_accion'] as const;
type Field = (typeof FIELDS)[number];
type Labels = Record<Field, string | boolean>;

export interface GoldEmail {
  readonly id: string;
  readonly messageId: string;
  readonly labels: Labels;
  readonly tags: readonly string[];
}

export interface EvaluatedEmail {
  readonly id: string;
  readonly tags: readonly string[];
  readonly gold: Labels;
  readonly predicted: Labels;
  readonly needsReview: boolean;
  readonly elapsedMs: number;
  readonly inputTokens: number;
  readonly answers: unknown;
}

export async function loadGold(jsonlPath: string): Promise<Map<string, GoldEmail>> {
  const lines = (await readFile(jsonlPath, 'utf8')).split('\n').filter(Boolean);
  return new Map(
    lines.map((line) => {
      const row = JSON.parse(line);
      return [row.id, { id: row.id, messageId: row.message_id, labels: row.gold, tags: row.tags }];
    }),
  );
}

export function toLabels(c: Omit<Classification, 'trace'>): Labels {
  return {
    categoria: c.category,
    prioridad: c.priority,
    es_ruido: c.isNoise,
    sospechoso: c.isSuspicious,
    requiere_accion: c.requiresAction,
  };
}

export function compare(results: readonly TriageResult[], gold: Map<string, GoldEmail>): EvaluatedEmail[] {
  return results.flatMap((result) => {
    if (!('classification' in result)) return [];
    const expected = gold.get(result.email.uid);
    if (!expected) return [];
    const c = result.classification;
    return [
      {
        id: expected.id,
        tags: expected.tags,
        gold: expected.labels,
        predicted: toLabels(c),
        needsReview: c.needsReview,
        elapsedMs: c.trace.elapsedMs,
        inputTokens: c.trace.inputTokens,
        answers: c.trace.answers,
      },
    ];
  });
}

/** A line of a `triage` run's `.jsonl`, as written by the CLI. */
export interface TriageRecord {
  readonly messageId?: string;
  readonly decision?: Omit<Classification, 'trace'>;
  readonly answers?: unknown;
  readonly elapsedMs?: number;
  readonly inputTokens?: number;
}

/** Joins a live mailbox run with the gold labels through the Message-ID header. */
export function scoreTriageRecords(records: readonly TriageRecord[], gold: Map<string, GoldEmail>): EvaluatedEmail[] {
  const byMessageId = new Map([...gold.values()].map((g) => [g.messageId, g]));
  return records.flatMap((record) => {
    const expected = record.messageId ? byMessageId.get(record.messageId) : undefined;
    if (!expected || !record.decision) return [];
    return [
      {
        id: expected.id,
        tags: expected.tags,
        gold: expected.labels,
        predicted: toLabels(record.decision),
        needsReview: record.decision.needsReview,
        elapsedMs: record.elapsedMs ?? 0,
        inputTokens: record.inputTokens ?? 0,
        answers: record.answers,
      },
    ];
  });
}

export function renderReport(rows: readonly EvaluatedEmail[], errors: number): string {
  if (rows.length === 0) return `No results (errors: ${errors}).`;
  const lines = [`Emails evaluated: ${rows.length}  (errors: ${errors})`, ''];

  const subsets = new Map<string, EvaluatedEmail[]>([['all', [...rows]]]);
  for (const row of rows) {
    for (const tag of row.tags.length ? row.tags : ['clean']) {
      subsets.set(tag, [...(subsets.get(tag) ?? []), row]);
    }
  }
  lines.push(`${'subset'.padEnd(10)} ${'n'.padStart(4)} ${FIELDS.map((f) => f.padStart(16)).join('')}`);
  for (const [name, subset] of subsets) {
    const scores = FIELDS.map((f) => percent(accuracy(subset, f)).padStart(16)).join('');
    lines.push(`${name.padEnd(10)} ${String(subset.length).padStart(4)} ${scores}`);
  }

  lines.push('', 'Category confusion (gold -> predicted), errors only:');
  const confusion = countBy(
    rows.filter((r) => r.gold.categoria !== r.predicted.categoria),
    (r) => `${r.gold.categoria} -> ${r.predicted.categoria}`,
  );
  for (const [pair, n] of [...confusion].sort((a, b) => b[1] - a[1])) lines.push(`  ${pair.padEnd(34)} ${n}`);

  const review = rows.filter((r) => r.needsReview);
  const reviewWrong = review.filter((r) => r.gold.categoria !== r.predicted.categoria).length;
  const latencies = rows.map((r) => r.elapsedMs).sort((a, b) => a - b);
  lines.push(
    '',
    `Sent to review: ${review.length} (${reviewWrong} of them with a wrong category)`,
    `Latency per email (5 questions, 1 request): p50 ${quantile(latencies, 0.5).toFixed(0)} ms · ` +
      `p95 ${quantile(latencies, 0.95).toFixed(0)} ms`,
    `Input tokens: ${rows.reduce((sum, r) => sum + r.inputTokens, 0)} total · ` +
      `${(rows.reduce((sum, r) => sum + r.inputTokens, 0) / rows.length).toFixed(0)} per email`,
  );
  return lines.join('\n');
}

function accuracy(rows: readonly EvaluatedEmail[], field: Field): number {
  return rows.filter((r) => r.gold[field] === r.predicted[field]).length / rows.length;
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
