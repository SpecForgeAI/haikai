/**
 * Decision-code → Section-heading mapping — Tech-Stack.md Pre-fill +
 * Target-Tech-Stack.md Write (Spec 2026-05-25, Task Group 4).
 *
 * Used by the deterministic close-turn writer (`writeTargetTechStackMarkdown.ts`)
 * to group captured-decision rows into the source-mirroring sections of the
 * generated `target-tech-stack-<uuid>.md` file. The mapping is HARDCODED in
 * code rather than LLM-generated (per Q15 — no LLM call on close); the output
 * STYLE mirrors the free-form, sectioned `tech-stack.md` shape (per Q2 +
 * Q15 reconciliation).
 *
 * Sections (plain-English headings — no invented acronyms):
 *   - Backend
 *   - Frontend
 *   - Database
 *   - API
 *   - Domain
 *   - Observability
 *   - Security
 *   - Testing
 *   - Build & Deployment
 *   - Inter-Service Communication
 *   - Cutover
 *   - Other (catch-all for anything unmapped)
 *
 * The mapping covers every code in the 51-entry library (see
 * `gateway/src/config/architect-conversation/questionLibrary.ts`).
 */

/**
 * Stable order in which sections are rendered in the generated file. The
 * writer iterates this list and emits each non-empty section. Sections with
 * no captured-decision rows for the architecture are silently skipped.
 */
export const TARGET_TECH_STACK_SECTION_ORDER: readonly string[] = [
  'Backend',
  'Frontend',
  'Database',
  'API',
  'Domain',
  'Observability',
  'Security',
  'Testing',
  'Build & Deployment',
  'Inter-Service Communication',
  'Cutover',
  'Other',
] as const;

/**
 * Resolve the section heading for a given library decision code. The
 * mapping is deterministic — every code in the library maps to exactly one
 * section. Codes not in the library (e.g. ones written by a future
 * follow-up spec) fall through to the "Other" catch-all so the writer
 * never drops a row.
 */
export function sectionFor(decisionCode: string): string {
  // -----------------------------------------------------------------------
  // Group A — Service runtime (6 codes) → Backend
  // -----------------------------------------------------------------------
  if (decisionCode.startsWith('service.')) {
    return 'Backend';
  }

  // -----------------------------------------------------------------------
  // Group B — API surface (6 codes) → API
  // -----------------------------------------------------------------------
  if (decisionCode.startsWith('api.')) {
    return 'API';
  }

  // -----------------------------------------------------------------------
  // Group C — Data persistence (6 codes) → Database
  // -----------------------------------------------------------------------
  if (decisionCode.startsWith('db.')) {
    return 'Database';
  }

  // -----------------------------------------------------------------------
  // Group D — Domain / DTO / Validation (4 codes) → Domain
  // -----------------------------------------------------------------------
  if (
    decisionCode.startsWith('dto.') ||
    decisionCode.startsWith('domain.') ||
    decisionCode === 'validation.framework'
  ) {
    return 'Domain';
  }

  // -----------------------------------------------------------------------
  // Group E — Frontend (5 codes) → Frontend
  // -----------------------------------------------------------------------
  if (decisionCode.startsWith('ui.')) {
    return 'Frontend';
  }

  // -----------------------------------------------------------------------
  // Group F — Cross-cutting (5 codes) split by area:
  //   logging.* / metrics.* / tracing.*       → Observability
  //   secrets.*                               → Security
  // -----------------------------------------------------------------------
  if (
    decisionCode.startsWith('logging.') ||
    decisionCode.startsWith('metrics.') ||
    decisionCode.startsWith('tracing.')
  ) {
    return 'Observability';
  }
  if (decisionCode.startsWith('secrets.')) {
    return 'Security';
  }

  // -----------------------------------------------------------------------
  // Group G — Infrastructure / Build (5 codes) → Build & Deployment
  // -----------------------------------------------------------------------
  if (
    decisionCode.startsWith('build.') ||
    decisionCode.startsWith('container.') ||
    decisionCode.startsWith('ci.') ||
    decisionCode.startsWith('deployment.')
  ) {
    return 'Build & Deployment';
  }

  // -----------------------------------------------------------------------
  // Group H — Inter-service comms (5 codes) → Inter-Service Communication
  // -----------------------------------------------------------------------
  if (decisionCode.startsWith('interservice.')) {
    return 'Inter-Service Communication';
  }

  // -----------------------------------------------------------------------
  // Group I — Testing (5 codes) → Testing
  // -----------------------------------------------------------------------
  if (decisionCode.startsWith('testing.')) {
    return 'Testing';
  }

  // -----------------------------------------------------------------------
  // Group J — Cut-over (4 codes) → Cutover
  // -----------------------------------------------------------------------
  if (decisionCode.startsWith('cutover.')) {
    return 'Cutover';
  }

  // -----------------------------------------------------------------------
  // Catch-all so the writer never drops a row.
  // -----------------------------------------------------------------------
  return 'Other';
}
