/**
 * LinkifiedText tests
 *
 * Spec 2026-05-26 Mapping-Notes Pretty Rendering -- Task Group 1.
 *
 * Three focused tests covering:
 *   1. No-URL input -> zero `<a>` tags emitted.
 *   2. Multi-URL input with trailing punctuation -> exactly two anchors,
 *      each carrying `target="_blank"` + `rel="noopener noreferrer"`;
 *      `href` values have trailing `.,;:!?` stripped while the visible
 *      prose still shows the punctuation.
 *   3. Truncation -> Show more button appears; click expands; copy
 *      flips to Show less; click again re-truncates.
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LinkifiedText } from './LinkifiedText';

describe('LinkifiedText', () => {
  it('Test 1: plain text without URLs renders no <a> elements', () => {
    const { container } = render(
      <LinkifiedText text="Plain prose without any links." />
    );
    const anchors = container.querySelectorAll('a');
    expect(anchors.length).toBe(0);
    // The text itself is rendered.
    expect(container.textContent).toContain('Plain prose without any links.');
  });

  it('Test 2: two URLs in a single string emit exactly two anchors with stripped trailing punctuation', () => {
    // The first URL is followed by a trailing period (in prose). The
    // anchor's href MUST NOT include the period; the visible prose
    // still contains the period as part of the surrounding text.
    const input =
      'see https://example.com/path. and https://other.com/x for ref';
    const { container } = render(<LinkifiedText text={input} />);

    const anchors = container.querySelectorAll('a');
    expect(anchors.length).toBe(2);

    // Anchor attribute audit -- both must carry target + rel.
    anchors.forEach((a) => {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    });

    // First anchor: href stripped of trailing period.
    expect(anchors[0].getAttribute('href')).toBe('https://example.com/path');
    // The anchor's visible text matches the href (no trailing period
    // captured in the link text either).
    expect(anchors[0].textContent).toBe('https://example.com/path');

    // Second anchor: no trailing punctuation in this URL.
    expect(anchors[1].getAttribute('href')).toBe('https://other.com/x');
    expect(anchors[1].textContent).toBe('https://other.com/x');

    // The surrounding prose still shows the period -- it was emitted as
    // a plain-text segment, NOT consumed by the anchor.
    expect(container.textContent).toContain('https://example.com/path.');
    expect(container.textContent).toContain(
      'see https://example.com/path. and https://other.com/x for ref'
    );
  });

  it('Test 3: truncateLines renders a Show more / Show less toggle', () => {
    const long = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
    const { container } = render(
      <LinkifiedText text={long} truncateLines={2} />
    );

    // Initial state: truncated. The wrapper carries the
    // `notesReadModeTruncated` class (CSS module name will be hashed
    // but we can verify the toggle button's copy).
    const toggle = screen.getByRole('button', { name: /show more/i });
    expect(toggle).toBeTruthy();

    // The first child div should carry a class containing
    // "notesReadModeTruncated" (CSS modules append a hash but keep the
    // declared name as a substring).
    const wrapper = container.querySelector('div');
    expect(wrapper).toBeTruthy();
    expect(wrapper!.className).toMatch(/notesReadModeTruncated/);

    // Click Show more -> wrapper drops the truncated class; button copy
    // flips to Show less.
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /show less/i })).toBeTruthy();
    expect(wrapper!.className).not.toMatch(/notesReadModeTruncated/);

    // Click again -> re-truncates.
    fireEvent.click(screen.getByRole('button', { name: /show less/i }));
    expect(screen.getByRole('button', { name: /show more/i })).toBeTruthy();
    expect(wrapper!.className).toMatch(/notesReadModeTruncated/);
  });
});
