/**
 * MigrationDeliveryPlanRoute
 *
 * Spec: 2026-05-17 PM Migration Delivery Plan + Draft Book-of-Work Generation
 *   agent-os/specs/2026-05-17-pm-migration-delivery-plan-book-of-work-draft/spec.md
 * Follow-up wiring (2026-06-03): mount the already-built (but never-routed)
 * generation wizard + draft list behind a production landing route so a PM
 * can actually launch the discovery→backlog auto-build.
 * Spec 2026-06-11 Source-Grade DB Schema + Data Migration Pack (Task 6.3):
 * mount the "Schema Migration" pack surface as a sibling section next to the
 * book of work, behind a section-tab toggle.
 *
 * Architecture-scoped router entry for the Migration Delivery Plan landing
 * surface. Mounted under the architecture-scoped tree in `App.tsx`,
 * mirroring `SpecGenerationWorkspaceRoute` / `MigrationDeliveryDashboardRoute`:
 *
 *   /projects/:projectId
 *     /architectures/:architectureId
 *       /migration-delivery-plan
 *
 * Route params (from `useParams()`):
 *   - projectId        — project UUID
 *   - architectureId   — active architecture UUID. Used as the wizard's
 *                        `initialCurrentArchitectureId` pre-selection, the
 *                        DB-migration-pack scope, and to build
 *                        architecture-scoped navigation targets.
 *
 * The route lives under `architectures/:architectureId` because
 * `ProjectLayout` silently redirects any project-scoped URL that lacks an
 * architecture segment.
 *
 * Direct build 2026-06-11: third section tab "Interface contracts" mounts
 * `OasExportView` — deterministic OpenAPI 3.0 contract export per interface.
 *
 * Composition (three section tabs; "Delivery plan" is the default so the
 * original landing behaviour is unchanged):
 *   - "Delivery plan":
 *     - `MigrationDeliveryPlanWizard` (open) — the 7-stage generation flow. It
 *       self-fetches the Migration Discovery Context once the user picks
 *       current/target architectures, so this wrapper only supplies the
 *       `projectId` + the project's architecture list (fetched via
 *       `listArchitectures`). On `onGenerationComplete` we navigate to the
 *       review route for the new draft id.
 *     - `MigrationBookOfWorkDraftListView` — surfaces existing drafts (active
 *       by default; "Show archived" toggle re-fetches). A row click routes to
 *       the review route.
 *   - "Schema migration":
 *     - `DbMigrationPackView` — the deterministic DB schema + data migration
 *       pack surface (pack contents, decision queue, drift reports, actions).
 *
 * Navigation:
 *   - wizard `onClose`             → back to `product/backlog`
 *   - wizard `onGenerationComplete`→ `.../migration-books-of-work/:bookId/review`
 *   - draft-list row click          → `.../migration-books-of-work/:bookId/review`
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  listArchitectures,
  type Architecture,
} from '../../../api/architecturesApi';
import {
  MigrationDeliveryPlanWizard,
  type ArchitectureOption,
} from './MigrationDeliveryPlanWizard';
import { MigrationBookOfWorkDraftListView } from './MigrationBookOfWorkDraftListView';
import { DbMigrationPackView } from './DbMigrationPackView';
import { OasExportView } from './OasExportView';
import packStyles from './DbMigrationPack.module.css';

type MigrationDeliveryPlanSection =
  | 'plan'
  | 'schema-migration'
  | 'interface-contracts';

export function MigrationDeliveryPlanRoute() {
  const { projectId, architectureId } = useParams<{
    projectId: string;
    architectureId: string;
  }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [architectures, setArchitectures] = useState<ArchitectureOption[]>([]);
  const [architecturesError, setArchitecturesError] = useState<string | null>(
    null,
  );

  // The section is URL-driven (`?section=`) so the Schema migration + Interface
  // contracts surfaces are directly addressable and bookmarkable — gap
  // wayfinding links can deep-link straight to `?section=schema-migration`.
  // Absent / unknown => 'plan' (the original default landing).
  const sectionParam = searchParams.get('section');
  const activeSection: MigrationDeliveryPlanSection =
    sectionParam === 'schema-migration' || sectionParam === 'interface-contracts'
      ? sectionParam
      : 'plan';
  const setActiveSection = useCallback(
    (section: MigrationDeliveryPlanSection) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (section === 'plan') next.delete('section');
          else next.set('section', section);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // The generation wizard opens on demand. It still auto-opens on a fresh
  // landing (the only ways onto this route are the "Create Migration Delivery
  // Plan" launchers, so create-intent is implied), but CLOSING it now stays on
  // this page — revealing the section tabs + draft list — instead of ejecting
  // to the backlog. That eject-on-close was the dead-end that made the Schema
  // migration tab unreachable: the modal covered the tabs and Cancel navigated
  // away.
  const [wizardOpen, setWizardOpen] = useState(true);

  // Fetch the project's architectures for the wizard's Stage-1 pickers. The
  // wizard only needs `{ id, name }`; archived architectures are still valid
  // migration sources/targets, so we keep them and only map down the shape.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setArchitecturesError(null);
    void listArchitectures(projectId)
      .then((rows: Architecture[]) => {
        if (cancelled) return;
        setArchitectures(rows.map((a) => ({ id: a.id, name: a.name })));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setArchitecturesError(
          err instanceof Error ? err.message : 'Failed to load architectures.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const archScopedPrefix = projectId
    ? `/projects/${projectId}/architectures/${architectureId}`
    : '';

  const goToReview = useCallback(
    (bookId: string) => {
      navigate(
        `${archScopedPrefix}/migration-books-of-work/${bookId}/review`,
      );
    },
    [navigate, archScopedPrefix],
  );

  if (!projectId || !architectureId) {
    return null;
  }

  return (
    <div data-testid="migration-delivery-plan-route">
      {/* Section tabs: the delivery plan (wizard + drafts) vs the DB schema
          migration pack surface. "Delivery plan" stays the default. */}
      <div className={packStyles.sectionTabs}>
        <button
          type="button"
          className={`${packStyles.sectionTab} ${
            activeSection === 'plan' ? packStyles.sectionTabActive : ''
          }`}
          onClick={() => setActiveSection('plan')}
          data-testid="migration-delivery-plan-tab-plan"
        >
          Delivery plan
        </button>
        <button
          type="button"
          className={`${packStyles.sectionTab} ${
            activeSection === 'schema-migration' ? packStyles.sectionTabActive : ''
          }`}
          onClick={() => setActiveSection('schema-migration')}
          data-testid="migration-delivery-plan-tab-schema-migration"
        >
          Schema migration
        </button>
        <button
          type="button"
          className={`${packStyles.sectionTab} ${
            activeSection === 'interface-contracts' ? packStyles.sectionTabActive : ''
          }`}
          onClick={() => setActiveSection('interface-contracts')}
          data-testid="migration-delivery-plan-tab-interface-contracts"
        >
          Interface contracts
        </button>
      </div>

      {activeSection === 'plan' && (
        <>
          {wizardOpen ? (
            <MigrationDeliveryPlanWizard
              open
              projectId={projectId}
              architectures={architectures}
              initialCurrentArchitectureId={architectureId}
              onClose={() => setWizardOpen(false)}
              onGenerationComplete={(result) => goToReview(result.draftId)}
            />
          ) : (
            <div className={packStyles.createPlanBar}>
              <button
                type="button"
                className={packStyles.createPlanButton}
                onClick={() => setWizardOpen(true)}
                data-testid="migration-delivery-plan-create-button"
              >
                Create Migration Delivery Plan
              </button>
            </div>
          )}

          {architecturesError && (
            <div
              data-testid="migration-delivery-plan-architectures-error"
              role="alert"
            >
              {architecturesError}
            </div>
          )}

          {/* Existing drafts for this project. Clicking a row routes to the
              review workspace for that draft id. */}
          <MigrationBookOfWorkDraftListView
            projectId={projectId}
            onOpenDraft={(bookId) => goToReview(bookId)}
          />
        </>
      )}

      {activeSection === 'schema-migration' && (
        <DbMigrationPackView
          projectId={projectId}
          architectureId={architectureId}
        />
      )}

      {activeSection === 'interface-contracts' && (
        <OasExportView
          projectId={projectId}
          architectureId={architectureId}
          architectures={architectures}
        />
      )}
    </div>
  );
}

export default MigrationDeliveryPlanRoute;
