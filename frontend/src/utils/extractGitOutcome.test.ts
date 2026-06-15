/**
 * Tests for the defensive git-outcome extraction helper.
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair
 * Task Group 5: Defensive git-outcome rendering on completion.
 *
 * JobDetailResponse.result is untyped upstream (additionalProperties: true)
 * — these tests pin the tolerant behaviour: recognise branch / pr_url-like
 * keys when present, and never throw on arbitrary/missing shapes.
 */

import { describe, it, expect } from 'vitest';
import { extractGitOutcome, hasGitOutcome } from './extractGitOutcome';

describe('extractGitOutcome', () => {
  it('extracts branch, PR URL and logs URL from common key names', () => {
    const outcome = extractGitOutcome({
      feature_branch: 'feature/spec-2026-06-12',
      pr_url: 'https://git.example/pr/42',
      logs_url: 'https://logs.example/job-1',
    });

    expect(outcome).toEqual({
      branch: 'feature/spec-2026-06-12',
      prUrl: 'https://git.example/pr/42',
      logsUrl: 'https://logs.example/job-1',
    });
    expect(hasGitOutcome(outcome)).toBe(true);
  });

  it('recognises alternative key spellings (branch, pull_request_url)', () => {
    const outcome = extractGitOutcome({
      branch: 'feat/alt-spelling',
      pull_request_url: 'https://git.example/pull/7',
    });

    expect(outcome.branch).toBe('feat/alt-spelling');
    expect(outcome.prUrl).toBe('https://git.example/pull/7');
  });

  it('finds keys nested inside objects and arrays', () => {
    const outcome = extractGitOutcome({
      specs: [
        {
          name: 'spec-a',
          git: { feature_branch: 'feature/nested', pr_url: 'https://git.example/pr/9' },
        },
      ],
    });

    expect(outcome.branch).toBe('feature/nested');
    expect(outcome.prUrl).toBe('https://git.example/pr/9');
  });

  it('tolerates missing, null, primitive and arbitrary result shapes without throwing', () => {
    for (const weird of [undefined, null, 42, 'just a string', [], {}, { unrelated: { stuff: true } }]) {
      const outcome = extractGitOutcome(weird);
      expect(outcome).toEqual({});
      expect(hasGitOutcome(outcome)).toBe(false);
    }
  });

  it('ignores empty-string and non-string values under candidate keys', () => {
    const outcome = extractGitOutcome({
      branch: '   ',
      pr_url: 12345,
    });

    expect(outcome.branch).toBeUndefined();
    expect(outcome.prUrl).toBeUndefined();
    expect(hasGitOutcome(outcome)).toBe(false);
  });

  it('prefers the explicit top-level logs_url argument over one embedded in the result', () => {
    const outcome = extractGitOutcome(
      { logs_url: 'https://logs.example/embedded' },
      'https://logs.example/top-level',
    );

    expect(outcome.logsUrl).toBe('https://logs.example/top-level');
  });
});
