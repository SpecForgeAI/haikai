/**
 * Tests — Open-Phase Decision/Note Code Derivation
 * Spec 2026-06-06-architect-conversation-open-ended-phase, Task Group 4 (4.1).
 *
 * The coding scheme is LOAD-BEARING: the AMS supersession key is
 * `(project, target, decisionCode, scopeKind, scopeRefId)`, so:
 *   - the SAME topic label must produce the SAME `adhoc.<slug>` code (a repeated
 *     pick on one topic intentionally supersedes the prior one);
 *   - DISTINCT topics must produce DISTINCT codes;
 *   - two NOTES must get DISTINCT codes (per-note uniqueness) so they do NOT
 *     supersede one another (Q2b).
 */

import {
  ADHOC_DECISION_CREATED_BY_TASK,
  NOTE_CREATED_BY_TASK,
  adhocDecisionCode,
  noteCode,
  slugifyTopicLabel,
} from '../openPhaseCodes';

describe('openPhaseCodes — adhoc decision codes', () => {
  it('derives `adhoc.<slug>` from the topic label (kebab-cased)', () => {
    expect(adhocDecisionCode('Batch processing')).toBe('adhoc.batch-processing');
    expect(adhocDecisionCode('Caching / CDN strategy')).toBe('adhoc.caching-cdn-strategy');
  });

  it('produces the SAME code for the same topic label (supersession-keyed)', () => {
    // Repeated answer on one topic must supersede → identical code.
    expect(adhocDecisionCode('Batch processing')).toBe(adhocDecisionCode('Batch processing'));
    // Case / punctuation differences that slugify identically still collide on
    // purpose (the topic is "the same").
    expect(adhocDecisionCode('Batch Processing')).toBe(adhocDecisionCode('batch processing'));
  });

  it('produces DISTINCT codes for distinct topics', () => {
    expect(adhocDecisionCode('Batch processing')).not.toBe(
      adhocDecisionCode('Observability stack'),
    );
  });

  it('falls back to a stable slug when the label has no slug-able characters', () => {
    expect(slugifyTopicLabel('!!! ???')).toBe('untitled');
    expect(adhocDecisionCode('###')).toBe('adhoc.untitled');
  });
});

describe('openPhaseCodes — note codes (per-note unique)', () => {
  it('appends the unique token so two notes on the SAME topic do NOT collide', () => {
    const a = noteCode('Cutover window', '1');
    const b = noteCode('Cutover window', '2');
    expect(a).not.toBe(b);
    expect(a).toBe('note.cutover-window-1');
    expect(b).toBe('note.cutover-window-2');
  });

  it('produces distinct codes across distinct topics + tokens', () => {
    const codes = [
      noteCode('Cutover window', '1'),
      noteCode('Data retention', '2'),
      noteCode('Cutover window', '3'),
    ];
    expect(new Set(codes).size).toBe(3);
  });
});

describe('openPhaseCodes — distinct createdByTask values', () => {
  it('uses different createdByTask for decisions vs notes (separable from preset rows)', () => {
    expect(ADHOC_DECISION_CREATED_BY_TASK).toBe('architect-adhoc-decision');
    expect(NOTE_CREATED_BY_TASK).toBe('architect-discussion-note');
    expect(ADHOC_DECISION_CREATED_BY_TASK).not.toBe(NOTE_CREATED_BY_TASK);
    // Neither collides with the preset row's createdByTask.
    expect(ADHOC_DECISION_CREATED_BY_TASK).not.toBe('architect-persona-conversation');
    expect(NOTE_CREATED_BY_TASK).not.toBe('architect-persona-conversation');
  });
});
