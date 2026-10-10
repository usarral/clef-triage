/**
 * Minimal System One HTTP client. Works with llama.cpp (`/v1/systemone`) and
 * with compatible hosted endpoints (TypeSafe, Workers AI), which wrap the
 * response slightly differently.
 */
import type { Questions, SystemOneResponse } from './types.ts';

export interface SystemOneClientOptions {
  readonly url: string;
  readonly model?: string;
  readonly apiKey?: string;
  readonly timeoutMs?: number;
}

export interface SystemOneAsker {
  ask<Q extends Questions>(state: unknown, questions: Q): Promise<SystemOneResponse<Q>>;
}

export class SystemOneError extends Error {}

export class SystemOneClient implements SystemOneAsker {
  readonly #options: SystemOneClientOptions;

  constructor(options: SystemOneClientOptions) {
    this.#options = options;
  }

  async ask<Q extends Questions>(state: unknown, questions: Q): Promise<SystemOneResponse<Q>> {
    const { url, model, apiKey, timeoutMs = 60_000 } = this.#options;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;

    const startedAt = performance.now();
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ state, questions, ...(model && { model }) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const elapsedMs = performance.now() - startedAt;

    if (!response.ok) {
      throw new SystemOneError(`HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    }
    const body = unwrap(await response.json());
    return {
      answers: body.answers as SystemOneResponse<Q>['answers'],
      inputTokens: body.usage?.input_tokens ?? 0,
      elapsedMs,
    };
  }
}

interface RawBody {
  answers?: unknown;
  usage?: { input_tokens?: number };
  result?: RawBody;
}

/** Normalizes the known envelopes to `{ answers, usage }`. */
export function unwrap(raw: RawBody): RawBody & { answers: unknown } {
  const body = raw.result ?? raw; // Cloudflare REST: { success, result, errors }
  if (body.answers === undefined) {
    throw new SystemOneError(`Response has no 'answers': ${JSON.stringify(raw).slice(0, 500)}`);
  }
  return body as RawBody & { answers: unknown };
}
