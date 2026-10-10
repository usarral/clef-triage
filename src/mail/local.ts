/** Local adapters: read the .eml corpus from disk and a no-op labeler. */
import { readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Email } from '../domain.ts';
import type { MailLabeler, MailSource } from '../ports.ts';
import { parseEmail } from './parse.ts';

export class EmlDirectorySource implements MailSource {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = directory;
  }

  async *fetchUnread(limit?: number): AsyncIterable<Email> {
    const files = (await readdir(this.#directory)).filter((f) => f.endsWith('.eml')).sort().slice(0, limit);
    for (const file of files) {
      yield parseEmail(basename(file, '.eml'), await readFile(join(this.#directory, file)));
    }
  }
}

/** Touches nothing; used for `--dry-run` and evaluation. */
export class NullLabeler implements MailLabeler {
  async apply(): Promise<void> {}
}
