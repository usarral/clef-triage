/** Turns a raw RFC 822 message into a domain `Email`. */
import { simpleParser } from 'mailparser';
import type { Email } from '../domain.ts';

export async function parseEmail(uid: string, raw: Buffer): Promise<Email> {
  const parsed = await simpleParser(raw);
  return {
    uid,
    from: parsed.from?.text ?? '',
    subject: parsed.subject ?? '',
    // mailparser derives `text` from the HTML part when there is no plain part,
    // keeping link targets as "label [url]", a key phishing signal.
    body: (parsed.text ?? '').trim(),
    replyTo: parsed.replyTo?.text,
    hasUnsubscribe: hasUnsubscribe(parsed.headers.get('list')),
    messageId: parsed.messageId,
  };
}

/** mailparser folds every `List-*` header into a single structured `list` header. */
function hasUnsubscribe(listHeader: unknown): boolean {
  return typeof listHeader === 'object' && listHeader !== null && 'unsubscribe' in listHeader;
}
