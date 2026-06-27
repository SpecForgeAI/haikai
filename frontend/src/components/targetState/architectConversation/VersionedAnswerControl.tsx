/**
 * VersionedAnswerControl — decoupled framework + version selection
 * (Spec 2026-06-24-target-conversation-tech-stack-constraints, FR5 / FR6 / FR8;
 * reworked by Spec 2026-06-26-target-conversation-versioned-answer-bare-stem-ux,
 * FR1 / FR3 — bare-stem chips, compact horizontal layout, auto-select toggle).
 *
 * The dedicated control for the 24 `versioned` decision codes. It DECOUPLES the
 * framework axis from the version axis so framework x version never explodes into
 * chips, and renders BARE STEMS (`[Spring Boot]`, `[Java]`) rather than
 * version-laden chips (`[Spring Boot 3.4]`):
 *
 *   - FRAMEWORK axis (LEFT): constrained single-select BARE-STEM chips, deduped
 *     from the question's version-laden `choices` via `dedupeBareStemChoices`
 *     (so `Java 21` + `Java 17` collapse to one `[Java]` chip + a version field).
 *   - VERSION axis (RIGHT): in the compact layout the version is a CONFIRMED chip
 *     plus an "Edit version" button; "Edit version" reveals the editable field
 *     (free-text exact + a typeahead datalist, recommended default pre-selected)
 *     and a "Save version" button.
 *   - RESULT: exactly ONE resolved chip (e.g. `Spring Boot 4.0`), never a
 *     framework x version cartesian grid. Submitting emits the structured
 *     `{ framework, version }` value (the unchanged capture shape).
 *
 * AUTO-SELECT (FR3) — driven by the conversation-header toggle threaded in via
 * `autoSelect` (default ON, persisted in localStorage by the host):
 *   - ON: clicking a framework chip IMMEDIATELY commits `{ stem, curated default }`
 *     in ONE action (no separate Save). "Edit version" then re-reveals the field.
 *   - OFF: clicking a framework chip reveals the editable field + "Save version"
 *     from the start (the original two-step flow).
 *   - A version-less stem (`isVersionLessStem`: `none` / `manual` / `in-house` /
 *     `native`-style) commits with NO version REGARDLESS of toggle state; its chip
 *     text is the stem only.
 *
 * ENRICHMENT (FR6 source (c)) is strictly NON-BLOCKING. The optional
 * `enrichmentClient` only AUGMENTS the typeahead suggestion list; it NEVER gates
 * submission and NEVER changes the recommended default. When it fails / is
 * unavailable / returns nothing, a quiet "enrichment unavailable" affordance
 * shows and free-text + recommended default still work. Failures are logged to
 * the console (not silently swallowed).
 *
 * SEAMS (FR8) — this control implements NO Spec 3/4 compute:
 *   - Spec 4: `nudgeSlot` is a stable render slot where Spec 4 injects its inline
 *     non-blocking nudge + one-click "use this version". It renders inside the
 *     revealed version editor, above the version input.
 *   - Spec 3: the manifest auto-answer writes the SAME `{ framework, version }`
 *     value through the unchanged capture envelope — see `versionControlConfig.ts`
 *     + `frameworkVersionShape`. This control does NOT parse pom.xml / package.json.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type FrameworkVersion,
  resolveFrameworkVersionChip,
} from '../../../api/architectConversationApi';
import {
  type BareStemChoice,
  dedupeBareStemChoices,
  isVersionLessStem,
  offlineNoopEnrichmentClient,
  recommendedVersionFor,
  type VersionEnrichmentClient,
} from './versionControlConfig';
import styles from './VersionedAnswerControl.module.css';

export interface VersionedAnswerControlProps {
  /** The versioned decision code (e.g. `service.framework`). */
  decisionCode: string;
  /**
   * The framework single-select choices — the question's `choices` passed
   * VERBATIM (still possibly version-laden, e.g. `['Java 21','Java 17',...]`).
   * The control deduplicates them to BARE-STEM chips via `dedupeBareStemChoices`
   * (FR1), so the seam between the raw choices and the rendered chips lives here.
   */
  frameworkChoices: readonly string[];
  /**
   * Spec 2026-06-27-target-manifest-version-unknown-pending-questions: when set,
   * this is a PENDING versioned question whose framework stem is PRE-CHOSEN from
   * the manifest. The control fixes the framework (chips locked, the pre-chosen
   * stem selected) and reveals the version editor so the user supplies ONLY the
   * version. Null/undefined => unchanged behaviour (framework starts unselected).
   */
  prechosenFramework?: string | null;
  /**
   * Auto-select toggle state (FR3), threaded from the conversation header.
   * ON (default): chip click immediately commits stem + curated default. OFF:
   * chip click reveals the editable version field + "Save version".
   */
  autoSelect?: boolean;
  /** Disables every control (parent answer in flight). */
  busy?: boolean;
  /**
   * Emits the resolved `{ framework, version }` value on submit. The parent maps
   * this to the capture envelope + the existing capture path. A version-less stem
   * emits an EMPTY `version` (the resolved chip is then the stem only).
   */
  onSubmit: (value: FrameworkVersion) => void;
  /**
   * FR8 Spec 4 nudge slot: a stable render slot for the inline non-blocking
   * vulnerability nudge + one-click "use this version". Rendered inside the
   * revealed version editor, above the version input. This control implements NO
   * Spec 4 compute — it only hosts the injected node. Receives the current
   * framework so the host can scope the nudge; the returned node renders verbatim.
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
  prechosenFramework = null,
  autoSelect = true,
  busy = false,
  onSubmit,
  nudgeSlot,
  enrichmentClient = offlineNoopEnrichmentClient,
}: VersionedAnswerControlProps) {
  // BARE-STEM chips (FR1) — the dedup seam between version-laden `choices` and the
  // chip set. `Java 21` + `Java 17` -> one `{ stem:'Java', defaultVersion:'21.0.5' }`.
  const chips = useMemo(
    () => dedupeBareStemChoices(frameworkChoices),
    [frameworkChoices],
  );

  const [framework, setFramework] = useState<string | null>(prechosenFramework ?? null);
  const [version, setVersion] = useState<string>('');
  // Whether the editable version field is revealed (the OFF default view, or the
  // ON view after "Edit version"). Committed-but-not-editing shows the confirmed
  // chip + "Edit version" instead.
  const [editing, setEditing] = useState(
    prechosenFramework != null && !isVersionLessStem(prechosenFramework),
  );
  // Enrichment state — NEVER blocks submission. `unavailable` drives the quiet
  // affordance; `suggestions` augment the typeahead datalist.
  const [enrichmentSuggestions, setEnrichmentSuggestions] = useState<string[]>([]);
  const [enrichmentUnavailable, setEnrichmentUnavailable] = useState(false);

  // Spec 2026-06-27: a PENDING versioned question arrives with the framework stem
  // PRE-CHOSEN (only the version needs filling). Seed the framework + reveal the
  // version editor when `prechosenFramework` is present; re-seed when the pending
  // coordinate (decisionCode) or the pre-chosen stem changes. When null the
  // control behaves exactly as before (framework starts unselected).
  useEffect(() => {
    if (!prechosenFramework) return;
    setFramework(prechosenFramework);
    setVersion('');
    setEnrichmentSuggestions([]);
    setEnrichmentUnavailable(false);
    setEditing(!isVersionLessStem(prechosenFramework));
  }, [decisionCode, prechosenFramework]);

  // Selecting a framework chip. Behaviour forks on the auto-select toggle and on
  // whether the stem is version-less.
  const handlePickFramework = (choice: BareStemChoice) => {
    setFramework(choice.stem);
    setEnrichmentSuggestions([]);
    setEnrichmentUnavailable(false);

    // Version-less stem (FR1/Q5): commit with NO version regardless of toggle.
    if (isVersionLessStem(choice.stem)) {
      setVersion('');
      setEditing(false);
      onSubmit({ framework: choice.stem, version: '' });
      return;
    }

    const def = choice.defaultVersion ?? '';
    setVersion(def);
    if (autoSelect && def.length > 0) {
      // Toggle ON + a curated default present: commit in ONE action.
      setEditing(false);
      onSubmit({ framework: choice.stem, version: def });
    } else {
      // Toggle OFF, or no curated default to commit: reveal the editable field.
      setEditing(true);
    }
  };

  // NON-BLOCKING enrichment: kick off AFTER a (non-version-less) framework is
  // chosen + the default is already pre-selected. A failure / empty result /
  // unavailability degrades to the quiet affordance and is logged. Aborts on
  // framework change/unmount.
  const enrichmentSeq = useRef(0);
  useEffect(() => {
    if (!framework || isVersionLessStem(framework) || !editing) return;
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
  }, [decisionCode, framework, editing, enrichmentClient]);

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
  const selectedIsVersionLess = framework != null && isVersionLessStem(framework);
  const selectedIsVersioned = framework != null && !selectedIsVersionLess;
  const canSave = selectedIsVersioned && trimmedVersion.length > 0 && !busy;

  // The ONE resolved chip (committed value, or live preview while editing). For a
  // version-less stem the empty version resolves to the stem only.
  const resolvedChip: string | null = !framework
    ? null
    : selectedIsVersionLess
      ? resolveFrameworkVersionChip({ framework, version: '' })
      : trimmedVersion.length > 0
        ? resolveFrameworkVersionChip({ framework, version: trimmedVersion })
        : null;

  const datalistId = `versioned-control-versions-${decisionCode}`;

  const handleSaveVersion = () => {
    if (!selectedIsVersioned || !framework || trimmedVersion.length === 0) return;
    setEditing(false);
    onSubmit({ framework, version: trimmedVersion });
  };

  return (
    <div
      className={styles.versionedControl}
      data-testid={`versioned-answer-control-${decisionCode}`}
    >
      {/* Compact HORIZONTAL layout: bare-stem framework chips on the LEFT, the
          version (confirmed chip + Edit, or the editable field) on the RIGHT. */}
      <div className={styles.compactRow}>
        <div
          className={styles.frameworkSide}
          role="radiogroup"
          aria-label="Framework"
        >
          {chips.map((choice) => {
            const selected = framework === choice.stem;
            return (
              <button
                key={choice.stem}
                type="button"
                role="radio"
                aria-checked={selected}
                className={
                  selected
                    ? `${styles.choiceButton} ${styles.choiceButtonSelected}`
                    : styles.choiceButton
                }
                onClick={() => handlePickFramework(choice)}
                disabled={busy || prechosenFramework != null}
                data-testid={`versioned-framework-${choice.stem}`}
              >
                {selected ? '✓ ' : ''}
                {choice.stem}
              </button>
            );
          })}
        </div>

        {framework && (
          <div className={styles.versionSide} data-testid="versioned-version-side">
            {/* The ONE resolved chip (confirmed value or live preview). */}
            {resolvedChip && (
              <span
                className={styles.resolvedChip}
                data-testid="versioned-resolved-chip"
              >
                {resolvedChip}
              </span>
            )}

            {/* Committed, non-editing, versioned stem -> the "Edit version"
                escape hatch (compact view). A version-less stem has no version to
                edit, so no button. */}
            {selectedIsVersioned && !editing && (
              <button
                type="button"
                className={styles.editButton}
                onClick={() => setEditing(true)}
                disabled={busy}
                data-testid="versioned-edit-version"
              >
                Edit version
              </button>
            )}

            {/* Editing -> the version field + datalist + "Save version" (this is
                also the toggle-OFF default view). */}
            {selectedIsVersioned && editing && (
              <div className={styles.versionEditor} data-testid="versioned-version-axis">
                {/* FR8 Spec 4 nudge slot — stable, above the version input. */}
                {nudgeSlot && (
                  <div className={styles.nudgeSlot} data-testid="versioned-nudge-slot">
                    {nudgeSlot({ framework, version: trimmedVersion })}
                  </div>
                )}

                <div className={styles.inputRow}>
                  <input
                    id={`versioned-version-input-${decisionCode}`}
                    type="text"
                    aria-label="Version"
                    className={styles.inputField}
                    list={datalistId}
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="e.g. 4.0 (or pick a suggestion)"
                    disabled={busy}
                    data-testid="versioned-version-input"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSaveVersion();
                      }
                    }}
                  />
                  <datalist id={datalistId} data-testid="versioned-version-datalist">
                    {datalistOptions.map((opt) => (
                      <option key={opt} value={opt} />
                    ))}
                  </datalist>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    disabled={!canSave}
                    onClick={handleSaveVersion}
                    data-testid="versioned-submit"
                  >
                    {busy ? 'Saving…' : 'Save version'}
                  </button>
                </div>

                {/* Quiet "enrichment unavailable" affordance — NON-BLOCKING.
                    Free-text + recommended default still work; never gated. */}
                {enrichmentUnavailable && (
                  <small
                    className={styles.enrichmentNote}
                    data-testid="versioned-enrichment-unavailable"
                  >
                    Version suggestions unavailable &mdash; type an exact version or
                    use the recommended default.
                  </small>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
