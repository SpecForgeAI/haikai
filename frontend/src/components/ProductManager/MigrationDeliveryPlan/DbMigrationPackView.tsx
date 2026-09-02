/**
 * DbMigrationPackView
 *
 * Spec: 2026-06-11 Source-Grade DB Schema + Data Migration Pack —
 * Task Group 6 (Tasks 6.3 mount, 6.4 pack contents view, 6.6 actions bar +
 * staleness banner + credential prompt, 6.7 epic attachment).
 *
 * The "Schema Migration" surface mounted off `MigrationDeliveryPlanRoute`
 * next to the book of work. Read-mostly:
 *
 *   - coverage summary chips (translated / skipped / flagged),
 *   - staleness banner ("stale — inputs changed since generation") fed by
 *     the pack GET's live snapshot-hash evaluation; regeneration is ONLY
 *     ever the explicit Regenerate button — nothing here auto-regenerates,
 *   - actions bar: Regenerate (enabled when stale), Refresh seeds
 *     (credential prompt), Verify schema (credential prompt + optional
 *     area scope), Download pack (on-demand zip),
 *   - file tree with content preview + manifest highlights (phase ordering,
 *     per-object disposition table with provenance, per-table delta-key
 *     strategies, requires-translation / manual-recreation lists),
 *   - pack-scoped decision queue (FindingsTab list + bulk pattern),
 *   - persisted drift-report history (DriftReportTab pattern),
 *   - one-time DB-epic attachment (picker -> PATCH `work_item_id`).
 *
 * Credentials for the two live-DB actions are prompted per invocation and
 * never stored client-side (see `DbMigrationPackCredentialsModal`).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  generateDbMigrationPack,
  getDbMigrationPack,
  getDbMigrationPackDownloadUrl,
  listDbMigrationPackFiles,
  listDbMigrationPacks,
  refreshDbMigrationPackSeeds,
  regenerateDbMigrationPack,
  verifyDbMigrationPack,
  type DbMigrationPackCredentialedRequest,
  type DbMigrationPackDto,
  type DbMigrationPackFileDto,
  type DbMigrationPackManifest,
  type DbMigrationPackWithStaleness,
  type VerifyDbMigrationPackRequest,
} from '../../../api/dbMigrationPackApi';
import {
  getActiveTargetArchitectureId,
  getSavedTargetArchitectureId,
} from '../../../api/architectConversationApi';
import DbMigrationPackCredentialsModal, {
  type DbMigrationPackCredentialsMode,
} from './DbMigrationPackCredentialsModal';
import DbMigrationPackDecisionQueue from './DbMigrationPackDecisionQueue';
import DbMigrationPackDriftReports from './DbMigrationPackDriftReports';
import DbMigrationPackStructuralFindingsPanel from './DbMigrationPackStructuralFindingsPanel';
import DbMigrationPackEpicPicker from './DbMigrationPackEpicPicker';
import DbMigrationPackTranslationsTab from './DbMigrationPackTranslationsTab';
import styles from './DbMigrationPack.module.css';

export interface DbMigrationPackViewProps {
  projectId: string;
  architectureId: string;
}

type PackSection = 'contents' | 'decisions' | 'drift' | 'translations';

function dispositionBadgeClass(disposition: string): string {
  switch (disposition) {
    case 'translated':
      return styles.badgeTranslated;
    case 'skipped':
      return styles.badgeSkipped;
    case 'flagged':
      return styles.badgeFlagged;
    default:
      return styles.badge;
  }
}

export const DbMigrationPackView: React.FC<DbMigrationPackViewProps> = ({
  projectId,
  architectureId,
}) => {
  const [pack, setPack] = useState<DbMigrationPackWithStaleness | null>(null);
  const [files, setFiles] = useState<DbMigrationPackFileDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [activeSection, setActiveSection] = useState<PackSection>('contents');
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);

  // Per-invocation credential prompt state (never persisted).
  const [credentialsMode, setCredentialsMode] =
    useState<DbMigrationPackCredentialsMode | null>(null);
  const [credentialsBusy, setCredentialsBusy] = useState(false);
  const [credentialsError, setCredentialsError] = useState<string | null>(null);

  // Bumped after each verify run so the drift tab re-fetches its history.
  const [driftRefreshKey, setDriftRefreshKey] = useState(0);

  /** Re-read the pack row (incl. the live staleness evaluation). */
  const refreshPack = useCallback(
    async (packId: string) => {
      const fresh = await getDbMigrationPack(projectId, packId);
      setPack(fresh);
      return fresh;
    },
    [projectId],
  );

  const loadFiles = useCallback(
    async (packId: string) => {
      const rows = await listDbMigrationPackFiles(projectId, packId);
      const ordered = [...rows].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
      );
      setFiles(ordered);
      return ordered;
    },
    [projectId],
  );

  // Initial load: the one active pack for this project+architecture.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const packs = await listDbMigrationPacks(projectId, architectureId);
        if (cancelled) return;
        const existing = packs[0] ?? null;
        if (!existing) {
          setPack(null);
          setFiles([]);
          return;
        }
        const [fresh] = await Promise.all([
          getDbMigrationPack(projectId, existing.id),
          listDbMigrationPackFiles(projectId, existing.id).then((rows) => {
            if (!cancelled) {
              setFiles(
                [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
              );
            }
          }),
        ]);
        if (!cancelled) setPack(fresh);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to load the schema migration pack',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId]);

  const manifest: DbMigrationPackManifest | null = pack?.manifest_json ?? null;

  const selectedFile = useMemo(
    () => files.find((f) => f.file_path === selectedFilePath) ?? null,
    [files, selectedFilePath],
  );

  // --- generate / EXPLICIT regenerate ---------------------------------------

  /**
   * Resolve the decision-binding target for generate/regenerate: active
   * first, then most-recent-saved (closing the target-state conversation
   * stamps saved, not active — mirrors the gateway reader's own fallback,
   * 2026-09-02). Fail-soft null: resolution trouble must never block the
   * explicit action — the gateway reader re-resolves server-side and the
   * manifest records the binding it ACTUALLY read from either way.
   */
  const resolveDecisionBindingTargetId = useCallback(async (): Promise<string | null> => {
    try {
      const active = await getActiveTargetArchitectureId(projectId);
      if (active) return active;
      return await getSavedTargetArchitectureId(projectId);
    } catch {
      return null;
    }
  }, [projectId]);

  const runGeneration = useCallback(
    async (kind: 'generate' | 'regenerate') => {
      if (generating) return;
      setGenerating(true);
      setError(null);
      setNotice(null);
      try {
        const targetArchitectureId = await resolveDecisionBindingTargetId();
        const result =
          kind === 'generate'
            ? await generateDbMigrationPack(
                projectId,
                architectureId,
                undefined,
                targetArchitectureId,
              )
            : await regenerateDbMigrationPack(
                projectId,
                architectureId,
                undefined,
                targetArchitectureId,
              );
        const packId = result.pack.id;
        await Promise.all([refreshPack(packId), loadFiles(packId)]);
        setNotice(
          `${kind === 'generate' ? 'Generated' : 'Regenerated'} pack: ` +
            `${result.file_count} files, ${result.decision_count} open decisions.`,
        );
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : `Pack ${kind === 'generate' ? 'generation' : 'regeneration'} failed`,
        );
      } finally {
        setGenerating(false);
      }
    },
    [
      generating,
      projectId,
      architectureId,
      resolveDecisionBindingTargetId,
      refreshPack,
      loadFiles,
    ],
  );

  // --- decision resolve callback: refetch staleness only --------------------

  const handleDecisionResolved = useCallback(() => {
    if (!pack) return;
    // Resolving marks the pack stale AMS-side; re-read the pack so the
    // banner + Regenerate enablement reflect it. NEVER auto-regenerate.
    void refreshPack(pack.id).catch(() => {
      /* banner refresh is best-effort; the next load shows it */
    });
  }, [pack, refreshPack]);

  // --- credentialed live-DB actions ------------------------------------------

  const handleCredentialsSubmit = useCallback(
    async (
      payload: DbMigrationPackCredentialedRequest | VerifyDbMigrationPackRequest,
    ) => {
      if (!pack || !credentialsMode) return;
      setCredentialsBusy(true);
      setCredentialsError(null);
      try {
        if (credentialsMode === 'refresh-seeds') {
          const result = await refreshDbMigrationPackSeeds(projectId, pack.id, payload);
          await Promise.all([refreshPack(pack.id), loadFiles(pack.id)]);
          setNotice(
            result.seed_changeset_changed
              ? `Seeds refreshed from ${result.scan_sequence_count} scanned sequences — ` +
                `updated ${result.updated_file_path ?? 'the sequences-seed changeset'}.`
              : 'Seed re-scan completed — no seed values changed.',
          );
        } else {
          const result = await verifyDbMigrationPack(
            projectId,
            pack.id,
            payload as VerifyDbMigrationPackRequest,
          );
          setDriftRefreshKey((k) => k + 1);
          setActiveSection('drift');
          setNotice(
            `Verification complete: ${result.report.summary.match_count} match, ` +
              `${result.report.summary.missing_count} missing, ` +
              `${result.report.summary.mismatch_count} mismatch. ` +
              'The drift report was appended to the history.',
          );
        }
        setCredentialsMode(null);
      } catch (err) {
        setCredentialsError(
          err instanceof Error ? err.message : 'The credentialed action failed',
        );
      } finally {
        setCredentialsBusy(false);
      }
    },
    [pack, credentialsMode, projectId, refreshPack, loadFiles],
  );

  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className={styles.surface} data-testid="db-migration-pack-view">
        <div className={styles.emptyMessage}>Loading schema migration pack…</div>
      </div>
    );
  }

  if (!pack) {
    return (
      <div className={styles.surface} data-testid="db-migration-pack-view">
        <div className={styles.surfaceHeader}>
          <div>
            <h2 className={styles.surfaceTitle}>Schema Migration Pack</h2>
            <p className={styles.surfaceSubtitle}>
              Deterministic Liquibase changelogs + data migration scripts
              generated from the committed physical model, discovery findings,
              and captured db.* decisions (Sybase ASE → PostgreSQL).
            </p>
          </div>
        </div>
        {error && (
          <div className={styles.errorBanner} data-testid="db-pack-error">
            {error}
          </div>
        )}
        <div className={styles.emptyMessage} data-testid="db-pack-empty">
          No schema migration pack has been generated for this architecture yet.
        </div>
        <div className={styles.actionsBar}>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
            onClick={() => void runGeneration('generate')}
            disabled={generating}
            data-testid="db-pack-generate-button"
          >
            {generating ? 'Generating…' : 'Generate pack'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.surface} data-testid="db-migration-pack-view">
      <div className={styles.surfaceHeader}>
        <div>
          <h2 className={styles.surfaceTitle}>Schema Migration Pack</h2>
          <p className={styles.surfaceSubtitle}>
            {manifest
              ? `${manifest.source_engine} → ${manifest.target_engine} · ` +
                `type mapping ${manifest.type_mapping_version} · `
              : ''}
            generated {pack.generated_at ?? '—'}
          </p>
        </div>
        {manifest?.scope_receipt &&
          (manifest.scope_receipt.excluded.length > 0 ||
            manifest.scope_receipt.volatile.length > 0) && (
            <div
              data-testid="db-pack-scope-receipt"
              style={{ color: '#555', fontSize: 13, margin: '4px 0' }}
            >
              Scope: {manifest.scope_receipt.total_entities} discovered ·{' '}
              {manifest.scope_receipt.in_scope + manifest.scope_receipt.data_only} in scope ·{' '}
              {manifest.scope_receipt.excluded.length} excluded ·{' '}
              {manifest.scope_receipt.volatile.length} volatile — per foundation decisions{' '}
              {[...manifest.scope_receipt.excluded, ...manifest.scope_receipt.volatile]
                .map((e) => e.decision_ref)
                .filter((r, i, all) => r && all.indexOf(r) === i)
                .join(', ')}
            </div>
          )}
        <div className={styles.coverageChips} data-testid="db-pack-coverage-summary">
          <span
            className={`${styles.coverageChip} ${styles.coverageChipTranslated}`}
            data-testid="db-pack-coverage-translated"
          >
            {pack.translated_count ?? 0} translated
          </span>
          <span
            className={`${styles.coverageChip} ${styles.coverageChipSkipped}`}
            data-testid="db-pack-coverage-skipped"
          >
            {pack.skipped_count ?? 0} skipped
          </span>
          <span
            className={`${styles.coverageChip} ${styles.coverageChipFlagged}`}
            data-testid="db-pack-coverage-flagged"
          >
            {pack.flagged_count ?? 0} flagged
          </span>
        </div>
      </div>

      {/* Staleness banner — informational ONLY; Regenerate stays explicit. */}
      {pack.is_stale && (
        <div className={styles.staleBanner} data-testid="db-pack-stale-banner">
          <span>
            Stale — inputs changed since generation
            {pack.staleness_reason ? `: ${pack.staleness_reason}` : '.'}{' '}
            Review and use Regenerate when ready (regeneration never runs
            automatically).
          </span>
        </div>
      )}

      {error && (
        <div className={styles.errorBanner} data-testid="db-pack-error">
          {error}
        </div>
      )}
      {notice && (
        <div className={styles.noticeBanner} data-testid="db-pack-notice">
          {notice}
        </div>
      )}

      {/* Actions bar -------------------------------------------------------- */}
      <div className={styles.actionsBar} data-testid="db-pack-actions-bar">
        <button
          type="button"
          className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
          onClick={() => void runGeneration('regenerate')}
          disabled={generating}
          title="Regenerate the pack from current inputs (explicit action — the staleness banner tells you when inputs changed)"
          data-testid="db-pack-regenerate-button"
        >
          {generating ? 'Regenerating…' : 'Regenerate'}
        </button>
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => {
            setCredentialsError(null);
            setCredentialsMode('refresh-seeds');
          }}
          data-testid="db-pack-refresh-seeds-button"
        >
          Refresh seeds
        </button>
        <button
          type="button"
          className={styles.actionButton}
          onClick={() => {
            setCredentialsError(null);
            setCredentialsMode('verify');
          }}
          data-testid="db-pack-verify-button"
        >
          Verify schema
        </button>
        <a
          className={styles.actionLink}
          href={getDbMigrationPackDownloadUrl(projectId, pack.id)}
          download={`db-migration-pack-${pack.id}.zip`}
          data-testid="db-pack-download-link"
        >
          Download pack
        </a>
      </div>

      {/* Epic attachment ------------------------------------------------------ */}
      <div className={styles.manifestSection} data-testid="db-pack-epic-attachment">
        <h4 className={styles.manifestSectionTitle}>DB epic attachment</h4>
        {pack.work_item_id ? (
          <span className={styles.epicChip} data-testid="db-pack-attached-epic-chip">
            Attached to book-of-work epic {pack.work_item_id}
          </span>
        ) : (
          <>
            <p className={styles.manifestNote}>
              Choose which book-of-work epic is the DB migration epic — the
              pack attaches to it and the epic's drawer gains a download chip.
            </p>
            <DbMigrationPackEpicPicker
              projectId={projectId}
              packId={pack.id}
              onAttached={(updated: DbMigrationPackDto) =>
                setPack((prev) =>
                  prev ? { ...prev, work_item_id: updated.work_item_id } : prev,
                )
              }
            />
          </>
        )}
      </div>

      {/* Structural findings (Spec 2026-08-04-2) — dispositions gate plan
          generation + Migrate, so the panel sits ABOVE the section tabs where
          it is always visible. Renders nothing when the pack has no findings.
          Keyed by pack id + generation timestamp so an explicit Regenerate
          remounts it with the fresh pack's findings. */}
      <DbMigrationPackStructuralFindingsPanel
        key={`${pack.id}-${pack.generated_at ?? ''}`}
        projectId={projectId}
        packId={pack.id}
        architectureId={architectureId}
        onChanged={handleDecisionResolved}
        onModelChanged={handleDecisionResolved}
        onPackRegenerated={() => {
          // A completed harvest REGENERATED the pack server-side — reuse the
          // post-Regenerate refetch (pack row incl. staleness + file rows).
          void Promise.all([refreshPack(pack.id), loadFiles(pack.id)]).catch(() => {
            /* refresh is best-effort; the next load shows it */
          });
        }}
      />

      {/* Section tabs --------------------------------------------------------- */}
      <div className={styles.sectionTabs}>
        <button
          type="button"
          className={`${styles.sectionTab} ${
            activeSection === 'contents' ? styles.sectionTabActive : ''
          }`}
          onClick={() => setActiveSection('contents')}
          data-testid="db-pack-section-contents"
        >
          Pack contents
        </button>
        <button
          type="button"
          className={`${styles.sectionTab} ${
            activeSection === 'decisions' ? styles.sectionTabActive : ''
          }`}
          onClick={() => setActiveSection('decisions')}
          data-testid="db-pack-section-decisions"
        >
          Decision queue{pack.flagged_count ? ` (${pack.flagged_count} flagged)` : ''}
        </button>
        <button
          type="button"
          className={`${styles.sectionTab} ${
            activeSection === 'drift' ? styles.sectionTabActive : ''
          }`}
          onClick={() => setActiveSection('drift')}
          data-testid="db-pack-section-drift"
        >
          Drift reports
        </button>
        <button
          type="button"
          className={`${styles.sectionTab} ${
            activeSection === 'translations' ? styles.sectionTabActive : ''
          }`}
          onClick={() => setActiveSection('translations')}
          data-testid="db-pack-section-translations"
        >
          Translations
        </button>
      </div>

      {/* Pack contents --------------------------------------------------------- */}
      {activeSection === 'contents' && (
        <>
          <div className={styles.contentsLayout}>
            <div className={styles.fileTree} data-testid="db-pack-file-tree">
              {files.map((f) => (
                <button
                  key={f.file_path}
                  type="button"
                  className={`${styles.fileRow} ${
                    f.file_path === selectedFilePath ? styles.fileRowSelected : ''
                  }`}
                  onClick={() => setSelectedFilePath(f.file_path)}
                  data-testid={`db-pack-file-${f.file_path}`}
                >
                  <span className={styles.fileKindBadge}>{f.file_kind}</span>
                  <span>{f.file_path}</span>
                </button>
              ))}
            </div>
            <div className={styles.filePreview} data-testid="db-pack-file-preview">
              {selectedFile ? (
                <>
                  <p className={styles.filePreviewPath}>{selectedFile.file_path}</p>
                  <pre className={styles.filePreviewContent}>
                    {selectedFile.content}
                  </pre>
                </>
              ) : (
                <div className={styles.emptyMessage}>
                  Select a file to preview its content.
                </div>
              )}
            </div>
          </div>

          {manifest && (
            <>
              <div className={styles.manifestSection} data-testid="db-pack-phase-ordering">
                <h4 className={styles.manifestSectionTitle}>Phase ordering</h4>
                <ol className={styles.orderedList}>
                  {manifest.phase_ordering.map((p, idx) => (
                    <li key={idx}>{p}</li>
                  ))}
                </ol>
                <p className={styles.manifestNote}>{manifest.delete_propagation}</p>
                <p className={styles.manifestNote}>{manifest.seed_margin_note}</p>
              </div>

              <div
                className={styles.manifestSection}
                data-testid="db-pack-delta-strategies"
              >
                <h4 className={styles.manifestSectionTitle}>
                  Per-table delta strategies
                </h4>
                <p className={styles.manifestNote}>
                  Override path: raise/resolve the table's delta_key decision in
                  the decision queue, then Regenerate.
                </p>
                <table className={styles.dataTable}>
                  <thead>
                    <tr>
                      <th>Table</th>
                      <th>Strategy</th>
                      <th>Delta key</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {manifest.delta_strategies.map((d) => (
                      <tr key={d.table} data-testid={`db-pack-delta-${d.table}`}>
                        <td>{d.table}</td>
                        <td>
                          <span
                            className={
                              d.strategy === 'needs_decision'
                                ? styles.badgeFlagged
                                : styles.badge
                            }
                          >
                            {d.strategy}
                          </span>
                        </td>
                        <td>{d.deltaKey ?? '—'}</td>
                        <td>{d.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className={styles.manifestSection} data-testid="db-pack-disposition">
                <h4 className={styles.manifestSectionTitle}>
                  Per-object disposition (coverage ledger)
                </h4>
                <div className={styles.tableScroll}>
                  <table className={styles.dataTable}>
                    <thead>
                      <tr>
                        <th>Type</th>
                        <th>Object</th>
                        <th>Disposition</th>
                        <th>Reason / decisions</th>
                        <th>Provenance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manifest.coverage.objects.map((o, i) => (
                        <tr
                          key={`coverage:${o.objectType}-${o.objectRef}-${i}`}
                          data-testid={`db-pack-disposition-${o.objectRef}`}
                        >
                          <td>{o.objectType}</td>
                          <td>{o.objectRef}</td>
                          <td>
                            <span className={dispositionBadgeClass(o.disposition)}>
                              {o.disposition}
                            </span>
                          </td>
                          <td>
                            {o.reason ?? ''}
                            {(o.decisionKeys ?? []).map((k) => (
                              <span key={k} className={styles.refChip} title={k}>
                                {k}
                              </span>
                            ))}
                          </td>
                          <td>
                            <span
                              className={styles.refChip}
                              title={`entity ${o.provenance.entityId}`}
                            >
                              entity:{o.provenance.entityId}
                            </span>
                            {o.provenance.attributeId && (
                              <span
                                className={styles.refChip}
                                title={`attribute ${o.provenance.attributeId}`}
                              >
                                attr:{o.provenance.attributeId}
                              </span>
                            )}
                            {o.provenance.findingIds.map((id) => (
                              <span
                                key={id}
                                className={styles.refChip}
                                title={`finding ${id}`}
                              >
                                finding:{id}
                              </span>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {(manifest.requires_translation_spec_2.length > 0 ||
                manifest.manual_recreation.length > 0) && (
                <div
                  className={styles.manifestSection}
                  data-testid="db-pack-untranslated"
                >
                  <h4 className={styles.manifestSectionTitle}>
                    Not translated by this pack
                  </h4>
                  {/* Keys are NAMESPACED per list AND index-suffixed
                      (2026-08-30): the two sibling lists shared the
                      `${kind}-${object_ref}` template, so an object present
                      in BOTH (or a ref repeated within one) collided —
                      React's duplicate-key reconciliation then duplicated
                      whole sibling subtrees on the next re-render (the
                      thrice-rendered findings panel; hard refresh reset it). */}
                  {manifest.requires_translation_spec_2.map((u, i) => (
                    <p
                      key={`requires-translation:${u.kind}-${u.object_ref}-${i}`}
                      className={styles.manifestNote}
                    >
                      <span className={styles.badge}>{u.kind}</span> {u.object_ref}{' '}
                      — requires translation (spec 2)
                    </p>
                  ))}
                  {manifest.manual_recreation.map((u, i) => (
                    <p
                      key={`manual-recreation:${u.kind}-${u.object_ref}-${i}`}
                      className={styles.manifestNote}
                    >
                      <span className={styles.badge}>{u.kind}</span> {u.object_ref}{' '}
                      — manual recreation
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Decision queue. Keyed by pack id + generation timestamp (2026-08-12,
          the findings-panel idiom): a regeneration — including the one a
          completed HARVEST runs server-side — re-derives the decision set
          (stale opens pruned AMS-side), so the queue must remount and
          refetch instead of showing the pre-harvest list until a manual
          page refresh. */}
      {activeSection === 'decisions' && (
        <DbMigrationPackDecisionQueue
          key={`${pack.id}-${pack.generated_at ?? ''}`}
          projectId={projectId}
          packId={pack.id}
          onResolved={handleDecisionResolved}
        />
      )}

      {/* Drift reports ----------------------------------------------------------- */}
      {activeSection === 'drift' && (
        <DbMigrationPackDriftReports
          projectId={projectId}
          packId={pack.id}
          refreshKey={driftRefreshKey}
        />
      )}

      {/* Translations (Spec 2026-06-11 LLM-Assisted DB Object Translation
          Drafts — Task Group 5). Approved-only emission changes rewrite pack
          file rows, so a changed emission refreshes the contents file tree. */}
      {activeSection === 'translations' && (
        <DbMigrationPackTranslationsTab
          projectId={projectId}
          packId={pack.id}
          onEmissionChanged={() => {
            void loadFiles(pack.id).catch(() => {
              /* contents refresh is best-effort; the next load shows it */
            });
          }}
        />
      )}

      {/* Per-invocation credential prompt ---------------------------------------- */}
      {credentialsMode && (
        <DbMigrationPackCredentialsModal
          mode={credentialsMode}
          busy={credentialsBusy}
          error={credentialsError}
          onSubmit={(payload) => void handleCredentialsSubmit(payload)}
          onClose={() => {
            if (!credentialsBusy) {
              setCredentialsMode(null);
              setCredentialsError(null);
            }
          }}
        />
      )}
    </div>
  );
};

export default DbMigrationPackView;
