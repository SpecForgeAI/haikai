/**
 * VersionedAnswerControl — decoupled framework + version selection
 * (Spec 2026-06-24-target-conversation-tech-stack-constraints, FR5 / FR6 / FR8).
 *
 * The dedicated control for the seven `versioned` decision codes. It DECOUPLES
 * the framework axis from the version axis so framework × version never explodes
 * into chips:
 *
 *   - FRAMEWORK axis: constrained single-select chips (target ≤6, the
 *     Task-Group-4-filtered set passed in via `frameworkChoices`). Selecting a
 *     framework reveals the version axis scoped to it.
 *   - VERSION axis: a SEPARATE control (free-text exact entry + a typeahead
 *     datalist) with the curated RECOMMENDED DEFAULT pre-selected. Off-list
 *     versions are accepted verbatim (free-text exact).
 *   - RESULT: exactly ONE resolved chip (e.g. `Spring Boot 3.4.1`), never a
 *     framework × version cartesian grid. Submitting emits the structured
 *     `{ framework, version }` value (the Task Group 5 shape).
 *
 * ENRICHMENT (FR6 source (c)) is strictly NON-BLOCKING. The optional
 * `enrichmentClient` only AUGMENTS the typeahead suggestion list; it NEVER gates
 * submission and NEVER changes the recommended default. When it fails / is
 * unavailable / returns nothing, a quiet "enrichment unavailable" affordance
 * shows and free-text + recommended default still work. Failures are logged to
 * the console (not silently swallowed).
 *
 * SEAMS (FR8) — this control implements NO Spec 3/4 compute:
 *   - Spec 4: `nudgeSlot` is a stable render slot where Spec 4 will inject its
 *     inline non-blocking nudge + one-click "use this version". Whatever node is
 *     passed renders directly above the version axis.
 *   - Spec 3: the manifest auto-answer writes the SAME `{ framework, version }`
 *     value (incl. the `version-unknown` state) through the Task Group 5
 *     envelope/writer — see `versionControlConfig.ts` + `frameworkVersionShape`.
 *     This control does NOT parse pom.xml / package.json.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type FrameworkVersion,
  resolveFrameworkVersionChip,
} from '../../../api/architectConversationApi';
import {
  offlineNoopEnrichmentClient,
  recommendedVersionFor,
  type VersionEnrichmentClient,
} from './versionControlConfig';
import styles from './VersionedAnswerControl.module.css';

export interface VersionedAnswerControlProps {
  /** The versioned decision code (e.g. `service.framework`). */
  decisionCode: string;
  /**
   * The framework single-select choices — the Task-Group-4-filtered set (already
   * narrowed + may include the `Other (advanced)` sentinel). Target ≤6.
   */
  frameworkChoices: readonly string[];
  /** Disables every control (parent answer in flight). */
  busy?: boolean;
  /**
   * Emits the resolved `{ framework, version }` value on submit. The parent maps
   * this to the Task Group 5 capture envelope + the existing capture path.
   */
  onSubmit: (value: FrameworkVersion) => void;
  /**
   * FR8 Spec 4 nudge slot: a stable render slot for the inline non-blocking
   * vulnerability nudge + one-click "use this version". Rendered above the
   * version axis. This control implements NO Spec 4 compute — it only hosts the
   * injected node. Receives the current framework so the host can scope the
   * nudge; the returned node (if any) is rendered verbatim.
   */
  nudgeSlot?: (ctx: { framework: string | null; version: string }) => React.ReactNode;
  /**
   * Optional NON-BLOCKING enrichment client (FR6 source (c)). Defaults to the
   * offline no-op so the control is fully usable offline. Only AUGMENTS the
   * typeahead; never gates submission; never changes the recommended default.
   */
  enrichmentClient?: VersionEnrichmentClient;
}

export function VersionedAnswerControl({
  decisionCode,
  frameworkChoices,
  busy = false,
  onSubmit,
  nudgeSlot,
  enrichmentClient = offlineNoopEnrichmentClient,
}: VersionedAnswerControlProps) {
  const [framework, setFramework] = useState<string | null>(null);
  const [version, setVersion] = useState<string>('');
  // Enrichment state — NEVER blocks submission. `unavailable` drives the quiet
  // affordance; `suggestions` augment the typeahead datalist.
  const [enrichmentSuggestions, setEnrichmentSuggestions] = useState<string[]>([]);
  const [enrichmentUnavailable, setEnrichmentUnavailable] = useState(false);

  // When a framework is chosen, PRE-SELECT its recommended default version (FR5).
  // Enrichment never touches this.
  const handlePickFramework = (choice: string) => {
    setFramework(choice);
    setVersion(recommendedVersionFor(choice) ?? '');
    setEnrichmentSuggestions([]);
    setEnrichmentUnavailable(false);
  };

  // NON-BLOCKING enrichment: kick off AFTER a framework is chosen + the default
  // is already pre-selected. A failure / empty result / unavailability degrades
  // to the quiet affordance and is logged. Aborts on framework change/unmount.
  const enrichmentSeq = useRef(0);
  useEffect(() => {
    if (!framework) return;
    const seq = ++enrichmentSeq.current;
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const result = await enrichmentClient.fetchVersions(
          decisionCode,
          framework,
          controller.signal,
        );
        if (cancelled || seq !== enrichmentSeq.current) return;
        const versions = result?.versions ?? [];
        setEnrichmentSuggestions(versions);
        // "Unavailable" affordance when enrichment yields nothing to add — the
        // control still works on free-text + recommended default.
        setEnrichmentUnavailable(versions.length === 0);
      } catch (err) {
        if (cancelled || seq !== enrichmentSeq.current) return;
        // Fail-open: log, never throw, never gate. Show the quiet affordance.
        // eslint-disable-next-line no-console
        console.warn(
          `[VersionedAnswerControl] version enrichment unavailable for ${decisionCode}/${framework}; using free-text + recommended default`,
          err,
        );
        setEnrichmentSuggestions([]);
        setEnrichmentUnavailable(true);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [decisionCode, framework, enrichmentClient]);

  // The full typeahead suggestion list: the recommended default first, then any
  // enrichment suggestions (deduped). Recommended default is ALWAYS present.
  const datalistOptions = useMemo(() => {
    const out: string[] = [];
    const recommended = framework ? recommendedVersionFor(framework) : null;
    if (recommended) out.push(recommended);
    for (const v of enrichmentSuggestions) {
      if (!out.includes(v)) out.push(v);
    }
    return out;
  }, [framework, enrichmentSuggestions]);

  const trimmedVersion = version.trim();
  const canSubmit = !!framework && trimmedVersion.length > 0 && !busy;

  // The ONE resolved chip preview (never framework × version cartesian chips).
  const resolvedChip: string | null =
    framework && trimmedVersion.length > 0
      ? resolveFrameworkVersionChip({ framework, version: trimmedVersion })
      : null;

  const datalistId = `versioned-control-versions-${decisionCode}`;

  const handleSubmit = () => {
    if (!framework || trimmedVersion.length === 0) return;
    onSubmit({ framework, version: trimmedVersion });
  };

  return (
    <div
      className={styles.versionedControl}
      data-testid={`versioned-answer-control-${decisionCode}`}
    >
      {/* FRAMEWORK axis — constrained single-select chips (≤6, filtered). */}
      <div className={styles.axisLabel}>Framework</div>
      <div className={styles.chipRow} role="radiogroup" aria-label="Framework">
        {frameworkChoices.map((choice) => {
          const selected = framework === choice;
          return (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={selected}
              className={
                selected
                  ? `${styles.choiceButton} ${styles.choiceButtonSelected}`
                  : styles.choiceButton
              }
              onClick={() => handlePickFramework(choice)}
              disabled={busy}
              data-testid={`versioned-framework-${choice}`}
            >
              {selected ? '✓ ' : ''}
              {choice}
            </button>
          );
        })}
      </div>

      {/* VERSION axis — a SEPARATE control scoped to the chosen framework, with
          the recommended default pre-selected + free-text exact. Only shown once
          a framework is picked. */}
      {framework && (
        <div className={styles.versionAxis} data-testid="versioned-version-axis">
          {/* FR8 Spec 4 nudge slot — stable, above the version input. The control
              implements NO compute; it renders whatever the host injects. */}
          {nudgeSlot && (
            <div
              className={styles.nudgeSlot}
              data-testid="versioned-nudge-slot"
            >
              {nudgeSlot({ framework, version: trimmedVersion })}
            </div>
          )}

          <label className={styles.axisLabel} htmlFor={`versioned-version-input-${decisionCode}`}>
            Version
          </label>
          <div className={styles.inputRow}>
            <input
              id={`versioned-version-input-${decisionCode}`}
              type="text"
              className={styles.inputField}
              list={datalistId}
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="e.g. 3.4.1 (or pick a suggestion)"
              disabled={busy}
              data-testid="versioned-version-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <datalist id={datalistId} data-testid="versioned-version-datalist">
              {datalistOptions.map((opt) => (
                <option key={opt} value={opt} />
              ))}
            </datalist>
          </div>

          {/* Quiet "enrichment unavailable" affordance — NON-BLOCKING. Free-text +
              recommended default still work; submission is never gated. */}
          {enrichmentUnavailable && (
            <small
              className={styles.enrichmentNote}
              data-testid="versioned-enrichment-unavailable"
            >
              Version suggestions unavailable &mdash; type an exact version or use
              the recommended default.
            </small>
          )}

          {/* The ONE resolved chip preview. */}
          {resolvedChip && (
            <div className={styles.resolvedChipRow}>
              <span
                className={styles.resolvedChip}
                data-testid="versioned-resolved-chip"
              >
                {resolvedChip}
              </span>
            </div>
          )}

          <button
            type="button"
            className={styles.primaryButton}
            disabled={!canSubmit}
            onClick={handleSubmit}
            data-testid="versioned-submit"
          >
            {busy ? 'Saving…' : 'Save version'}
          </button>
        </div>
      )}
    </div>
  );
}
