/**
 * ArchitectureDesignTargetStatePage
 *
 * Spec 2026-05-24 Target State Sub-tab + Deterministic Suggest -- Task Groups 3.1 + 3.2
 *
 * Layout for the Target State sub-tab of the Architecture & Design page.
 * Mounted under the route
 *   /projects/:projectId/architectures/:architectureId/architecture-design/target-state
 *
 * Renders the shared <ArchitectureDesignSubTabs /> strip at the top (with
 * "Target State" marked active) and the existing <TargetArchitectureWorkspace />
 * below it. The workspace internals are unchanged at this point -- Group 4
 * rewires the Suggest call, empty-state card, and badge UI.
 */

import { ArchitectureDesignSubTabs } from './ArchitectureDesignSubTabs';
import { TargetArchitectureWorkspace } from './TargetArchitectureWorkspace';

export function ArchitectureDesignTargetStatePage() {
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)', minHeight: 0 }}
      data-testid="architecture-design-target-state-page"
    >
      <ArchitectureDesignSubTabs active="target-state" />
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <TargetArchitectureWorkspace />
      </div>
    </div>
  );
}
