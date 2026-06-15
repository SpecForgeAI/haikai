/**
 * D3 — modernisation + effect-test prompt clauses (Group 4).
 *
 * Spec: 2026-06-14 internal-behaviour-implementation-ready-spec-generation
 * (Spec 3 of 6). Two clauses were added to
 * `product-manager.migration-shape-spec-generation.task.md`:
 *
 *  (a) an "operational capability" MODERNISATION clause that targets the
 *      captured modern equivalent via the EXISTING Target State Decisions +
 *      Target Tech Stack channels while PRESERVING the behavioural contract,
 *      and downgrades via the EXISTING MISSING_DECISION_CONTEXT /
 *      NO_CAPTURED_DECISIONS warning when no decision is captured (NEVER
 *      invents); and
 *  (b) an EFFECT-test clause in the STRUCTURED TEST PACK section steering
 *      operational tests toward EFFECT assertions (run pipeline -> assert DB
 *      tables / downstream message / snapshot) using the SAME unit|functional
 *      shape (NO schema change).
 *
 * These tests assert the clauses are present in the prompt text + that an
 * effect-shaped test pack for an operational story passes the existing
 * validator unchanged (NO schema change). The end-to-end "the generator emits
 * effect-oriented tests" assertion is exercised in
 * migrationShapeSpecOperationalCapability.test.ts (Group 3).
 */

import * as fs from 'fs';
import * as path from 'path';
import { assertSpecGenerationResponse } from '../services/specGenerationResponseValidator';

const PROMPT_PATH = path.resolve(
  __dirname,
  '..',
  'config',
  'prompts',
  'product-manager.migration-shape-spec-generation.task.md'
);

describe('D3 prompt clauses (Group 4) — modernisation + effect-test', () => {
  const prompt = fs.readFileSync(PROMPT_PATH, 'utf-8');

  it('the operational-capability MODERNISATION clause is present (captured modern targets + preserved contract)', () => {
    // A dedicated operational-capability modernisation section exists.
    expect(prompt).toMatch(/Operational Capability Modernisation/i);
    // It targets the captured modern equivalents via the EXISTING channels.
    expect(prompt).toMatch(/captured orchestrator/i);
    expect(prompt).toMatch(/captured messaging/i);
    expect(prompt).toMatch(/captured observability/i);
    expect(prompt).toMatch(
      /Target State Decisions Context.*Target Tech Stack Context|Target Tech Stack Context.*Target State Decisions Context/s
    );
    // It preserves the behavioural contract (same schedule / data / message /
    // snapshot outcomes); the WHAT is fixed, the HOW is modern.
    expect(prompt).toMatch(/PRESERVE the behavioural contract/i);
    expect(prompt).toMatch(/schedule semantics/i);
    expect(prompt).toMatch(/snapshot/i);
  });

  it('the modernisation clause references the EXISTING downgrade (never invents a modern target)', () => {
    // The clause reuses the existing MISSING_DECISION_CONTEXT / NO_CAPTURED_DECISIONS
    // downgrade instead of minting a modern target.
    expect(prompt).toMatch(/MISSING_DECISION_CONTEXT/);
    expect(prompt).toMatch(/NO_CAPTURED_DECISIONS/);
    expect(prompt).toMatch(/never invent|NOT pick one yourself|MUST NOT pick/i);
    // No NEW tech-category vocabulary — the modern choices ride the existing
    // free-text Target State Decisions channel.
    expect(prompt).toMatch(/free-text Target State Decisions channel/i);
    expect(prompt).toMatch(/NO new tech-category vocabulary/i);
  });

  it('the EFFECT-test clause is present in the STRUCTURED TEST PACK section (assert effects, not HTTP)', () => {
    const testPackSectionStart = prompt.indexOf('## STRUCTURED TEST PACK');
    expect(testPackSectionStart).toBeGreaterThan(-1);
    // The effect clause lives inside the STRUCTURED TEST PACK section (before the
    // next top-level "## " heading).
    const afterStart = prompt.slice(testPackSectionStart);
    const nextHeading = afterStart.indexOf('\n## ', 3);
    const section =
      nextHeading > -1 ? afterStart.slice(0, nextHeading) : afterStart;
    expect(section).toMatch(/assert EFFECTS/i);
    expect(section).toMatch(/run.*pipeline/i);
    expect(section).toMatch(/DB tables/i);
    expect(section).toMatch(/downstream message/i);
    expect(section).toMatch(/snapshot/i);
    // Reuses the same shape — NO schema change.
    expect(section).toMatch(/unit.*functional|functional.*unit/);
    expect(section).toMatch(/NOT a schema change|NO schema change/i);
    // Kind-agnostic: covers all operational kinds.
    expect(section).toMatch(/batch_pipeline/);
    expect(section).toMatch(/monitoring/);
    expect(section).toMatch(/ftp_ingestion/);
    expect(section).toMatch(/housekeeping/);
  });

  it('an effect-shaped operational test pack passes the existing validator with NO schema change', () => {
    // The effect tests reuse the SAME { title, description, type: unit|functional }
    // shape; the validator accepts them unchanged and accepts EMPTY
    // coveredEndpointIds for the (non-endpoint) capability story.
    const effectResponse = {
      status: 'generated',
      confidence: 'medium',
      specText:
        '/agent-os:shape-spec Modernise End-of-Day Risk Snapshot Batch Pipeline\n' +
        'Feature summary: re-express the batch on the captured orchestrator.\n' +
        'Acceptance criteria: Given the job runs, then risk_snapshot is populated.',
      warnings: [],
      evidenceRefs: [{ type: 'captured_decision', id: 'orchestrator' }],
      assumptions: ['Captured orchestrator decision covers scheduling.'],
      tests: [
        {
          title: 'Running the modern job populates risk_snapshot',
          description:
            'Given seeded books, when the pipeline runs, then risk_snapshot ' +
            'has one row per book (effect on the DB table).',
          type: 'functional',
        },
        {
          title: 'Job emits the completion message to the captured messaging target',
          description:
            'Given the pipeline completes, then a completion message is ' +
            'emitted to the captured messaging destination (downstream effect).',
          type: 'functional',
        },
      ],
      coveredEndpointIds: [],
      affectedAreas: ['batch/eod-risk'],
    };
    const result = assertSpecGenerationResponse(effectResponse);
    expect(result.ok).toBe(true);
  });
});
