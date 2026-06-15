/**
 * ProductPage Component
 *
 * Spec 2026-02-12: Increment 1 -- Add Product Tab + Minimal ProductDefinition
 * Task Group 3.5: ProductPage component
 *
 * Spec 2026-02-12: Increment 3 -- Introduce Product Manager Chat Mode
 * Task Group 6.9: Replace placeholder with ProductManagerChatPanel
 *
 * Spec 2026-02-13: SA Increment 1 -- Add Solution Architect Mode
 * Task Group 5.7: Add sub-tab layout for PM/SA toggle
 *
 * Spec 2026-03-01: Increment 9 -- Side Panel v2: Product and Roadmap Screens
 * Task Group 3: Replace legacy PM/SA chat panels with read-only product
 * definition content area + UnifiedChatPanel overlay.
 * - Removed useState for activeTab ('pm' | 'sa') state
 * - Removed imports of ProductManagerChatPanel and SolutionArchitectChatPanel
 * - Added UnifiedChatPanel as fixed-position RHS overlay
 * - Added read-only product definition cards using getDashboardSummary data
 * - PanelThreadKey: { type: 'panel', projectId, screen: 'product' }
 * - allowedPersonaIds: ['product-manager'], initialPersonaId: 'product-manager'
 * - No onArtifactSaved or artifactExists (advisory tasks only)
 *
 * Spec 2026-03-03: Unify Hub and RHS Panel Capabilities -- Task Group 4.3
 * - Added onArtifactSaved={fetchData} to trigger data re-fetch after artifact save
 * - Added artifactExists record derived from dashboard summary data
 */

import { useState, useEffect, useCallback } from 'react';
import { useProject } from '../../contexts/ProjectContext';
import { UnifiedChatPanel } from '../UnifiedChat';
import { getDashboardSummary } from '../../api/dashboardApi';
import type { ThreadKey } from '../../api/chatV2Api';
import type { DashboardSummaryDto } from '../../types/dashboard';
import styles from './ProductPage.module.css';

export function ProductPage() {
  const activeProject = useProject();

  // Spec 2026-03-01: Construct PanelThreadKey for UnifiedChatPanel
  const panelThreadKey: ThreadKey | null = activeProject
    ? { type: 'panel', projectId: activeProject.id, screen: 'product' }
    : null;

  // Dashboard summary data for read-only product definition cards
  const [data, setData] = useState<DashboardSummaryDto | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch product definition data using getDashboardSummary.
   * Follows the DashboardView pattern (lines 141-154).
   */
  const fetchData = useCallback(async () => {
    if (!activeProject) return;
    setLoading(true);
    setError(null);
    try {
      const result = await getDashboardSummary(activeProject.id);
      setData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load product definition data';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [activeProject]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <>
      <div className={styles.pageContainer} data-testid="product-page">
        {/* Read-only Product Definition content area */}
        <div className={styles.definitionHeader} data-testid="product-definition-content">
          <h2 className={styles.definitionTitle}>Product Definition</h2>
        </div>

        {/* Loading state */}
        {loading && (
          <div className={styles.loadingState} data-testid="product-definition-loading">
            Loading product definition...
          </div>
        )}

        {/* Error state with retry */}
        {error && !loading && (
          <div className={styles.errorState} data-testid="product-definition-error">
            <span>{error}</span>
            <button
              className={styles.retryButton}
              onClick={fetchData}
              data-testid="product-definition-retry"
            >
              Retry
            </button>
          </div>
        )}

        {/* Product definition cards */}
        {data && !loading && !error && (
          <div className={styles.definitionGrid} data-testid="product-definition-grid">
            {/* Product Name card */}
            <div className={styles.definitionCard} data-testid="card-product-name">
              <div className={styles.cardLabel}>Product Name</div>
              <div className={styles.cardValue}>{activeProject?.name ?? 'Unknown'}</div>
            </div>

            {/* Mission Status card */}
            <div className={styles.definitionCard} data-testid="card-mission-status">
              <div className={styles.cardLabel}>Mission Exists</div>
              <div className={styles.cardValue}>
                {data.strategicFoundation.productDefinition.missionExists.value ? 'Yes' : 'No'}
              </div>
            </div>

            {/* Mission Exists card */}
            <div className={styles.definitionCard} data-testid="card-definition-state">
              <div className={styles.cardLabel}>Product Definition</div>
              <div className={styles.cardValue}>
                {data.strategicFoundation.productDefinition.missionExists.label}: {String(data.strategicFoundation.productDefinition.missionExists.value)}
              </div>
            </div>

            {/* Roadmap card */}
            <div className={styles.definitionCard} data-testid="card-roadmap-state">
              <div className={styles.cardLabel}>Roadmap</div>
              <div className={styles.cardValue}>
                {data.strategicFoundation.roadmap.initiativesCount.label}: {data.strategicFoundation.roadmap.initiativesCount.value}
              </div>
            </div>

            {/* Initiatives Count card */}
            <div className={styles.definitionCard} data-testid="card-initiatives-count">
              <div className={styles.cardLabel}>Initiatives</div>
              <div className={styles.cardValue}>{data.strategicFoundation.roadmap.initiativesCount.value}</div>
            </div>

            {/* Epics Count card */}
            <div className={styles.definitionCard} data-testid="card-epics-count">
              <div className={styles.cardLabel}>Epics</div>
              <div className={styles.cardValue}>{data.strategicFoundation.roadmap.epics.value}</div>
            </div>
          </div>
        )}
      </div>

      {/* ================================================================
       * Spec 2026-03-01: Side Panel v2 on Product Screen (Increment 9)
       * Task Group 3: Render UnifiedChatPanel as fixed-position overlay
       * Panel is fixed-position right-anchored (same as MetaModelView).
       * Advisory tasks only -- no onArtifactSaved or artifactExists props.
       *
       * Spec 2026-03-03: Unify Hub and RHS Panel Capabilities -- Task Group 4.3
       * Added onArtifactSaved={fetchData} to re-fetch dashboard summary after
       * artifact save, and artifactExists record derived from dashboard data
       * following the DashboardView pattern.
       * ================================================================ */}
      {panelThreadKey && (
        <UnifiedChatPanel
          threadKey={panelThreadKey}
          initialPersonaId="product-manager"
          allowedPersonaIds={['product-manager']}
          onArtifactSaved={fetchData}
          artifactExists={{
            mission: data?.strategicFoundation?.productDefinition?.missionExists?.value === true,
            roadmap: Number(data?.strategicFoundation?.roadmap?.initiativesCount?.value ?? 0) > 0,
          }}
        />
      )}
    </>
  );
}
