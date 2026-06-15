/**
 * CandidateEvidenceSectionCard Component
 *
 * Spec 3 (2026-05-10): Candidate Evidence Data Contract — Task Group 2.2.
 *
 * Generic, candidate-type-agnostic renderer for ONE evidence section
 * (column body) inside the per-row Candidate Details Panel. Replaces
 * Spec 2's per-section `CodeDetectionPanel` and the inline placeholder
 * `<div>` blocks for Log Scans / LLM Review with a single component
 * driven by a `testIdPrefix`.
 *
 * Design contract (shaping notes §3.2 + tasks §2.3-2.5):
 *
 *   Wrapper:
 *     <div data-testid={`${prefix}-panel`} className={detailsColumnBody}>
 *
 *   Conditional lines (each emitted only when its source field is present
 *   and non-empty):
 *
 *   - When `section.detectedBy` is non-empty:
 *       <div data-testid={`${prefix}-detected-by`}>Detected by: {value}</div>
 *
 *   - When `section.sourceFiles?.length`:
 *       <div data-testid={`${prefix}-source-files`}>
 *         <div>Source files:</div>
 *         {one inner <div> per path}
 *       </div>
 *
 *   - When `section.reason` is non-empty:
 *       <div data-testid={`${prefix}-reason`}>Reason: {value}</div>
 *     ELSE when `section.summary` is non-empty:
 *       The summary is rendered as the wrapper's body text. This
 *       preserves the EXACT placeholder string contract for the
 *       Log Scans and LLM Review columns.
 *
 *   - For each `field` in `section.fields`:
 *       <div data-testid={`${prefix}-field-{slug}`}>label: value</div>
 *     where {slug} = slugifyLabel(label) (lowercase + kebab-case).
 *     Array values render as a label header plus one inner <div> per item.
 *
 *   Empty state (preserves Spec 2 semantics):
 *     <div data-testid={`${prefix}-empty`}>Type-specific details: not available.</div>
 *     Emitted ONLY when fields.length === 0 AND no sourceFiles AND no
 *     reason AND no summary. This guarantees `code-detection-empty` fires
 *     when Spec 2's mapper flagged `isMostlyEmpty` AND no curated content
 *     survived, but `log-scans-empty` / `llm-review-empty` NEVER fire
 *     because those sections always carry a `summary`.
 *
 *   Forward-compatible blocks (defined now per resolved decisions §7,
 *   never triggered in Spec 3 because the builder doesn't populate them):
 *
 *   - When `section.confidenceImpactLabel` is non-empty:
 *       <div data-testid={`${prefix}-confidence-impact`}>
 *         Impact: {label}
 *         {optional confidenceImpactReason underneath}
 *       </div>
 *     Spec 7 ("Confidence, Tier, and Runtime Badges") populates these.
 *
 *   - When `section.notes?.length`:
 *       One <div data-testid={`${prefix}-note-{index}`}> per note,
 *       carrying the note's level as a class hint. Defined for forward
 *       compatibility; Spec 3's builders never populate notes.
 *
 *   Status-aware styling: `available` and `not_available` reuse the
 *   shipped Spec 2 visual treatment via `styles.detailsColumnBody`.
 *   `partial` and `warning` render with the same DOM as `not_available`
 *   for now (forward-compatible no-op).
 *
 * No CSS is added by this spec — the card reuses `styles.detailsColumnBody`.
 * Note/impact styling is deferred to the spec that first populates those
 * fields (Spec 6/7).
 */

import React from 'react';
import styles from './DiscoveryRunDetailView.module.css';
import type {
  CandidateEvidenceField,
  CandidateEvidenceSection,
} from './candidateEvidenceTypes';

export interface CandidateEvidenceSectionCardProps {
  section: CandidateEvidenceSection;
  testIdPrefix: string;
}

/**
 * Slugify a curated field label into its testid suffix:
 * "HTTP method" -> "http-method", "Bean name" -> "bean-name",
 * "OpenAPI operation" -> "openapi-operation".
 *
 * Lowercases, replaces any run of non-alphanumeric characters with a single
 * dash, and trims leading/trailing dashes. Moved verbatim from Spec 2's
 * `CodeDetectionPanel.tsx` (will be deleted in Task Group 3).
 */
function slugifyLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const CandidateEvidenceSectionCard: React.FC<CandidateEvidenceSectionCardProps> = ({
  section,
  testIdPrefix,
}) => {
  const hasDetectedBy = !!section.detectedBy && section.detectedBy.length > 0;
  const hasSourceFiles = !!section.sourceFiles && section.sourceFiles.length > 0;
  const hasReason = !!section.reason && section.reason.length > 0;
  const hasSummary = !!section.summary && section.summary.length > 0;
  const hasFields = section.fields.length > 0;
  const hasNotes = !!section.notes && section.notes.length > 0;
  const hasImpact =
    !!section.confidenceImpactLabel && section.confidenceImpactLabel.length > 0;

  // Empty-state rule (CRITICAL): emits ONLY when all four content sources
  // are absent. Log Scans / LLM Review always carry a summary, so they
  // never trip this branch. Code Detection trips it iff Spec 2's mapper
  // flagged `isMostlyEmpty` AND nothing curated survived.
  const showEmpty = !hasFields && !hasSourceFiles && !hasReason && !hasSummary;

  // Reason takes precedence over summary as wrapper body text. When reason
  // is present we render the labelled `Reason:` line; when only summary is
  // present we render it as plain text inside the wrapper (preserves the
  // placeholder-string contract for Log Scans / LLM Review).
  const showSummaryAsBody = !hasReason && hasSummary;

  return (
    <div data-testid={`${testIdPrefix}-panel`} className={styles.detailsColumnBody}>
      {hasDetectedBy && (
        <div data-testid={`${testIdPrefix}-detected-by`}>
          Detected by: {section.detectedBy}
        </div>
      )}

      {hasSourceFiles && (
        <div data-testid={`${testIdPrefix}-source-files`}>
          <div>Source files:</div>
          {section.sourceFiles!.map((path, index) => (
            <div key={`${index}-${path}`}>{path}</div>
          ))}
        </div>
      )}

      {hasReason && (
        <div data-testid={`${testIdPrefix}-reason`}>Reason: {section.reason}</div>
      )}

      {showSummaryAsBody && section.summary}

      {section.fields.map((field: CandidateEvidenceField) => {
        const slug = slugifyLabel(field.label);
        if (Array.isArray(field.value)) {
          return (
            <div key={slug} data-testid={`${testIdPrefix}-field-${slug}`}>
              <div>{field.label}:</div>
              {field.value.map((item, index) => (
                <div key={`${index}-${item}`}>{item}</div>
              ))}
            </div>
          );
        }
        return (
          <div key={slug} data-testid={`${testIdPrefix}-field-${slug}`}>
            {field.label}: {field.value}
          </div>
        );
      })}

      {hasImpact && (
        <div data-testid={`${testIdPrefix}-confidence-impact`}>
          <div>Impact: {section.confidenceImpactLabel}</div>
          {section.confidenceImpactReason && (
            <div>{section.confidenceImpactReason}</div>
          )}
        </div>
      )}

      {hasNotes &&
        section.notes!.map((note, index) => (
          <div
            key={index}
            data-testid={`${testIdPrefix}-note-${index}`}
            className={`evidence-note evidence-note-${note.level}`}
          >
            {note.text}
          </div>
        ))}

      {showEmpty && (
        <div data-testid={`${testIdPrefix}-empty`}>
          Type-specific details: not available.
        </div>
      )}
    </div>
  );
};
