/**
 * LinkifiedText
 *
 * Spec 2026-05-26 Mapping-Notes Pretty Rendering -- Task Group 1.
 *
 * Small presentational utility that renders plain text with embedded
 * `http(s)://` URLs converted to clickable `<a target="_blank"
 * rel="noopener noreferrer">` anchors. Optionally truncates the read
 * view to N visible lines with a Show more / Show less toggle.
 *
 * Renders text via React children (string fragments interleaved with
 * anchor elements). NO `dangerouslySetInnerHTML` is used -- XSS-safe
 * by construction (React's default escaping handles HTML/script tags).
 *
 * URL detection:
 *   - Regex: `/(https?:\/\/[^\s)]+)/g`. Excludes whitespace and
 *     close-paren so URLs inside parens render correctly.
 *   - Post-match: strip trailing `.,;:!?` from each captured URL
 *     before building the `href`. The displayed link text uses the
 *     same trimmed value (no mismatch between text and href). The
 *     stripped punctuation is emitted as a separate plain-text
 *     segment so the surrounding prose still reads naturally.
 *
 * Truncation:
 *   - When `truncateLines` is set, the outer wrapper carries
 *     `.notesReadModeTruncated` while not expanded, which uses
 *     `-webkit-line-clamp` via a `--lc` CSS custom property.
 *   - A Show more / Show less button below the text toggles the
 *     expanded state. Mirrors `WorkItemTree.tsx`'s pattern, but the
 *     line count is parameterised here.
 *   - When `truncateLines` is not provided, no clamp + no toggle.
 */

import React, { useState } from 'react';
import styles from './LinkifiedText.module.css';

export interface LinkifiedTextProps {
  text: string;
  className?: string;
  truncateLines?: number;
}

/** Matches http(s) URLs up to the next whitespace or close-paren. */
const URL_REGEX = /(https?:\/\/[^\s)]+)/g;

/** Punctuation characters stripped from the END of each URL match. */
const TRAILING_PUNCT_REGEX = /[.,;:!?]+$/;

/**
 * Tokenise `text` into an array of React nodes alternating plain-text
 * segments with `<a>` anchors. Multi-URL support is load-bearing: a
 * single string with N URLs yields N anchor elements.
 */
function tokenise(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  // Fresh regex per call so we don't share lastIndex across renders.
  const re = new RegExp(URL_REGEX.source, 'g');
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    const startIdx = match.index;
    // Plain-text segment before this match.
    if (startIdx > lastIndex) {
      out.push(text.slice(lastIndex, startIdx));
    }
    // Strip trailing punctuation from the captured URL so the href is
    // clean. The stripped suffix is appended as a plain-text segment
    // so the visible prose still shows the period/comma/etc.
    const trimmed = raw.replace(TRAILING_PUNCT_REGEX, '');
    const stripped = raw.slice(trimmed.length);
    out.push(
      <a
        key={`linkified-${key++}`}
        href={trimmed}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.notesLink}
      >
        {trimmed}
      </a>
    );
    if (stripped.length > 0) {
      out.push(stripped);
    }
    lastIndex = startIdx + raw.length;
  }
  // Trailing plain-text segment after the last match (or the whole
  // string if no matches).
  if (lastIndex < text.length) {
    out.push(text.slice(lastIndex));
  }
  return out;
}

export function LinkifiedText({ text, className, truncateLines }: LinkifiedTextProps) {
  const [expanded, setExpanded] = useState(false);
  const tokens = tokenise(text);
  const truncating = typeof truncateLines === 'number' && truncateLines > 0;

  const wrapperClasses = [
    styles.notesReadMode,
    truncating && !expanded ? styles.notesReadModeTruncated : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  // Inline style sets the --lc custom property so a single CSS class
  // supports any clamp value passed in via the prop.
  const wrapperStyle: React.CSSProperties | undefined =
    truncating && !expanded
      ? ({ ['--lc' as string]: String(truncateLines) } as React.CSSProperties)
      : undefined;

  return (
    <>
      <div className={wrapperClasses} style={wrapperStyle}>
        {tokens}
      </div>
      {truncating && (
        <button
          type="button"
          className={styles.notesShowMoreButton}
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </>
  );
}

export default LinkifiedText;
