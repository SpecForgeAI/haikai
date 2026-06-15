/**
 * Tests for the Markdown transcript export utility.
 *
 * Spec: 2026-05-26 Architect Conversation Enrichments (Batched #11 + #12)
 *
 * Covers (1 test, 14 per-kind toContain assertions in a single it() block per
 * the spec's test-cap):
 *
 *   - Given a fixture with one turn of each of the 14 kinds, the returned
 *     Markdown contains:
 *     - The header (project id, architecture name).
 *     - The per-kind fragment from `planning/requirements.md` verbatim.
 */

import { describe, it, expect } from 'vitest';

import {
  exportTranscript,
  slugifyForFilename,
} from '../exportTranscript';
import type { ConversationTurn } from '../../../../api/architectConversationApi';

const FIXTURE_TURNS: ConversationTurn[] = [
  {
    kind: 'open',
    sessionId: 'sess-export-1',
    openedBy: 'architect-alex',
  },
  {
    kind: 'tech-stack-prefill-summary',
    bannerVariant: 'both-files-matched',
    matchedCount: 17,
    denominator: 51,
    orgFilePresent: true,
    projectFilePresent: true,
    orgFilePath: '/repo/agent-os/product/tech-stack.md',
    projectFilePath: '/repo/agent-os/product/tech-stack.md',
    partialFailureCodes: [],
    failureReason: null,
  },
  {
    kind: 'question',
    decisionCode: 'service.language',
    promptText: 'Which language and version do services run on?',
    roundIndex: 1,
    staticContextLeadIn:
      'The language and version each service runs on. Common modern picks: Java 21, Kotlin 2, Node 20, Python 3.12, Go 1.22, C# 12.',
  },
  {
    kind: 'answer',
    decisionCode: 'service.language',
    answerText: 'Java 21',
    roundIndex: 1,
  },
  {
    kind: 'cascade-summary',
    cascadedDecisions: [
      {
        decisionCode: 'service.runtime',
        proposedValue: 'Eclipse Temurin 21',
        sourceStandardId: 'std-jvm-runtime-v3',
      },
    ],
  },
  {
    kind: 'cascade-accepted',
    cascadedDecisions: [
      {
        decisionCode: 'service.runtime',
        answerValue: 'Eclipse Temurin 21',
        wasOverridden: false,
      },
    ],
  },
  {
    kind: 'cascade-overridden',
    cascadedDecisions: [
      {
        decisionCode: 'service.runtime',
        answerValue: 'GraalVM 21',
        wasOverridden: true,
        overrideReason: 'AOT-compile required by the API gateway',
      },
    ],
  },
  {
    kind: 'decision-captured',
    decisionId: 'dec-export-cap-1',
    decisionCode: 'service.language',
    scope: { kind: 'architecture' },
    answerValue: 'Java 21',
    standardsLookupRef: 'std-jvm-language-v3',
  },
  {
    kind: 'mapping-mutation-summary',
    affectedMappings: 5,
    mappingTypeChanges: 2,
    notesDecorations: 3,
    tableSetSummary: [
      {
        tableSet: 'service-language',
        affectedMappings: 5,
        mappingTypeChanges: 2,
        notesDecorations: 3,
      },
    ],
  },
  {
    kind: 'exception-pinned',
    decisionCode: 'service.language',
    scope: { kind: 'element', refType: 'service', refId: 'svc-legacy-auth' },
    answerValue: 'Java 8',
  },
  {
    kind: 'edit-superseded',
    originalDecisionId: 'dec-orig-1',
    newDecisionId: 'dec-new-1',
    affectedDownstreamCodes: ['service.runtime', 'container.baseImage'],
  },
  {
    kind: 'system-skip',
    decisionCode: 'ui.framework',
    relevanceReason: 'No frontend in scope for this service',
  },
  {
    kind: 'error',
    errorKind: 'llm-call-timeout',
    errorMessage: 'Provider returned 504 after 60s',
    recoverableHint: 'Retry the question',
  },
  {
    kind: 'close',
    sessionId: 'sess-export-1',
    closeReason: 'completed-by-user',
    summaryMarkdown: '## Close summary\n\n- captured 17 decisions',
  },
];

describe('exportTranscript (Spec 2026-05-26, #12)', () => {
  it('emits the header + one fragment per of the 14 turn kinds per the requirements emit-shape table', () => {
    const md = exportTranscript({
      turns: FIXTURE_TURNS,
      architectureName: 'test-arch',
      selectedTargetArchitectureId: 'arch-export-1',
      projectId: 'p1',
    });

    // -----------------------------------------------------------------------
    // Header assertions
    // -----------------------------------------------------------------------
    expect(md).toContain('# Architect Conversation');
    expect(md).toContain('**Project:** p1');
    expect(md).toContain('**Architecture:** test-arch');
    // Exported timestamp (ISO -- shape only, not the exact value).
    expect(md).toMatch(/\*\*Exported:\*\* \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(md).toContain('---');

    // -----------------------------------------------------------------------
    // Per-kind fragment assertions (14 toContain calls -- one per turn kind).
    // -----------------------------------------------------------------------

    // 1. open
    expect(md).toContain('## Session opened');
    expect(md).toContain('- Opened by: architect-alex');
    expect(md).toContain('- Session id: `sess-export-1`');

    // 2. close
    expect(md).toContain('## Session closed');
    expect(md).toContain('- Reason: completed-by-user');
    expect(md).toContain('## Close summary');

    // 3. tech-stack-prefill-summary
    expect(md).toContain('### Tech-stack pre-fill (both-files-matched)');
    expect(md).toContain('- Matched: 17 of 51');
    expect(md).toContain('- Partial failures: none');
    expect(md).toContain('- Failure reason: —');

    // 4. question -- heading + prompt blockquote + italicised lead-in
    expect(md).toContain('### Q · service.language · round 1');
    expect(md).toContain('> Which language and version do services run on?');
    expect(md).toContain(
      '_The language and version each service runs on. Common modern picks: Java 21, Kotlin 2, Node 20, Python 3.12, Go 1.22, C# 12._',
    );

    // 5. answer
    expect(md).toContain('**Architect:** Java 21');

    // 6. cascade-summary
    expect(md).toContain('**Cascade summary** — proposed downstream values:');
    expect(md).toContain(
      '- `service.runtime` → Eclipse Temurin 21  _(source: std-jvm-runtime-v3)_',
    );

    // 7. cascade-accepted
    expect(md).toContain('**Cascades accepted:**');
    expect(md).toContain('- `service.runtime` → Eclipse Temurin 21');

    // 8. cascade-overridden
    expect(md).toContain('**Cascades overridden:**');
    expect(md).toContain(
      '- `service.runtime` → GraalVM 21  _(reason: AOT-compile required by the API gateway)_',
    );

    // 9. decision-captured -- architecture scope, with standard
    expect(md).toContain(
      '**Captured:** `service.language` = Java 21  _(scope: architecture; id: `dec-export-cap-1`; standard: std-jvm-language-v3)_',
    );

    // 10. mapping-mutation-summary
    expect(md).toContain(
      '**Mapping mutations:** 5 mappings affected, 2 type changes, 3 notes added.',
    );
    expect(md).toContain('- service-language: 5/2/3');

    // 11. exception-pinned
    expect(md).toContain(
      '**Exception pinned:** `service.language` = Java 8 _(on service:svc-legacy-auth)_',
    );

    // 12. edit-superseded
    expect(md).toContain(
      '**Revision:** decision `dec-orig-1` → `dec-new-1`.  Downstream codes possibly affected: service.runtime, container.baseImage',
    );

    // 13. system-skip
    expect(md).toContain(
      '**Skipped:** `ui.framework` — No frontend in scope for this service',
    );

    // 14. error -- with recoverable hint
    expect(md).toContain(
      '**Error** _(llm-call-timeout)_: Provider returned 504 after 60s — hint: Retry the question',
    );

    // Fragments separated by blank lines (`\n\n` join boundary).
    expect(md).toMatch(/## Session opened[\s\S]*\n\n[\s\S]*### Tech-stack pre-fill/);
  });
});

describe('slugifyForFilename', () => {
  it('lowercases, replaces non-[a-z0-9-] runs with -, and trims leading/trailing dashes', () => {
    expect(slugifyForFilename('Target Payments v2')).toBe('target-payments-v2');
    expect(slugifyForFilename('  !! Hello, World!!  ')).toBe('hello-world');
    expect(slugifyForFilename('already-good-slug')).toBe('already-good-slug');
  });
});
