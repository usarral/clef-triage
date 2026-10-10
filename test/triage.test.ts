import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { CATEGORIES, type Classification, type Email } from '../src/domain.ts';
import { parseEmail } from '../src/mail/parse.ts';
import type { SystemOneAsker } from '../src/system-one/client.ts';
import { unwrap } from '../src/system-one/client.ts';
import { DEFAULT_POLICY, SystemOneClassifier, needsReview } from '../src/triage/classifier.ts';
import { folderFor, keywordsFor, labelsFor } from '../src/triage/routing.ts';
import { TriageService } from '../src/triage/service.ts';

const CORPUS_DIR = join(import.meta.dirname, '..', 'corpus', 'eml');

const EMAIL: Email = { uid: '1', from: 'a@b.example', subject: 'The app is down', body: 'We cannot log in', hasUnsubscribe: false };

function fakeAnswers(overrides: Record<string, unknown> = {}) {
  return {
    categoria: {
      type: 'choice',
      choice: 'soporte',
      probabilities: Object.fromEntries(CATEGORIES.map((c) => [c, c === 'soporte' ? 0.9 : 0.02])),
      confidence: 0.8,
    },
    prioridad: { type: 'score', score: 2.5, probabilities: { 0: 0.05, 1: 0.1, 2: 0.15, 3: 0.7 }, confidence: 0.6 },
    es_ruido: { type: 'noul', noul: 0.1 },
    sospechoso: { type: 'noul', noul: 0.1 },
    requiere_accion: { type: 'noul', noul: 0.9 },
    ...overrides,
  };
}

class FakeClient implements SystemOneAsker {
  readonly calls: { state: unknown; questions: object }[] = [];
  readonly #answers: object;

  constructor(answers: object) {
    this.#answers = answers;
  }

  async ask(state: unknown, questions: object) {
    this.calls.push({ state, questions });
    return { answers: this.#answers as never, inputTokens: 100, elapsedMs: 42 };
  }
}

function classification(overrides: Partial<Classification> = {}): Classification {
  return {
    category: 'soporte',
    priority: 'Alta',
    isNoise: false,
    isSuspicious: false,
    requiresAction: true,
    categoryConfidence: 0.9,
    needsReview: false,
    trace: { answers: {}, elapsedMs: 0, inputTokens: 0 },
    ...overrides,
  };
}

describe('SystemOneClassifier', () => {
  it('maps answers to a domain classification', async () => {
    const result = await new SystemOneClassifier(new FakeClient(fakeAnswers())).classify(EMAIL);

    assert.equal(result.category, 'soporte');
    assert.equal(result.priority, 'Crítica', 'uses the argmax level, not the weighted score');
    assert.equal(result.requiresAction, true);
    assert.equal(result.isNoise, false);
    assert.equal(result.isSuspicious, false);
    assert.equal(result.needsReview, false);
  });

  it('sends all questions in a single request', async () => {
    const client = new FakeClient(fakeAnswers());
    await new SystemOneClassifier(client).classify(EMAIL);

    assert.equal(client.calls.length, 1);
    assert.deepEqual(Object.keys(client.calls[0]!.questions).sort(), [
      'categoria',
      'es_ruido',
      'prioridad',
      'requiere_accion',
      'sospechoso',
    ]);
  });
});

describe('needsReview', () => {
  const cases = [
    { name: 'small margin', category: 'ventas', probs: { ventas: 0.48, facturacion: 0.45, otro: 0.07 }, expected: true },
    { name: 'low confidence', category: 'ventas', probs: { ventas: 0.45, facturacion: 0.2, otro: 0.35 }, expected: true },
    { name: 'escape option', category: 'otro', probs: { otro: 0.9, ventas: 0.1 }, expected: true },
    { name: 'clear winner', category: 'ventas', probs: { ventas: 0.8, facturacion: 0.2 }, expected: false },
  ] as const;

  for (const { name, category, probs, expected } of cases) {
    it(name, () => assert.equal(needsReview(category, probs, DEFAULT_POLICY), expected));
  }
});

describe('routing', () => {
  it('lets security win over topic', () => {
    assert.equal(folderFor(classification({ isSuspicious: true, isNoise: true })), 'Sospechoso');
    assert.equal(folderFor(classification({ isNoise: true })), 'Ruido');
    assert.equal(folderFor(classification({ needsReview: true })), 'Revisar');
    assert.equal(folderFor(classification()), 'Soporte');
  });

  it('nests Gmail labels under the root', () => {
    const labels = labelsFor(classification({ priority: 'Crítica', isSuspicious: true }), 'Clef');
    assert.deepEqual(labels, ['Clef/Soporte', 'Clef/Prioridad/Critica', 'Clef/Accion', 'Clef/Sospechoso']);
  });

  it('produces ASCII keywords without spaces', () => {
    const keywords = keywordsFor(classification({ priority: 'Crítica' }));
    assert.ok(keywords.includes('$Clef_prio_critica'));
    assert.ok(keywords.every((k) => /^[\x21-\x7e]+$/.test(k)));
  });
});

describe('TriageService', () => {
  it('isolates failures so one bad email does not stop the batch', async () => {
    const service = new TriageService({
      source: {
        async *fetchUnread() {
          yield EMAIL;
          yield EMAIL;
        },
      },
      classifier: {
        classify: async () => {
          throw new Error('boom');
        },
      },
      labelers: [],
    });

    const results = await service.run();
    assert.deepEqual(
      results.map((r) => ('error' in r ? r.error : null)),
      ['boom', 'boom'],
    );
  });
});

describe('unwrap', () => {
  it('accepts the Cloudflare REST envelope', () => {
    assert.deepEqual(unwrap({ result: { answers: { x: {} } } }).answers, { x: {} });
  });

  it('rejects bodies without answers', () => {
    assert.throws(() => unwrap({}));
  });
});

describe('parseEmail', { skip: !existsSync(CORPUS_DIR) && 'corpus not available' }, () => {
  it('parses the whole corpus, including HTML-only and quoted-printable mail', async () => {
    const files = (await readdir(CORPUS_DIR)).filter((f) => f.endsWith('.eml'));
    const emails = await Promise.all(files.map(async (f) => parseEmail(f, await readFile(join(CORPUS_DIR, f)))));

    assert.ok(emails.length > 200);
    assert.ok(emails.every((e) => e.subject && e.body));
    assert.ok(emails.some((e) => e.replyTo));
    assert.ok(emails.some((e) => e.hasUnsubscribe));
  });
});
