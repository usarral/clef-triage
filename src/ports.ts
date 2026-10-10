/**
 * Ports the triage use case depends on (DIP). IMAP, .eml files and the
 * llama.cpp server are interchangeable adapters behind these contracts.
 */
import type { Classification, Email } from './domain.ts';

export interface MailSource {
  fetchUnread(limit?: number): AsyncIterable<Email>;
}

export interface EmailClassifier {
  classify(email: Email): Promise<Classification>;
}

export interface MailLabeler {
  apply(email: Email, classification: Classification): Promise<void>;
}
