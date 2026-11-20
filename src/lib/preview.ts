/**
 * Folds long free text (Progress, Money at stake and so on) so a task card
 * stays short on a phone. The text itself is never changed: the preview is the
 * start of the text, cut between words, and the rest sits behind a toggle.
 */

/** Text up to this length, on at most LONG_TEXT_LINES lines, is shown in full. */
export const LONG_TEXT_CHARS = 160;
/** A few short lines are cheaper to show than a toggle: only more lines than this are folded. */
export const LONG_TEXT_LINES = 5;
/** The most a folded text shows before the "…". */
export const PREVIEW_CHARS = 110;
export const PREVIEW_LINES = 3;

export interface ClippedText {
  /** What to show while folded: the whole text, or its beginning. */
  text: string;
  /** True when part of the text is hidden. */
  clipped: boolean;
}

export function clipText(text: string): ClippedText {
  const lines = text.split('\n');
  if (text.length <= LONG_TEXT_CHARS && lines.length <= LONG_TEXT_LINES) return { text, clipped: false };

  let preview = lines.slice(0, PREVIEW_LINES).join('\n');
  if (preview.length > PREVIEW_CHARS) {
    // Cut at the last gap between words, so no word or web address is split.
    // A first word longer than the limit is kept whole.
    let cut: number | null = null;
    for (const gap of preview.matchAll(/\s+/g)) {
      if (gap.index > PREVIEW_CHARS && cut !== null) break;
      cut = gap.index;
      if (gap.index > PREVIEW_CHARS) break;
    }
    if (cut !== null) preview = preview.slice(0, cut);
  }
  preview = preview.trimEnd();
  return preview.length < text.length ? { text: preview, clipped: true } : { text, clipped: false };
}
