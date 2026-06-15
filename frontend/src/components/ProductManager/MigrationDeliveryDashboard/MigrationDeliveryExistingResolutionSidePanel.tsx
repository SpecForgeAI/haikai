/**
 * MigrationDeliveryExistingResolutionSidePanel
 *
 * Spec: 2026-05-20 Bulk-Resolve OAS/WSDL Parser -- Task Group 6.5
 *
 * Read-only side panel surfaced when the user clicks the "view existing
 * resolution" link on an `already_resolved` operation row inside the
 * Bulk-Resolve modal. Slides in from the right; NOT a modal.
 *
 * Display fields per spec line 66:
 *   - resolution id
 *   - missing-input-key
 *   - type (`api_contract` for the parse-files surface)
 *   - service+operation descriptor
 *   - resolved_at
 *   - resolved_by
 *   - resolution_source (e.g. `manual` or `oas_wsdl_upload`)
 *   - project_artifact_id back-reference (with filename if available)
 *
 * No reset / edit actions inside the panel -- users navigate to the existing
 * dashboard list to manage active resolutions.
 *
 * Closes via X button or click-outside.
 */

import React, { useCallback, useEffect, useRef } from 'react';

export interface ExistingResolutionViewData {
  /** Resolution row id. */
  id: string;
  /** Full 64-char hex missing-input key (truncated for display). */
  missingInputKey: string;
  /** Resolution type, typically `api_contract` on the parse-files surface. */
  missingInputType: string;
  /** Best-effort human-readable descriptor (e.g. "PaymentsService::createPayment"). */
  descriptor: string | null;
  /** ISO-8601 timestamp from `resolved_at`. */
  resolvedAt: string | null;
  /** User identifier from `resolved_by`. */
  resolvedBy: string | null;
  /** Open-vocabulary provenance: `manual` / `oas_wsdl_upload` / etc. */
  resolutionSource: string | null;
  /** Optional FK to a ProjectArtifact row that captured the upload. */
  projectArtifactId: string | null;
  /** Optional original filename for the project_artifact_id, if known. */
  projectArtifactFilename: string | null;
}

export interface MigrationDeliveryExistingResolutionSidePanelProps {
  /** Render the panel only when `resolution` is non-null. */
  resolution: ExistingResolutionViewData | null;
  onClose: () => void;
}

/**
 * Slide-in side panel showing the read-only details of an existing missing-input
 * resolution row. The component renders nothing when `resolution` is null so
 * callers can mount it permanently and toggle via state.
 */
export const MigrationDeliveryExistingResolutionSidePanel: React.FC<
  MigrationDeliveryExistingResolutionSidePanelProps
> = ({ resolution, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Click-outside handler: when the panel is open, a click outside the panel
  // container closes it. The handler is registered only while open to avoid
  // an idle listener on every mount.
  useEffect(() => {
    if (!resolution) return;
    const handler = (e: MouseEvent) => {
      const root = containerRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        onClose();
      }
    };
    // Use a microtask delay so the same click that opens the panel doesn't
    // immediately close it via this handler.
    const t = window.setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', handler);
    };
  }, [resolution, onClose]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!resolution) return null;

  const truncatedKey =
    resolution.missingInputKey.length > 8
      ? `${resolution.missingInputKey.slice(0, 8)}\u2026`
      : resolution.missingInputKey;

  return (
    <div
      ref={containerRef}
      role="complementary"
      aria-label="Existing resolution details"
      data-testid="mdd-existing-resolution-side-panel"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 380,
        maxWidth: '95vw',
        background: '#fff',
        boxShadow: '-4px 0 16px rgba(0,0,0,0.18)',
        padding: 20,
        overflowY: 'auto',
        zIndex: 1100,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <h4 style={{ margin: 0, fontSize: 14 }}>Existing resolution</h4>
        <button
          type="button"
          onClick={handleClose}
          data-testid="mdd-existing-resolution-side-panel-close"
          style={{
            background: 'transparent',
            border: 'none',
            fontSize: 18,
            cursor: 'pointer',
          }}
          aria-label="Close existing resolution panel"
        >
          {'\u2715'}
        </button>
      </div>

      <dl
        style={{
          margin: 0,
          display: 'grid',
          gridTemplateColumns: '120px 1fr',
          rowGap: 6,
          columnGap: 8,
          fontSize: 12,
        }}
      >
        <dt style={{ color: '#607d8b' }}>Resolution id</dt>
        <dd
          style={{ margin: 0, fontFamily: 'monospace', wordBreak: 'break-all' }}
          data-testid="mdd-existing-resolution-side-panel-id"
        >
          {resolution.id}
        </dd>

        <dt style={{ color: '#607d8b' }}>Missing-input key</dt>
        <dd
          style={{ margin: 0, fontFamily: 'monospace' }}
          data-testid="mdd-existing-resolution-side-panel-key"
          title={resolution.missingInputKey}
        >
          {truncatedKey}
        </dd>

        <dt style={{ color: '#607d8b' }}>Type</dt>
        <dd
          style={{ margin: 0 }}
          data-testid="mdd-existing-resolution-side-panel-type"
        >
          {resolution.missingInputType}
        </dd>

        <dt style={{ color: '#607d8b' }}>Descriptor</dt>
        <dd
          style={{ margin: 0 }}
          data-testid="mdd-existing-resolution-side-panel-descriptor"
        >
          {resolution.descriptor ?? '\u2014'}
        </dd>

        <dt style={{ color: '#607d8b' }}>Resolved at</dt>
        <dd
          style={{ margin: 0 }}
          data-testid="mdd-existing-resolution-side-panel-resolved-at"
        >
          {resolution.resolvedAt ?? '\u2014'}
        </dd>

        <dt style={{ color: '#607d8b' }}>Resolved by</dt>
        <dd
          style={{ margin: 0 }}
          data-testid="mdd-existing-resolution-side-panel-resolved-by"
        >
          {resolution.resolvedBy ?? '\u2014'}
        </dd>

        <dt style={{ color: '#607d8b' }}>Source</dt>
        <dd
          style={{ margin: 0 }}
          data-testid="mdd-existing-resolution-side-panel-source"
        >
          {resolution.resolutionSource ?? '\u2014'}
        </dd>

        <dt style={{ color: '#607d8b' }}>Artefact</dt>
        <dd
          style={{ margin: 0 }}
          data-testid="mdd-existing-resolution-side-panel-artefact"
        >
          {resolution.projectArtifactId
            ? resolution.projectArtifactFilename
              ? `${resolution.projectArtifactFilename} (${resolution.projectArtifactId})`
              : resolution.projectArtifactId
            : '\u2014'}
        </dd>
      </dl>

      <div style={{ fontSize: 11, color: '#90a4ae', marginTop: 6 }}>
        Manage active resolutions from the dashboard&apos;s resolutions list.
      </div>
    </div>
  );
};

export default MigrationDeliveryExistingResolutionSidePanel;
