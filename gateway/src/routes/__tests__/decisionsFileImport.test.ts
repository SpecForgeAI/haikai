/**
 * Spec 2026-06-26-target-state-decisions-file-import (Spec 3) — Groups 1 + 2.
 *
 * Parser (FR1/FR2) + apply handler (FR3/FR4/FR5/FR8) tested in isolation. The
 * POST + read seams are injected (no HTTP).
 */

import {
  parseDecisionsFile,
  allDecisionCodes,
} from '../../services/architectConversation/decisionsFileImportParser';
import {
  buildDecisionsFileImportResult,
  DECISIONS_FILE_IMPORT_TASK_NAME,
  DecisionsFileImportDeps,
} from '../decisionsFileImport';
import type { CreateCapturedDecisionRequestBody } from '../../services/architectConversation/targetStateCapturedDecisionsWriter';
import type { TargetStateCapturedDecision } from '../../services/targetStateCapturedDecisionsClient';

jest.mock('../../services/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** The real "Preview prompt-ready output" shape, with skip-able sections. */
const EXPORT_TEXT = `## Target State Decisions

### Architecture-wide
- \`service.framework\` = Spring Boot 4.0
- \`db.driver\` = pgjdbc 42.7.4
- \`service.processModel\` = single-process
- \`api.protocol\` = REST/JSON, gRPC

### Per-service overrides
- service:abc (\`service.framework\` = Quarkus 3)

### Free-form discussion notes
- \`note.foo\` = something
`;

function makeRow(
  code: string,
  over: Partial<TargetStateCapturedDecision> = {},
): TargetStateCapturedDecision {
  return {
    decisionId: `dec-${code}`,
    projectId: 'p1',
    targetArchitectureId: 't1',
    decisionCode: code,
    scopeKind: 'architecture',
    answerValue: 'x',
    answerSummary: 'x',
    standardsLookupRef: null,
    conversationThreadId: null,
    conversationTurnRef: null,
    createdAt: '2026-06-26T00:00:00Z',
    createdByTask: 'architect-persona-conversation',
    supersededById: null,
    ...over,
  };
}

interface PostCall {
  body: CreateCapturedDecisionRequestBody;
}

function recordingDeps(opts: {
  latest?: TargetStateCapturedDecision[];
  failOnCode?: string;
  readThrows?: boolean;
} = {}): { deps: DecisionsFileImportDeps; posts: PostCall[] } {
  const posts: PostCall[] = [];
  const deps: DecisionsFileImportDeps = {
    postCapturedDecision: (async (_p, _t, body): Promise<TargetStateCapturedDecision> => {
      posts.push({ body });
      if (opts.failOnCode && body.decisionCode === opts.failOnCode) {
        throw new Error(`synthetic write failure for ${body.decisionCode}`);
      }
      return makeRow(body.decisionCode, { answerValue: body.answerValue });
    }) as DecisionsFileImportDeps['postCapturedDecision'],
    fetchLatestCapturedDecisions: (async (): Promise<TargetStateCapturedDecision[]> => {
      if (opts.readThrows) throw new Error('synthetic read failure');
      return opts.latest ?? [];
    }) as DecisionsFileImportDeps['fetchLatestCapturedDecisions'],
  };
  return { deps, posts };
}

const ARGS = { projectId: 'p1', targetArchitectureId: 't1' };

// ---------------------------------------------------------------------------
// Group 1 — parser
// ---------------------------------------------------------------------------

describe('parseDecisionsFile (FR1/FR2)', () => {
  test('round-trips the export format: arch-wide answers parsed, other sections skipped-with-note', () => {
    const r = parseDecisionsFile(EXPORT_TEXT);
    expect(r.badLines).toHaveLength(0);
    const byCode = Object.fromEntries(r.answers.map((a) => [a.decisionCode, a]));
    // versioned reversal -> bare stem + version
    expect(byCode['service.framework']).toMatchObject({
      kind: 'framework-version', framework: 'Spring Boot', version: '4.0',
    });
    expect(byCode['db.driver']).toMatchObject({
      kind: 'framework-version', framework: 'pgjdbc', version: '42.7.4',
    });
    // single + multi choice
    expect(byCode['service.processModel']).toMatchObject({ kind: 'single-choice', value: 'single-process' });
    expect(byCode['api.protocol']).toMatchObject({ kind: 'single-choice', value: 'REST/JSON, gRPC' });
    // non-architecture sections recorded as skipped, not applied
    expect(r.skippedSections).toEqual(
      expect.arrayContaining(['Per-service overrides', 'Free-form discussion notes']),
    );
  });

  test('tolerates hand-simplified lines (no bullet, no backticks, `:` separator)', () => {
    const r = parseDecisionsFile('service.framework: Spring Boot 4.0\ndb.driver : pgjdbc 42.7.4');
    expect(r.badLines).toHaveLength(0);
    expect(r.answers).toHaveLength(2);
    expect(r.answers[0]).toMatchObject({ framework: 'Spring Boot', version: '4.0' });
  });

  test('drops a trailing (standards: …) suffix and the version-unknown form', () => {
    const r = parseDecisionsFile(
      '- `service.framework` = Spring Boot 4.0 (standards: std.x)\n- `db.engine` = Postgres (version unknown)',
    );
    expect(r.badLines).toHaveLength(0);
    expect(r.answers[0]).toMatchObject({ framework: 'Spring Boot', version: '4.0' });
    expect(r.answers[1]).toMatchObject({ framework: 'Postgres', version: 'version-unknown' });
  });

  test('partial-accept: reports each bad line with a reason, keeps the valid ones', () => {
    const r = parseDecisionsFile(
      [
        '- `service.framework` = Spring Boot 4.0', // ok
        '- `not.a.code` = whatever', // unknown_code
        '- `db.driver` = NotARealDriver', // value_not_in_choices
        'a line with no separator', // malformed
        '- `service.framework` = Quarkus 3', // duplicate_code
      ].join('\n'),
    );
    expect(r.answers).toHaveLength(1);
    const reasons = r.badLines.map((b) => b.reason).sort();
    expect(reasons).toEqual(['duplicate_code', 'malformed', 'unknown_code', 'value_not_in_choices']);
    // every bad line carries a 1-based line number
    expect(r.badLines.every((b) => b.lineNumber >= 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 2 — apply handler
// ---------------------------------------------------------------------------

describe('buildDecisionsFileImportResult (FR3/FR4/FR5/FR8)', () => {
  test('writes each valid answer with createdByTask=decisions-file-import (subset => allAnswered false)', async () => {
    const { deps, posts } = recordingDeps();
    const res = await buildDecisionsFileImportResult({ ...ARGS, fileText: EXPORT_TEXT }, deps);
    expect(res.written.sort()).toEqual(
      ['api.protocol', 'db.driver', 'service.framework', 'service.processModel'].sort(),
    );
    expect(posts.every((p) => p.body.createdByTask === DECISIONS_FILE_IMPORT_TASK_NAME)).toBe(true);
    expect(posts.every((p) => p.body.scopeKind === 'architecture')).toBe(true);
    // versioned row carries the {framework,version} envelope + resolved chip summary
    const fw = posts.find((p) => p.body.decisionCode === 'service.framework')!;
    expect(JSON.parse(fw.body.answerValue).value).toEqual({ framework: 'Spring Boot', version: '4.0' });
    expect(fw.body.answerSummary).toBe('Spring Boot 4.0');
    expect(res.allAnswered).toBe(false);
    expect(res.badLines).toHaveLength(0);
  });

  test('FR4 import-wins: override summary shows the superseded prior answer', async () => {
    const latest = [makeRow('service.framework', { answerSummary: 'Quarkus 3' })];
    const { deps } = recordingDeps({ latest });
    const res = await buildDecisionsFileImportResult({ ...ARGS, fileText: EXPORT_TEXT }, deps);
    expect(res.overrides).toEqual(
      expect.arrayContaining([
        { decisionCode: 'service.framework', prior: 'Quarkus 3', next: 'Spring Boot 4.0' },
      ]),
    );
  });

  test('FR5 tier-skip: a code with an existing not_applicable row is ignored-with-a-note (not written)', async () => {
    const latest = [makeRow('api.protocol', { answerValue: 'not_applicable', answerSummary: null })];
    const { deps, posts } = recordingDeps({ latest });
    const res = await buildDecisionsFileImportResult({ ...ARGS, fileText: EXPORT_TEXT }, deps);
    expect(res.skippedTierCodes).toContain('api.protocol');
    expect(posts.some((p) => p.body.decisionCode === 'api.protocol')).toBe(false);
    expect(res.written).not.toContain('api.protocol');
  });

  test('FR7 input allAnswered=true when existing answers already cover every relevant code', async () => {
    // Every code already answered (non-not_applicable) => allAnswered regardless of the small import.
    const latest = allDecisionCodes().map((c) => makeRow(c, { answerSummary: 'prev' }));
    const { deps } = recordingDeps({ latest });
    const res = await buildDecisionsFileImportResult({ ...ARGS, fileText: EXPORT_TEXT }, deps);
    expect(res.allAnswered).toBe(true);
  });

  test('fail-soft: a failing write surfaces the code, the rest still import', async () => {
    const { deps } = recordingDeps({ failOnCode: 'db.driver' });
    const res = await buildDecisionsFileImportResult({ ...ARGS, fileText: EXPORT_TEXT }, deps);
    expect(res.failedCodes).toEqual(['db.driver']);
    expect(res.written).not.toContain('db.driver');
    expect(res.written).toContain('service.framework');
  });

  test('read failure is fail-soft (import still proceeds)', async () => {
    const { deps } = recordingDeps({ readThrows: true });
    const res = await buildDecisionsFileImportResult({ ...ARGS, fileText: EXPORT_TEXT }, deps);
    expect(res.written.length).toBeGreaterThan(0);
  });

  test('FR8 re-import re-POSTs the rows (append-only supersession)', async () => {
    const { deps, posts } = recordingDeps();
    await buildDecisionsFileImportResult({ ...ARGS, fileText: EXPORT_TEXT }, deps);
    await buildDecisionsFileImportResult({ ...ARGS, fileText: EXPORT_TEXT }, deps);
    expect(posts.filter((p) => p.body.decisionCode === 'service.framework')).toHaveLength(2);
  });
});
