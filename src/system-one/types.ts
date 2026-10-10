/**
 * System One wire format. A decision model does not generate text: it receives
 * a `state` plus typed questions and returns probabilities in one forward pass.
 */

export interface NoulQuestion {
  readonly type: 'noul';
  readonly instructions: string;
  readonly criteria?: { readonly true: string; readonly false: string };
}

export interface ChoiceQuestion {
  readonly type: 'choice';
  readonly instructions: string;
  /** 2..255 options. A `null` description is allowed. */
  readonly criteria: Readonly<Record<string, string | null>>;
}

export interface ScoreQuestion {
  readonly type: 'score';
  readonly instructions: string;
  /** 2..10 ordered levels, lowest first. */
  readonly criteria: readonly string[];
}

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type Questions = Readonly<Record<string, Question>>;

export interface NoulAnswer {
  readonly type: 'noul';
  /** p(true), 0..1 */
  readonly noul: number;
}

export interface ChoiceAnswer {
  readonly type: 'choice';
  readonly choice: string;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
}

export interface ScoreAnswer {
  readonly type: 'score';
  /** Probability-weighted mean; may fall between levels. */
  readonly score: number;
  /** Keyed by level index as a string: "0", "1", ... */
  readonly probabilities: Readonly<Record<string, number>>;
  readonly legend?: Readonly<Record<string, string>>;
  readonly confidence: number;
}

export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

/** Maps each question type to its answer type, so answers can be typed per question. */
export type AnswersFor<Q extends Questions> = {
  readonly [K in keyof Q]: Q[K] extends NoulQuestion ? NoulAnswer : Q[K] extends ChoiceQuestion ? ChoiceAnswer : ScoreAnswer;
};

export interface SystemOneResponse<Q extends Questions> {
  readonly answers: AnswersFor<Q>;
  readonly inputTokens: number;
  readonly elapsedMs: number;
}
