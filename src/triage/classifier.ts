/** Turns System One probabilities into a domain decision. */
import { CATEGORIES, PRIORITIES, type Category, type Classification, type Email, type Priority } from '../domain.ts';
import type { EmailClassifier } from '../ports.ts';
import type { SystemOneAsker } from '../system-one/client.ts';
import { TRIAGE_QUESTIONS, buildState } from './questions.ts';

export interface DecisionPolicy {
  readonly noulThreshold: number;
  readonly minCategoryConfidence: number;
  /** Minimum gap between the two most likely categories; below it, send to review. */
  readonly minCategoryMargin: number;
}

export const DEFAULT_POLICY: DecisionPolicy = {
  noulThreshold: 0.5,
  minCategoryConfidence: 0.5,
  minCategoryMargin: 0.15,
};

export function needsReview(category: Category, probabilities: Record<string, number>, policy: DecisionPolicy) {
  const [top = 0, second = 0] = Object.values(probabilities).sort((a, b) => b - a);
  return category === 'otro' || top < policy.minCategoryConfidence || top - second < policy.minCategoryMargin;
}

export class SystemOneClassifier implements EmailClassifier {
  readonly #client: SystemOneAsker;
  readonly #policy: DecisionPolicy;

  constructor(client: SystemOneAsker, policy: DecisionPolicy = DEFAULT_POLICY) {
    this.#client = client;
    this.#policy = policy;
  }

  async classify(email: Email): Promise<Classification> {
    const { answers, elapsedMs, inputTokens } = await this.#client.ask(buildState(email), TRIAGE_QUESTIONS);
    const policy = this.#policy;
    const category = parseCategory(answers.categoria.choice);
    const probabilities = answers.categoria.probabilities;

    return {
      category,
      priority: mostLikelyLevel(answers.prioridad.probabilities),
      isNoise: answers.es_ruido.noul >= policy.noulThreshold,
      isSuspicious: answers.sospechoso.noul >= policy.noulThreshold,
      requiresAction: answers.requiere_accion.noul >= policy.noulThreshold,
      categoryConfidence: Math.max(...Object.values(probabilities)),
      needsReview: needsReview(category, probabilities, policy),
      trace: { answers, elapsedMs, inputTokens },
    };
  }
}

function parseCategory(value: string): Category {
  if (!(CATEGORIES as readonly string[]).includes(value)) throw new Error(`Unknown category: ${value}`);
  return value as Category;
}

/**
 * `score` is a probability-weighted mean and can land between levels,
 * so for a discrete decision we take the argmax of the distribution.
 */
function mostLikelyLevel(probabilities: Record<string, number>): Priority {
  const [index] = Object.entries(probabilities).reduce((best, entry) => (entry[1] > best[1] ? entry : best));
  const priority = PRIORITIES[Number(index)];
  if (!priority) throw new Error(`Unknown priority level: ${index}`);
  return priority;
}
