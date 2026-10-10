/**
 * Pure rules mapping a classification to a folder and IMAP keywords.
 * Kept away from IMAP so they can change (and be tested) without a network.
 */
import type { Classification } from '../domain.ts';

export const TRIAGED_KEYWORD = '$ClefTriaged';

/** One folder per message. Security wins over topic. */
export function folderFor(c: Classification): string {
  if (c.isSuspicious) return 'Sospechoso';
  if (c.isNoise) return 'Ruido';
  if (c.needsReview) return 'Revisar';
  return capitalize(c.category);
}

/** Gmail labels: several per message, nested under `root` so they group in the sidebar. */
export function labelsFor(c: Classification, root: string): string[] {
  const labels = [`${root}/${capitalize(c.category)}`, `${root}/Prioridad/${slug(c.priority, false)}`];
  if (c.requiresAction) labels.push(`${root}/Accion`);
  if (c.isSuspicious) labels.push(`${root}/Sospechoso`);
  if (c.isNoise) labels.push(`${root}/Ruido`);
  if (c.needsReview) labels.push(`${root}/Revisar`);
  return labels;
}

/** IMAP keywords must be ASCII atoms with no spaces, hence the slug. */
export function keywordsFor(c: Classification): string[] {
  const keywords = [TRIAGED_KEYWORD, `$Clef_${c.category}`, `$Clef_prio_${slug(c.priority)}`];
  if (c.requiresAction) keywords.push('$Clef_accion');
  if (c.isSuspicious) keywords.push('$Clef_sospechoso');
  if (c.isNoise) keywords.push('$Clef_ruido');
  if (c.needsReview) keywords.push('$Clef_revisar');
  return keywords;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function slug(text: string, lowercase = true): string {
  const ascii = text.normalize('NFKD').replace(/[^\x20-\x7e]/g, '');
  return lowercase ? ascii.toLowerCase() : ascii;
}
