/**
 * Keeps a record of every run under `runs/`: a human-readable `.log` mirroring
 * the console and a `.jsonl` with one structured record per email (including
 * raw model probabilities). Material for the article and for later analysis.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export class RunLog {
  readonly logPath: string;
  readonly jsonlPath: string;

  constructor(directory: string, command: string) {
    mkdirSync(directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = join(directory, `${stamp}-${command}`);
    this.logPath = `${base}.log`;
    this.jsonlPath = `${base}.jsonl`;
  }

  /** Prints to the console and appends the same line to the `.log`. */
  line(text = ''): void {
    console.log(text);
    appendFileSync(this.logPath, text + '\n');
  }

  record(entry: unknown): void {
    appendFileSync(this.jsonlPath, JSON.stringify(entry) + '\n');
  }
}
