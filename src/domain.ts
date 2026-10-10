/**
 * Domain model: what an email is and what we decide about it.
 * Knows nothing about IMAP or the model; outer layers translate to/from here.
 */

export const CATEGORIES = ['facturacion', 'soporte', 'ventas', 'notificaciones', 'personal', 'otro'] as const;
export type Category = (typeof CATEGORIES)[number];

/** Ordered from least to most urgent: the index matters. */
export const PRIORITIES = ['Informativo', 'Normal', 'Alta', 'Crítica'] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface Email {
  readonly uid: string;
  readonly from: string;
  readonly subject: string;
  readonly body: string;
  readonly replyTo?: string;
  readonly hasUnsubscribe: boolean;
  readonly messageId?: string;
}

export interface Classification {
  readonly category: Category;
  readonly priority: Priority;
  readonly isNoise: boolean;
  readonly isSuspicious: boolean;
  readonly requiresAction: boolean;
  readonly categoryConfidence: number;
  readonly needsReview: boolean;
  /** Raw model output, kept for auditing and for the article. */
  readonly trace: ClassificationTrace;
}

export interface ClassificationTrace {
  readonly answers: unknown;
  readonly elapsedMs: number;
  readonly inputTokens: number;
}
