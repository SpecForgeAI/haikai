/**
 * SyncDialog — Phase D
 *
 * Single modal driving the Tool ↔ Jira two-way sync flow:
 *   config → analyzing → preview → executing → result
 *
 * Uses an internal state machine so we don't have to juggle multiple modal
 * components and can share the analysis result between preview and result
 * phases (for the "Re-analyze" button).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchWorkItems } from '../../api/workItemsApi';
import {
  analyzeSync,
  executeSync,
  fetchProjectIssueTypes,
  type GoldenSource,
  type JiraIssueTypeRef,
  type SyncAction,
  type SyncActionItem,
  type SyncAnalysisResult,
  type SyncExecuteResult,
  type SyncExecuteResultItem,
  type TypeMapping,
} from '../../api/syncApi';
import type { WorkItem } from '../../types/workItems';
import styles from './SyncDialog.module.css';

// ---------------------------------------------------------------------------
// Helpers: subtree walk + project key detection (frontend, no extra API call)
// ---------------------------------------------------------------------------

function walkSubtree(allItems: WorkItem[], rootId: string): WorkItem[] {
  const childrenByParent = new Map<string, WorkItem[]>();
  for (const item of allItems) {
    const key = item.parentId ?? '';
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key)!.push(item);
  }
  const root = allItems.find((i) => i.id === rootId);
  if (!root) return [];
  const out: WorkItem[] = [root];
  const queue: WorkItem[] = [root];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const kids = childrenByParent.get(cur.id) ?? [];
    for (const c of kids) {
      out.push(c);
      queue.push(c);
    }
  }
  return out;
}

function detectJiraProjectKeys(items: WorkItem[]): string[] {
  const keys = new Set<string>();
  for (const i of items) {
    if (i.externalKey) {
      const dash = i.externalKey.indexOf('-');
      if (dash > 0) keys.add(i.externalKey.substring(0, dash));
    }
  }
  return [...keys].sort();
}

/**
 * Stable per-action ID — combines toolId + externalKey + action so that
 * checkbox state survives re-analysis as long as the same row is produced.
 */
function actionId(a: SyncActionItem): string {
  return `${a.action}::${a.toolId ?? ''}::${a.externalKey ?? ''}`;
}

// ---------------------------------------------------------------------------
// Tool type hierarchy (level numbers used to compute the anchor offset)
// ---------------------------------------------------------------------------

/**
 * Tool's conventional hierarchy. Level 4 is highest (INITIATIVE), level 0 is
 * the leaf tier (peers TASK/BUG/TEST). Used by the dynamic-mapping flow to
 * compute "shift down by N" relative to the sync root's anchor.
 */
const TOOL_TYPE_LEVEL: Record<string, number> = {
  INITIATIVE: 4,
  EPIC: 3,
  FEATURE: 2,
  STORY: 1,
  TASK: 0,
  BUG: 0,
  TEST: 0,
};

/** All tool types we'd potentially need to map. Ordered top-to-bottom. */
const TOOL_TYPES_ORDERED = ['INITIATIVE', 'EPIC', 'FEATURE', 'STORY', 'TASK', 'BUG', 'TEST'];

/**
 * Computes a default Tool→Jira type mapping by anchoring the sync root's tool
 * type to its existing Jira issue type, then hierarchy-shifting downward.
 *
 * @param rootToolType  the tool type of the selected sync root (e.g. "INITIATIVE")
 * @param anchorJiraType  the Jira issue type name the root is currently linked to (e.g. "Epic")
 * @param projectTypes  all Jira issue types available in the target project
 * @returns mapping for each tool type. Some tool types may map to null if the
 *          target Jira hierarchy doesn't go that deep (caller surfaces these as
 *          depth-mismatch warnings).
 */
function computeAutoMapping(
  rootToolType: string,
  anchorJiraType: string,
  projectTypes: JiraIssueTypeRef[],
): { mapping: Record<string, string>; unmappable: string[] } {
  const anchor = projectTypes.find((t) => t.name === anchorJiraType);
  const rootLevel = TOOL_TYPE_LEVEL[rootToolType.toUpperCase()] ?? 0;
  const anchorLevel = anchor?.hierarchyLevel ?? 1;
  const offset = rootLevel - anchorLevel;

  // Group project types by hierarchy level for fast lookup
  const typesByLevel = new Map<number, JiraIssueTypeRef[]>();
  for (const t of projectTypes) {
    const lvl = t.hierarchyLevel ?? 0;
    if (!typesByLevel.has(lvl)) typesByLevel.set(lvl, []);
    typesByLevel.get(lvl)!.push(t);
  }

  const mapping: Record<string, string> = {};
  const unmappable: string[] = [];

  for (const toolType of TOOL_TYPES_ORDERED) {
    const targetLevel = TOOL_TYPE_LEVEL[toolType] - offset;
    const candidates = typesByLevel.get(targetLevel);
    if (!candidates || candidates.length === 0) {
      unmappable.push(toolType);
      continue;
    }
    if (toolType === rootToolType.toUpperCase()) {
      mapping[toolType] = anchorJiraType;
      continue;
    }
    // Prefer name-match for peer types: TASK→Task, BUG→Bug, TEST→Test, then Subtask
    const nameMatch = candidates.find((t) => t.name.toUpperCase() === toolType);
    if (nameMatch) {
      mapping[toolType] = nameMatch.name;
      continue;
    }
    if (toolType === 'TEST') {
      const subtaskByName = candidates.find((t) => t.name.toLowerCase() === 'subtask' || t.subtask);
      if (subtaskByName) {
        mapping[toolType] = subtaskByName.name;
        continue;
      }
    }
    // Fallback: first candidate at that level
    mapping[toolType] = candidates[0].name;
  }

  return { mapping, unmappable };
}

// ---------------------------------------------------------------------------
// Action group ordering and labels
// ---------------------------------------------------------------------------

const ACTION_ORDER: SyncAction[] = [
  'UPDATE_JIRA', 'UPDATE_TOOL', 'CREATE_IN_JIRA', 'CREATE_IN_TOOL', 'UPLOAD_SPEC_TO_JIRA', 'NO_CHANGE',
];

const ACTION_LABELS: Record<SyncAction, string> = {
  UPDATE_JIRA: 'Update in Jira',
  UPDATE_TOOL: 'Update in Tool',
  CREATE_IN_JIRA: 'Create in Jira',
  CREATE_IN_TOOL: 'Create in Tool',
  UPLOAD_SPEC_TO_JIRA: 'Upload specs to Jira',
  NO_CHANGE: 'No change',
};

const ACTION_COLOUR_CLASS: Record<SyncAction, string> = {
  UPDATE_JIRA: styles.actionUpdateJira,
  UPDATE_TOOL: styles.actionUpdateTool,
  CREATE_IN_JIRA: styles.actionCreateInJira,
  CREATE_IN_TOOL: styles.actionCreateInTool,
  UPLOAD_SPEC_TO_JIRA: styles.actionCreateInJira,
  NO_CHANGE: styles.actionNoChange,
};

// ---------------------------------------------------------------------------
// Component types
// ---------------------------------------------------------------------------

type Phase = 'config' | 'analyzing' | 'preview' | 'executing' | 'result';

export interface SyncDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  rootWorkItem: WorkItem;
  /** Called after Refresh & Close, so the host can reload its tree state. */
  onSyncComplete?: () => void;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SyncDialog({
  isOpen,
  onClose,
  projectId,
  rootWorkItem,
  onSyncComplete,
}: SyncDialogProps) {
  const [phase, setPhase] = useState<Phase>('config');
  const [goldenSource, setGoldenSource] = useState<GoldenSource>('TOOL');
  const [jiraProjectKey, setJiraProjectKey] = useState('');
  const [detectedKeys, setDetectedKeys] = useState<string[]>([]);
  const [subtreeSize, setSubtreeSize] = useState<number>(0);
  const [analysis, setAnalysis] = useState<SyncAnalysisResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedDiffs, setExpandedDiffs] = useState<Set<string>>(new Set());
  const [showNoChange, setShowNoChange] = useState<boolean>(false);
  const [executeResult, setExecuteResult] = useState<SyncExecuteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ---- D-ext 1: dynamic type mapping state ----
  const [useDynamicMapping, setUseDynamicMapping] = useState<boolean>(true);
  const [projectTypes, setProjectTypes] = useState<JiraIssueTypeRef[]>([]);
  const [anchorJiraType, setAnchorJiraType] = useState<string | null>(null);
  const [typeMapping, setTypeMapping] = useState<TypeMapping>({});
  const [unmappableToolTypes, setUnmappableToolTypes] = useState<string[]>([]);

  // -----------------------------------------------------------------------
  // On open: fetch all work items, walk subtree, detect Jira project keys
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!isOpen) return;
    setPhase('config');
    setGoldenSource('TOOL');
    setError(null);
    setAnalysis(null);
    setExecuteResult(null);
    setSelectedIds(new Set());
    setExpandedDiffs(new Set());
    setShowNoChange(false);

    setUseDynamicMapping(true);
    setProjectTypes([]);
    setAnchorJiraType(null);
    setTypeMapping({});
    setUnmappableToolTypes([]);

    fetchWorkItems(projectId)
      .then((all) => {
        const subtree = walkSubtree(all, rootWorkItem.id);
        setSubtreeSize(subtree.length);
        const keys = detectJiraProjectKeys(subtree);
        setDetectedKeys(keys);
        const initialKey = keys.length >= 1 ? keys[0] : '';
        setJiraProjectKey(initialKey);

        // D-ext 1: if root has an external_key in this Jira project, fetch the
        // project's issue types + the anchor's raw type and compute a default
        // tool→Jira mapping. Skipped (and falls back to static yml) when there's
        // no anchor. Initial fetch always runs; the checkbox controls whether
        // the mapping is then used on submit.
        if (rootWorkItem.externalKey && initialKey) {
          const anchorPrefix = rootWorkItem.externalKey.split('-')[0];
          if (anchorPrefix === initialKey) {
            void fetchProjectIssueTypes(initialKey, rootWorkItem.externalKey)
              .then((info) => {
                setProjectTypes(info.types);
                setAnchorJiraType(info.anchorType);
                if (info.anchorType) {
                  const { mapping, unmappable } = computeAutoMapping(
                    rootWorkItem.type,
                    info.anchorType,
                    info.types,
                  );
                  setTypeMapping(mapping);
                  setUnmappableToolTypes(unmappable);
                }
              })
              .catch((e) => {
                // Non-fatal — analyse will fall back to static yml
                console.warn('Could not fetch project issue types:', e);
              });
          }
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [isOpen, projectId, rootWorkItem.id, rootWorkItem.externalKey, rootWorkItem.type]);

  // -----------------------------------------------------------------------
  // Run analyze
  // -----------------------------------------------------------------------
  const runAnalyze = useCallback(async () => {
    if (!jiraProjectKey.trim()) {
      setError('Jira project key is required');
      return;
    }
    setError(null);
    setPhase('analyzing');
    try {
      const result = await analyzeSync({
        projectId,
        rootWorkItemId: rootWorkItem.id,
        goldenSource,
        jiraProjectKey: jiraProjectKey.trim(),
        // Only send the dynamic mapping when the user has opted in via the
        // checkbox. Otherwise backend falls back to the static yml mapping.
        typeMapping: useDynamicMapping && Object.keys(typeMapping).length > 0
          ? typeMapping
          : undefined,
      });
      setAnalysis(result);
      // Default-select all rows except NO_CHANGE
      const initialSelection = new Set(
        result.actions.filter((a) => a.action !== 'NO_CHANGE').map(actionId),
      );
      setSelectedIds(initialSelection);
      setExpandedDiffs(new Set());
      setPhase('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('config');
    }
  }, [projectId, rootWorkItem.id, goldenSource, jiraProjectKey]);

  // -----------------------------------------------------------------------
  // Run execute
  // -----------------------------------------------------------------------
  const runExecute = useCallback(async () => {
    if (!analysis) return;
    setError(null);
    const selectedActions = analysis.actions.filter((a) => selectedIds.has(actionId(a)));
    if (selectedActions.length === 0) {
      setError('Select at least one item to sync.');
      return;
    }
    setPhase('executing');
    try {
      const result = await executeSync({
        projectId,
        rootWorkItemId: rootWorkItem.id,
        goldenSource: analysis.goldenSource,
        jiraProjectKey: analysis.jiraProjectKey,
        actions: selectedActions,
        typeMapping: useDynamicMapping && Object.keys(typeMapping).length > 0
          ? typeMapping
          : undefined,
      });
      setExecuteResult(result);
      setPhase('result');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('preview');
    }
  }, [analysis, selectedIds, projectId, rootWorkItem.id]);

  // -----------------------------------------------------------------------
  // Re-analyze (from result screen) — re-runs analyze with the same config
  // -----------------------------------------------------------------------
  const reanalyze = useCallback(() => {
    setExecuteResult(null);
    void runAnalyze();
  }, [runAnalyze]);

  // -----------------------------------------------------------------------
  // Close + notify host
  // -----------------------------------------------------------------------
  const handleClose = useCallback(() => {
    if (executeResult) {
      onSyncComplete?.();
    }
    onClose();
  }, [executeResult, onSyncComplete, onClose]);

  // -----------------------------------------------------------------------
  // Selection helpers
  // -----------------------------------------------------------------------
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (!analysis) return;
    setSelectedIds(new Set(analysis.actions.map(actionId)));
  }, [analysis]);

  const deselectAll = useCallback(() => setSelectedIds(new Set()), []);

  const toggleDiff = useCallback((id: string) => {
    setExpandedDiffs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // -----------------------------------------------------------------------
  // Group actions by type for preview/result rendering
  // -----------------------------------------------------------------------
  const groupedActions = useMemo(() => {
    if (!analysis) return null;
    const groups: Record<SyncAction, SyncActionItem[]> = {
      CREATE_IN_JIRA: [], CREATE_IN_TOOL: [], UPDATE_JIRA: [],
      UPDATE_TOOL: [], UPLOAD_SPEC_TO_JIRA: [], NO_CHANGE: [],
    };
    for (const a of analysis.actions) groups[a.action].push(a);
    return groups;
  }, [analysis]);

  const groupedResults = useMemo(() => {
    if (!executeResult) return null;
    const groups: Record<SyncAction, SyncExecuteResultItem[]> = {
      CREATE_IN_JIRA: [], CREATE_IN_TOOL: [], UPDATE_JIRA: [],
      UPDATE_TOOL: [], UPLOAD_SPEC_TO_JIRA: [], NO_CHANGE: [],
    };
    for (const r of executeResult.results) groups[r.action].push(r);
    return groups;
  }, [executeResult]);

  if (!isOpen) return null;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" data-testid="sync-dialog">
      <div className={styles.dialog}>
        <div className={styles.header}>
          <h2 className={styles.headerTitle}>
            Sync &ldquo;{rootWorkItem.title}&rdquo; with Jira
          </h2>
          <button className={styles.closeButton} onClick={handleClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.body}>
          {error && <div className={styles.errorBanner}>{error}</div>}

          {phase === 'config' && (
            <ConfigPhase
              goldenSource={goldenSource}
              onGoldenSourceChange={setGoldenSource}
              jiraProjectKey={jiraProjectKey}
              onJiraProjectKeyChange={setJiraProjectKey}
              detectedKeys={detectedKeys}
              subtreeSize={subtreeSize}
              rootItem={rootWorkItem}
              useDynamicMapping={useDynamicMapping}
              onUseDynamicMappingChange={setUseDynamicMapping}
              anchorJiraType={anchorJiraType}
              typeMapping={typeMapping}
              unmappableToolTypes={unmappableToolTypes}
              projectTypes={projectTypes}
              onTypeMappingChange={setTypeMapping}
            />
          )}

          {phase === 'analyzing' && (
            <div className={styles.spinnerContainer}>
              <div className={styles.spinner} />
              <div>Analysing subtree against Jira…</div>
            </div>
          )}

          {phase === 'preview' && analysis && groupedActions && (
            <PreviewPhase
              analysis={analysis}
              groupedActions={groupedActions}
              selectedIds={selectedIds}
              expandedDiffs={expandedDiffs}
              showNoChange={showNoChange}
              onToggleSelect={toggleSelect}
              onSelectAll={selectAll}
              onDeselectAll={deselectAll}
              onToggleDiff={toggleDiff}
              onToggleNoChange={() => setShowNoChange((v) => !v)}
            />
          )}

          {phase === 'executing' && (
            <div className={styles.spinnerContainer}>
              <div className={styles.spinner} />
              <div>Syncing…</div>
            </div>
          )}

          {phase === 'result' && executeResult && groupedResults && (
            <ResultPhase
              executeResult={executeResult}
              groupedResults={groupedResults}
            />
          )}
        </div>

        <div className={styles.footer}>
          {phase === 'config' && (
            <>
              <button className={styles.buttonSecondary} onClick={handleClose}>Cancel</button>
              <button
                className={styles.buttonPrimary}
                onClick={runAnalyze}
                disabled={!jiraProjectKey.trim()}
              >
                Run analysis →
              </button>
            </>
          )}

          {phase === 'preview' && analysis && (
            <>
              <button className={styles.buttonSecondary} onClick={() => setPhase('config')}>
                ← Back
              </button>
              <button
                className={styles.buttonPrimary}
                onClick={runExecute}
                disabled={selectedIds.size === 0}
              >
                Sync {selectedIds.size} selected
              </button>
            </>
          )}

          {phase === 'result' && (
            <>
              <button className={styles.buttonSecondary} onClick={reanalyze}>
                Re-analyze
              </button>
              <button className={styles.buttonPrimary} onClick={handleClose}>
                Refresh & Close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Config phase
// ===========================================================================

function ConfigPhase({
  goldenSource,
  onGoldenSourceChange,
  jiraProjectKey,
  onJiraProjectKeyChange,
  detectedKeys,
  subtreeSize,
  rootItem,
  useDynamicMapping,
  onUseDynamicMappingChange,
  anchorJiraType,
  typeMapping,
  unmappableToolTypes,
  projectTypes,
  onTypeMappingChange,
}: {
  goldenSource: GoldenSource;
  onGoldenSourceChange: (v: GoldenSource) => void;
  jiraProjectKey: string;
  onJiraProjectKeyChange: (v: string) => void;
  detectedKeys: string[];
  subtreeSize: number;
  rootItem: WorkItem;
  useDynamicMapping: boolean;
  onUseDynamicMappingChange: (v: boolean) => void;
  anchorJiraType: string | null;
  typeMapping: TypeMapping;
  unmappableToolTypes: string[];
  projectTypes: JiraIssueTypeRef[];
  onTypeMappingChange: (m: TypeMapping) => void;
}) {
  return (
    <>
      <div className={styles.field}>
        <div className={styles.fieldHelp}>
          Subtree under <strong>{rootItem.title}</strong> ({rootItem.type}) —{' '}
          {subtreeSize} item{subtreeSize === 1 ? '' : 's'}.
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel}>
          Which is the golden source for items that exist in both?
        </label>
        <div className={styles.radioGroup}>
          <label className={styles.radioOption}>
            <input
              type="radio"
              name="goldenSource"
              value="TOOL"
              checked={goldenSource === 'TOOL'}
              onChange={() => onGoldenSourceChange('TOOL')}
            />
            <span>
              <span className={styles.radioOptionLabel}>Tool</span>
              <br />
              <span className={styles.radioOptionDescription}>
                Differences flow Tool → Jira (Jira gets overwritten)
              </span>
            </span>
          </label>
          <label className={styles.radioOption}>
            <input
              type="radio"
              name="goldenSource"
              value="JIRA"
              checked={goldenSource === 'JIRA'}
              onChange={() => onGoldenSourceChange('JIRA')}
            />
            <span>
              <span className={styles.radioOptionLabel}>Jira</span>
              <br />
              <span className={styles.radioOptionDescription}>
                Differences flow Jira → Tool (the tool gets overwritten)
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="jiraProjectKey">
          Jira project key
        </label>
        {detectedKeys.length > 1 ? (
          <select
            id="jiraProjectKey"
            className={styles.selectInput}
            value={jiraProjectKey}
            onChange={(e) => onJiraProjectKeyChange(e.target.value)}
          >
            {detectedKeys.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        ) : (
          <input
            id="jiraProjectKey"
            className={styles.textInput}
            type="text"
            placeholder="e.g. KAN"
            value={jiraProjectKey}
            onChange={(e) => onJiraProjectKeyChange(e.target.value)}
          />
        )}
        <div className={styles.fieldHelp}>
          {detectedKeys.length === 0 && (
            <>No items in this subtree are linked to Jira yet — all will be created in the project you specify.</>
          )}
          {detectedKeys.length === 1 && (
            <>Detected from items already linked: <strong>{detectedKeys[0]}</strong>. Override above if needed.</>
          )}
          {detectedKeys.length > 1 && (
            <>Subtree contains items linked to multiple Jira projects: {detectedKeys.join(', ')}. Pick one — items linked to other projects will be excluded with a warning.</>
          )}
        </div>
      </div>

      {/* Dynamic-mapping toggle */}
      <div className={styles.field}>
        <label className={styles.radioOption} style={{ alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={useDynamicMapping}
            onChange={(e) => onUseDynamicMappingChange(e.target.checked)}
            data-testid="dynamic-mapping-toggle"
          />
          <span>
            <span className={styles.radioOptionLabel}>Dynamically type-map?</span>
            <br />
            <span className={styles.radioOptionDescription}>
              When on, this sync uses an auto-shifted Tool→Jira mapping anchored on the
              selected root's existing Jira link. When off, the static yml in jira-service
              is used (good for projects with stable, project-wide conventions).
            </span>
          </span>
        </label>
      </div>

      {/* D-ext 1/2/3: dynamic mapping panel — only visible when checkbox is on AND we have an anchor */}
      {useDynamicMapping && anchorJiraType && Object.keys(typeMapping).length > 0 && (
        <TypeMappingPanel
          rootItem={rootItem}
          anchorJiraType={anchorJiraType}
          mapping={typeMapping}
          onMappingChange={onTypeMappingChange}
          unmappable={unmappableToolTypes}
          projectTypes={projectTypes}
        />
      )}
    </>
  );
}

/**
 * D-ext 1: read-only display of inferred mapping.
 * D-ext 2: per-row dropdown overrides.
 * D-ext 3: depth-mismatch warning panel for unmappable tool types.
 */
function TypeMappingPanel({
  rootItem,
  anchorJiraType,
  mapping,
  onMappingChange,
  unmappable,
  projectTypes,
}: {
  rootItem: WorkItem;
  anchorJiraType: string;
  mapping: TypeMapping;
  onMappingChange: (m: TypeMapping) => void;
  unmappable: string[];
  projectTypes: JiraIssueTypeRef[];
}) {
  const handleOverride = (toolType: string, jiraType: string) => {
    onMappingChange({ ...mapping, [toolType]: jiraType });
  };

  const removeMapping = (toolType: string) => {
    const next = { ...mapping };
    delete next[toolType];
    onMappingChange(next);
  };

  // Sort projectTypes by hierarchyLevel descending for dropdowns
  const sortedTypes = [...projectTypes].sort(
    (a, b) => (b.hierarchyLevel ?? 0) - (a.hierarchyLevel ?? 0),
  );

  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel}>Type mapping (auto-inferred)</label>
      <div className={styles.fieldHelp} style={{ marginBottom: 8 }}>
        Anchor: <strong>{rootItem.type}</strong> → <strong>{anchorJiraType}</strong>{' '}
        (from existing link <code>{rootItem.externalKey}</code>). Other levels shifted accordingly.
      </div>

      {unmappable.length > 0 && (
        <div className={styles.warningsPanel} style={{ marginBottom: 10 }}>
          <p className={styles.warningsPanelTitle}>
            Depth mismatch — Jira hierarchy is shallower than your tool subtree
          </p>
          <ul className={styles.warningsPanelList}>
            <li>
              These tool types have no matching Jira level in this project and would be{' '}
              <strong>excluded</strong> from sync if you proceed:{' '}
              <strong>{unmappable.join(', ')}</strong>.
            </li>
            <li>
              To fix: cancel and adjust the Jira project's hierarchy schema, or proceed and
              accept that those items won't be synced.
            </li>
          </ul>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '4px 8px', color: '#374151' }}>Tool type</th>
            <th style={{ textAlign: 'left', padding: '4px 8px', color: '#374151' }}>→ Jira issue type</th>
          </tr>
        </thead>
        <tbody>
          {TOOL_TYPES_ORDERED.map((toolType) => {
            const isUnmappable = unmappable.includes(toolType);
            const currentJiraType = mapping[toolType];
            return (
              <tr key={toolType} style={{ borderTop: '1px solid #e5e7eb' }}>
                <td style={{ padding: '6px 8px', fontFamily: 'inherit', color: isUnmappable ? '#9ca3af' : '#111827' }}>
                  <span className={styles.typePill} style={{ marginRight: 6 }}>{toolType}</span>
                </td>
                <td style={{ padding: '6px 8px' }}>
                  {isUnmappable ? (
                    <em style={{ color: '#9ca3af' }}>excluded — no matching Jira level</em>
                  ) : (
                    <select
                      className={styles.selectInput}
                      value={currentJiraType ?? ''}
                      onChange={(e) => {
                        if (e.target.value === '') removeMapping(toolType);
                        else handleOverride(toolType, e.target.value);
                      }}
                      style={{ width: 'auto', minWidth: 160 }}
                    >
                      <option value="">(skip)</option>
                      {sortedTypes.map((t) => (
                        <option key={t.id} value={t.name}>
                          {t.name}{t.hierarchyLevel !== null ? ` (level ${t.hierarchyLevel})` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ===========================================================================
// Preview phase
// ===========================================================================

function PreviewPhase({
  analysis,
  groupedActions,
  selectedIds,
  expandedDiffs,
  showNoChange,
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
  onToggleDiff,
  onToggleNoChange,
}: {
  analysis: SyncAnalysisResult;
  groupedActions: Record<SyncAction, SyncActionItem[]>;
  selectedIds: Set<string>;
  expandedDiffs: Set<string>;
  showNoChange: boolean;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onToggleDiff: (id: string) => void;
  onToggleNoChange: () => void;
}) {
  const totalActionable = analysis.actions.filter((a) => a.action !== 'NO_CHANGE').length;

  if (analysis.actions.length === 0) {
    return (
      <div className={styles.emptyState}>
        Nothing in the subtree to sync.
      </div>
    );
  }

  if (totalActionable === 0) {
    return (
      <div className={styles.emptyState}>
        Subtree is already in sync — no items differ between Tool and Jira.
        <br />
        ({analysis.actions.length} item{analysis.actions.length === 1 ? '' : 's'} compared.)
      </div>
    );
  }

  return (
    <>
      <div className={styles.previewHeader}>
        <div className={styles.previewMeta}>
          <strong>Golden source:</strong> {analysis.goldenSource} ·{' '}
          <strong>Jira project:</strong> {analysis.jiraProjectKey} ·{' '}
          <strong>{selectedIds.size}</strong> of {analysis.actions.length} selected
        </div>
        <div className={styles.toolbar}>
          <button className={styles.buttonLink} onClick={onSelectAll}>Select all</button>
          <button className={styles.buttonLink} onClick={onDeselectAll}>Deselect all</button>
        </div>
      </div>

      {analysis.warnings.length > 0 && (
        <div className={styles.warningsPanel}>
          <p className={styles.warningsPanelTitle}>
            {analysis.warnings.length} warning{analysis.warnings.length === 1 ? '' : 's'}
          </p>
          <ul className={styles.warningsPanelList}>
            {analysis.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {ACTION_ORDER.map((action) => {
        const items = groupedActions[action];
        if (items.length === 0) return null;
        if (action === 'NO_CHANGE' && !showNoChange) {
          return (
            <div key={action} className={styles.actionGroup}>
              <div className={styles.actionGroupHeader} onClick={onToggleNoChange}>
                <span className={`${styles.actionGroupTitle} ${ACTION_COLOUR_CLASS[action]}`}>
                  ▸ {ACTION_LABELS[action]}
                </span>
                <span className={styles.actionGroupCount}>{items.length}</span>
              </div>
            </div>
          );
        }
        return (
          <div key={action} className={styles.actionGroup}>
            <div
              className={styles.actionGroupHeader}
              onClick={action === 'NO_CHANGE' ? onToggleNoChange : undefined}
              style={{ cursor: action === 'NO_CHANGE' ? 'pointer' : 'default' }}
            >
              <span className={`${styles.actionGroupTitle} ${ACTION_COLOUR_CLASS[action]}`}>
                {action === 'NO_CHANGE' ? '▾ ' : ''}{ACTION_LABELS[action]}
              </span>
              <span className={styles.actionGroupCount}>{items.length}</span>
            </div>
            {items.map((a) => {
              const id = actionId(a);
              const isChecked = selectedIds.has(id);
              const isExpanded = expandedDiffs.has(id);
              return (
                <ActionRow
                  key={id}
                  action={a}
                  checked={isChecked}
                  diffsExpanded={isExpanded}
                  onToggle={() => onToggleSelect(id)}
                  onToggleDiff={() => onToggleDiff(id)}
                  showCheckbox={a.action !== 'NO_CHANGE'}
                />
              );
            })}
          </div>
        );
      })}
    </>
  );
}

function ActionRow({
  action,
  checked,
  diffsExpanded,
  onToggle,
  onToggleDiff,
  showCheckbox,
}: {
  action: SyncActionItem;
  checked: boolean;
  diffsExpanded: boolean;
  onToggle: () => void;
  onToggleDiff: () => void;
  showCheckbox: boolean;
}) {
  return (
    <>
      <div className={`${styles.actionRow} ${checked ? styles.actionRowChecked : ''}`}>
        {showCheckbox && (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            data-testid={`sync-action-checkbox-${action.action}-${action.externalKey ?? action.toolId}`}
          />
        )}
        {!showCheckbox && <span style={{ width: 13 }} />}
        <div className={styles.actionRowMain}>
          <div className={styles.actionRowTitle}>{action.title}</div>
          <div className={styles.actionRowMeta}>
            <span className={styles.typePill}>{action.type}</span>
            {action.externalKey && (
              <span className={styles.externalKeyPill}>{action.externalKey}</span>
            )}
            {action.parentExternalKey && (
              <span>parent: {action.parentExternalKey}</span>
            )}
            {action.differences.length > 0 && (
              <button className={styles.diffsLabel} onClick={onToggleDiff}>
                {diffsExpanded ? '▾' : '▸'} diffs: {action.differences.join(', ')}
              </button>
            )}
            {action.specsToUpload && action.specsToUpload.length > 0 && (
              <span>
                {action.specsToUpload.length} spec{action.specsToUpload.length === 1 ? '' : 's'}:{' '}
                {action.specsToUpload.map((s) => s.filename).join(', ')}
              </span>
            )}
          </div>
        </div>
      </div>
      {diffsExpanded && action.differences.length > 0 && (
        <DiffTable action={action} />
      )}
    </>
  );
}

function DiffTable({ action }: { action: SyncActionItem }) {
  const tool = action.toolSnapshot;
  const jira = action.jiraSnapshot;
  return (
    <div className={styles.diffsTable}>
      <table>
        <tbody>
          {action.differences.map((field) => {
            const t = tool ? (tool as any)[
              field === 'parent' ? 'parentExternalKey' : field
            ] : null;
            const j = jira ? (jira as any)[
              field === 'parent' ? 'parentExternalKey' : field
            ] : null;
            return (
              <tr key={field}>
                <th>{field}</th>
                <td className={styles.diffsValue}>{formatValue(t)}</td>
                <td className={styles.diffsArrow}>→</td>
                <td className={styles.diffsValue}>{formatValue(j)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '∅';
  if (typeof v === 'string') return v;
  return String(v);
}

// ===========================================================================
// Result phase
// ===========================================================================

function ResultPhase({
  executeResult,
  groupedResults,
}: {
  executeResult: SyncExecuteResult;
  groupedResults: Record<SyncAction, SyncExecuteResultItem[]>;
}) {
  const { summary } = executeResult;
  const bannerClass =
    summary.failed === 0 && summary.partialFailures === 0
      ? styles.resultSummaryBannerSuccess
      : summary.succeeded === 0
        ? styles.resultSummaryBannerFailure
        : styles.resultSummaryBannerMixed;

  return (
    <>
      <div className={`${styles.resultSummaryBanner} ${bannerClass}`}>
        <strong>Sync complete.</strong>{' '}
        {summary.succeeded} succeeded
        {summary.skipped > 0 && `, ${summary.skipped} skipped`}
        {summary.failed > 0 && `, ${summary.failed} failed`}
        {summary.partialFailures > 0 && `, ${summary.partialFailures} partial failure${summary.partialFailures === 1 ? '' : 's'}`}
        .
      </div>

      {ACTION_ORDER.map((action) => {
        const items = groupedResults[action];
        if (items.length === 0) return null;
        return (
          <div key={action} className={styles.actionGroup}>
            <div className={styles.actionGroupHeader}>
              <span className={`${styles.actionGroupTitle} ${ACTION_COLOUR_CLASS[action]}`}>
                {ACTION_LABELS[action]}
              </span>
              <span className={styles.actionGroupCount}>{items.length}</span>
            </div>
            {items.map((r) => (
              <ResultRow key={actionId(r)} result={r} />
            ))}
          </div>
        );
      })}
    </>
  );
}

function ResultRow({ result }: { result: SyncExecuteResultItem }) {
  const rowClass =
    result.status === 'SUCCESS' ? styles.resultRowSuccess
      : result.status === 'PARTIAL_FAILURE' ? styles.resultRowPartial
        : result.status === 'SKIPPED' ? styles.resultRowSkipped
          : styles.resultRowFailed;
  const icon =
    result.status === 'SUCCESS' ? '✓'
      : result.status === 'PARTIAL_FAILURE' ? '⚠'
        : result.status === 'SKIPPED' ? '◯'
          : '✗';
  return (
    <div className={`${styles.resultRow} ${rowClass}`}>
      <div className={styles.resultStatusIcon}>{icon}</div>
      <div className={styles.actionRowMain}>
        <div className={styles.actionRowTitle}>{result.title}</div>
        <div className={styles.actionRowMeta}>
          <span className={styles.typePill}>{result.type}</span>
          {(result.externalKey || result.newExternalKey) && (
            <span className={styles.externalKeyPill}>
              {result.newExternalKey ?? result.externalKey}
              {result.newExternalKey && ' (new)'}
            </span>
          )}
          {result.newToolId && <span>new tool ID: {result.newToolId.substring(0, 8)}…</span>}
        </div>
        {result.status === 'FAILED' && result.error && (
          <div className={styles.resultErrorMessage}>{result.error}</div>
        )}
        {result.status === 'PARTIAL_FAILURE' && result.error && (
          <div className={styles.resultPartialMessage}>{result.error}</div>
        )}
        {result.status === 'SKIPPED' && result.error && (
          <div className={styles.resultPartialMessage}>{result.error}</div>
        )}
      </div>
    </div>
  );
}
