/** Use case: read → classify → label. Depends on ports only. */
import type { Classification, Email } from '../domain.ts';
import type { EmailClassifier, MailLabeler, MailSource } from '../ports.ts';

export type TriageResult =
  | { readonly email: Email; readonly classification: Classification }
  | { readonly email: Email; readonly error: string };

export interface TriageServiceDeps {
  readonly source: MailSource;
  readonly classifier: EmailClassifier;
  /** Applied in order. Order matters: tag before moving, a move invalidates the UID. */
  readonly labelers: readonly MailLabeler[];
  readonly onResult?: (result: TriageResult) => void;
}

export class TriageService {
  readonly #deps: TriageServiceDeps;

  constructor(deps: TriageServiceDeps) {
    this.#deps = deps;
  }

  async run(limit?: number): Promise<TriageResult[]> {
    const results: TriageResult[] = [];
    for await (const email of this.#deps.source.fetchUnread(limit)) {
      const result = await this.#process(email);
      this.#deps.onResult?.(result);
      results.push(result);
    }
    return results;
  }

  async #process(email: Email): Promise<TriageResult> {
    try {
      const classification = await this.#deps.classifier.classify(email);
      for (const labeler of this.#deps.labelers) await labeler.apply(email, classification);
      return { email, classification };
    } catch (error) {
      // One bad message must not stop the batch.
      return { email, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
