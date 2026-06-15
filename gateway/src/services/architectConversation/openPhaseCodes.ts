/**
 * Open-Phase Decision/Note Code Derivation — Target State Architect-Persona
 * Conversation, Open-Ended LLM Phase (Spec 2026-06-06-architect-conversation-
 * open-ended-phase, S1 / Q2b).
 *
 * PURE helpers that derive the load-bearing decision codes for the open phase:
 *
 *   - `adhoc.<slug>`        — a FIRST-CLASS user-raised decision. The slug is
 *                             derived from the topic LABEL, so a repeated answer
 *                             on the SAME topic intentionally supersedes the
 *                             prior one (the AMS supersession key is
 *                             `(project, target, decisionCode, scopeKind,
 *                             scopeRefId)` — distinct topics get distinct codes).
 *   - `note.<slug>`         — a free-form discussion NOTE. Each note gets a
 *                             PER-NOTE UNIQUE code (a short suffix appended after
 *                             the topic slug) so two distinct notes do NOT
 *                             supersede one another (Q2b).
 *
 * The AMS `decision_code` column has NO CHECK/enum and accepts an arbitrary
 * string (verified: `155-target-state-captured-decisions.sql`), so these codes
 * are valid with ZERO schema change.
 *
 * IMPORTANT: this module is pure (no I/O, no clock, no randomness) EXCEPT the
 * explicitly-injected uniqueness suffix for note codes — callers pass a unique
 * token (e.g. an index or a short uuid fragment) so the note code is
 * deterministic for the given inputs and trivially unit-testable.
 */

/** Namespace prefix for first-class user-raised decisions (S1). */
export const ADHOC_CODE_PREFIX = 'adhoc';
/** Namespace prefix for free-form discussion notes (Q2b). */
export const NOTE_CODE_PREFIX = 'note';

/**
 * Distinct `createdByTask` values so open-phase rows are clearly separable from
 * preset rows (which use `architect-persona-conversation`) and from each other.
 */
export const ADHOC_DECISION_CREATED_BY_TASK = 'architect-adhoc-decision';
export const NOTE_CREATED_BY_TASK = 'architect-discussion-note';

/** Fallback slug when a label slugifies to the empty string. */
const FALLBACK_SLUG = 'untitled';

/**
 * Slugify a free-text label into a stable `kebab-case` fragment:
 *   - lower-cased;
 *   - non-alphanumeric runs collapse to a single hyphen;
 *   - leading/trailing hyphens trimmed;
 *   - bounded to keep the resulting `decision_code` comfortably within the
 *     AMS `VARCHAR(255)` column even after the prefix.
 *
 * Returns `FALLBACK_SLUG` when the input has no slug-able characters.
 */
export function slugifyTopicLabel(label: string): string {
  const slug = label
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : FALLBACK_SLUG;
}

/**
 * Derive the `adhoc.<slug>` decision code for a user-raised topic. Repeated
 * answers on the same topic label intentionally produce the same code (→
 * supersession); distinct topics produce distinct codes.
 */
export function adhocDecisionCode(topicLabel: string): string {
  return `${ADHOC_CODE_PREFIX}.${slugifyTopicLabel(topicLabel)}`;
}

/**
 * Derive a PER-NOTE UNIQUE `note.<slug>` code. The `uniqueToken` (caller-
 * supplied — e.g. a per-note index or a short uuid fragment) is appended so two
 * notes on the SAME topic label still get DISTINCT codes and therefore do NOT
 * supersede one another (Q2b). The token is itself slugified for safety.
 */
export function noteCode(topicLabel: string, uniqueToken: string): string {
  const tokenSlug = slugifyTopicLabel(uniqueToken);
  return `${NOTE_CODE_PREFIX}.${slugifyTopicLabel(topicLabel)}-${tokenSlug}`;
}
