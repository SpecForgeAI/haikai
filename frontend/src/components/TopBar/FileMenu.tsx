/**
 * FileMenu Component (Project Menu)
 *
 * Dropdown menu for project operations:
 * - Create Project (Spec 2026-01-05)
 * - Open (backend) and Save As (backend)
 * - Generate Standards (Spec 2026-01-31: Project-level Standards Generation)
 * - Save (Spec 2026-01-11) - Immediate save without prompt
 * - Delete (Spec 2026-01-10)
 * - Import as JSON and Export as JSON (local file system)
 * - Import as XLSX and Export as XLSX (local file system)
 * - Export Infrastructure as Terraform (Spec 2026-05-08: Infrastructure Terraform Export (GCP))
 * - Import Infrastructure from Terraform (Spec 2026-05-08: Infrastructure Terraform Import (GCP))
 *
 * Spec 2026-01-10: Project Menu + Delete Project
 * - Added Delete menu item after Save As
 * - Reordered menu items: Create, Open, Save As, Delete, (sep), Import/Export
 *
 * Spec 2026-01-11: Add Project Save Menu Item and Fix Menu Labels/Separator
 * - Added Save menu item between Open and Save As
 * - Removed trailing ellipses from all menu labels
 * - Consolidated to exactly one separator (between Delete and Import as JSON)
 * - Added saveDisabled prop and menuItemDisabled styling
 *
 * Spec 2026-01-11: Redesign Import as XLSX
 * - Added importXlsxDisabled prop for Import as XLSX menu item
 * - Import is disabled when no active project is loaded
 *
 * Spec 2026-01-11: Project Menu Disable When No Active Project
 * - Added saveAsDisabled prop for Save As menu item
 * - Added importJsonDisabled prop for Import as JSON menu item
 * - Added exportJsonDisabled prop for Export as JSON menu item
 * - Added exportXlsxDisabled prop for Export as XLSX menu item
 * - All items disabled when no active project (state.loadedFileName is falsy)
 *
 * Spec 2026-01-19: UI Route Gating for Startup Feature Toggles
 * Task Group 2: FileMenu Gating (includeDatabase)
 * - Added useIncludeDatabase hook import from AppConfigContext
 * - Conditionally render database-dependent menu items (Create, Open, Save, Save As, Delete)
 * - Conditionally render separator (only when DB items are visible)
 * - File-only items (Import/Export JSON/XLSX) always render regardless of toggle
 *
 * Spec 2026-01-19: Project Menu Import/Export Always Enabled
 * - Import JSON and Import XLSX handlers simplified (guards removed)
 * - importJsonDisabled and importXlsxDisabled are always false from TopBar
 * - Users can import files immediately on fresh app startup
 *
 * Spec 2026-01-31: Project-level Standards Generation
 * Task Group 4: FileMenu Generate Standards Menu Item
 * - Added onGenerateStandards and generateStandardsDisabled props
 * - Added "Generate Standards" menu item between "Open" and "Save"
 * - Menu item only rendered when includeDatabase=true
 *
 * Spec 2026-05-08: Infrastructure Terraform Export (GCP)
 * Task Group 7: FileMenu Export Infrastructure as Terraform menu item
 * - Added onExportInfrastructureTerraform and exportInfrastructureTerraformDisabled props
 * - Added "Export Infrastructure as Terraform" menu item in the Export group,
 *   parallel to Export as JSON / Export as XLSX entries.
 * - Disabled when no model is loaded OR when no Environments exist in the model.
 *
 * Spec 2026-05-08: Infrastructure Terraform Import (GCP)
 * Task Group 7: FileMenu Import Infrastructure from Terraform menu item
 * - Added onImportInfrastructureTerraform and importInfrastructureTerraformDisabled props
 * - Added "Import Infrastructure from Terraform" menu item parallel to the
 *   Export Infrastructure as Terraform entry.
 * - Disabled gate matches the export entry: model loaded AND at least one
 *   Environment exists in the Infrastructure domain.
 *
 * Uses portal rendering for proper z-index stacking.
 * Follows ElementContextMenu pattern for dropdown behavior.
 */

import { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
// Spec 2026-01-19: Import useIncludeDatabase hook for menu gating
import { useIncludeDatabase } from '../../contexts/AppConfigContext';
import styles from './FileMenu.module.css';

interface FileMenuProps {
  /** Whether the menu is visible */
  visible: boolean;
  /** X coordinate (screen position) of the menu */
  x: number;
  /** Y coordinate (screen position) of the menu */
  y: number;
  /** Handler for closing the menu */
  onClose: () => void;
  /** Handler for Create Project action (Spec 2026-01-05) */
  onCreateProject: () => void;
  /**
   * Handler for Edit Project action (2026-07-27): opens the Create-Product
   * modal in EDIT mode, prefilled with the active project's saved values —
   * Save persists the changes and (re)registers the implementation
   * workspace via POST /projects/init.
   */
  onEditProject?: () => void;
  /** Whether Edit Project is disabled (no active project). */
  editProjectDisabled?: boolean;
  /** Handler for Open action (load from backend) */
  onOpenBackend: () => void;
  /** Handler for Save action (Spec 2026-01-11) - immediate save to backend */
  onSave: () => void;
  /** Whether Save is disabled (no project open or save in progress) */
  saveDisabled: boolean;
  /** Handler for Save As action (save to backend with filename prompt) */
  onSaveAsBackend: () => void;
  /** Whether Save As is disabled (no project open) - Spec 2026-01-11: Project Menu Disable */
  saveAsDisabled?: boolean;
  /** Handler for Delete action (Spec 2026-01-10) */
  onDelete: () => void;
  /** Handler for Import as JSON action (import local JSON file) */
  onImportJson: () => void;
  /** Whether Import as JSON is disabled - Spec 2026-01-19: Always false (always enabled) */
  importJsonDisabled?: boolean;
  /** Handler for Export as JSON action (export to local JSON file) */
  onExportJson: () => void;
  /** Whether Export as JSON is disabled (no project open) - Spec 2026-01-11: Project Menu Disable */
  exportJsonDisabled?: boolean;
  /** Handler for Import as XLSX action (import local Excel file) */
  onImportXlsx: () => void;
  /** Whether Import as XLSX is disabled - Spec 2026-01-19: Always false (always enabled) */
  importXlsxDisabled?: boolean;
  /** Handler for Export as XLSX action (export to local Excel file) */
  onExportXlsx: () => void;
  /** Whether Export as XLSX is disabled (no project open) - Spec 2026-01-11: Project Menu Disable */
  exportXlsxDisabled?: boolean;
  /** Handler for Generate Standards action (Spec 2026-01-31: Project-level Standards Generation) */
  onGenerateStandards?: () => void;
  /** Whether Generate Standards is disabled (no active project) */
  generateStandardsDisabled?: boolean;
  /** Handler for Close Project action - deactivates project and returns to landing page */
  onCloseProject?: () => void;
  /** Whether Close Project is disabled (no active project) */
  closeProjectDisabled?: boolean;
  /**
   * Handler for "Export Infrastructure as Terraform" action.
   * Spec 2026-05-08: Infrastructure Terraform Export (GCP) -- Task Group 7.
   */
  onExportInfrastructureTerraform?: () => void;
  /**
   * Whether "Export Infrastructure as Terraform" is disabled.
   * Spec 2026-05-08: should be true when no model is loaded OR when the model
   * has no environments defined.
   */
  exportInfrastructureTerraformDisabled?: boolean;
  /**
   * Handler for "Import Infrastructure from Terraform" action.
   * Spec 2026-05-08: Infrastructure Terraform Import (GCP) -- Task Group 7.
   */
  onImportInfrastructureTerraform?: () => void;
  /**
   * Whether "Import Infrastructure from Terraform" is disabled.
   * Spec 2026-05-08: should be true when no model is loaded OR when the model
   * has no environments defined (matches the export entry's gate).
   */
  importInfrastructureTerraformDisabled?: boolean;
  /**
   * Handler for the "Info" item (2026-08-20): opens the build-info modal
   * (version / repo commit / build time). Always enabled — build identity
   * needs no active project.
   */
  onInfo?: () => void;
}

/**
 * Calculate clamped position to keep menu within viewport
 */
function getClampedPosition(x: number, y: number): { posX: number; posY: number } {
  const menuWidth = 240; // min-width from CSS (slightly wider for new long menu label)
  const menuHeight = 420; // estimated height for 12 items + 1 separator
  const padding = 5;

  let posX = x;
  let posY = y;

  // Clamp to right edge
  if (posX + menuWidth > window.innerWidth - padding) {
    posX = window.innerWidth - menuWidth - padding;
  }

  // Clamp to bottom edge
  if (posY + menuHeight > window.innerHeight - padding) {
    posY = window.innerHeight - menuHeight - padding;
  }

  // Clamp to left edge
  if (posX < padding) {
    posX = padding;
  }

  // Clamp to top edge
  if (posY < padding) {
    posY = padding;
  }

  return { posX, posY };
}

export function FileMenu({
  visible,
  x,
  y,
  onClose,
  onCreateProject,
  onEditProject,
  editProjectDisabled = false,
  onOpenBackend,
  onSave,
  saveDisabled,
  onSaveAsBackend,
  saveAsDisabled = false,
  onDelete,
  onImportJson,
  importJsonDisabled = false,
  onExportJson,
  exportJsonDisabled = false,
  onImportXlsx,
  importXlsxDisabled = false,
  onExportXlsx,
  exportXlsxDisabled = false,
  onGenerateStandards,
  generateStandardsDisabled = false,
  onCloseProject,
  closeProjectDisabled = false,
  // Spec 2026-05-08: Infrastructure Terraform Export (GCP)
  onExportInfrastructureTerraform,
  exportInfrastructureTerraformDisabled = false,
  // Spec 2026-05-08: Infrastructure Terraform Import (GCP)
  onImportInfrastructureTerraform,
  importInfrastructureTerraformDisabled = false,
  // 2026-08-20: build-info modal launcher.
  onInfo,
}: FileMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  // Spec 2026-01-19: Get includeDatabase toggle for menu gating
  const includeDatabase = useIncludeDatabase();

  // Auto-dismiss on outside click
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    // Add listener with slight delay to prevent immediate dismiss
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [visible, onClose]);

  // Auto-dismiss on Escape key
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [visible, onClose]);

  // Don't render if not visible
  if (!visible) {
    return null;
  }

  const { posX, posY } = getClampedPosition(x, y);

  // Handle menu item clicks
  // Spec 2026-01-05: Create Project handler
  const handleCreateProjectClick = () => {
    onCreateProject();
    onClose();
  };

  // 2026-07-27: Edit Project handler (disabled without an active project).
  const handleEditProjectClick = () => {
    if (!editProjectDisabled && onEditProject) {
      onEditProject();
      onClose();
    }
  };

  const handleOpenBackendClick = () => {
    onOpenBackend();
    onClose();
  };

  // Spec 2026-01-31: Generate Standards handler
  const handleGenerateStandardsClick = () => {
    if (!generateStandardsDisabled && onGenerateStandards) {
      onGenerateStandards();
      onClose();
    }
  };

  // Spec 2026-01-11: Save handler (immediate save without prompt)
  const handleSaveClick = () => {
    if (!saveDisabled) {
      onSave();
      onClose();
    }
  };

  // Spec 2026-01-11: Save As handler with disabled check
  const handleSaveAsBackendClick = () => {
    if (!saveAsDisabled) {
      onSaveAsBackend();
      onClose();
    }
  };

  // Spec 2026-01-10: Delete handler
  const handleDeleteClick = () => {
    onDelete();
    onClose();
  };

  const handleCloseProjectClick = () => {
    if (!closeProjectDisabled && onCloseProject) {
      onCloseProject();
      onClose();
    }
  };

  // Spec 2026-01-19: Import JSON handler - always enabled
  // Guard removed since importJsonDisabled is always false from TopBar
  const handleImportJsonClick = () => {
    onImportJson();
    onClose();
  };

  // Spec 2026-01-11: Export JSON handler with disabled check
  const handleExportJsonClick = () => {
    if (!exportJsonDisabled) {
      onExportJson();
      onClose();
    }
  };

  // Spec 2026-01-19: Import XLSX handler - always enabled
  // Guard removed since importXlsxDisabled is always false from TopBar
  const handleImportXlsxClick = () => {
    onImportXlsx();
    onClose();
  };

  // Spec 2026-01-11: Export XLSX handler with disabled check
  const handleExportXlsxClick = () => {
    if (!exportXlsxDisabled) {
      onExportXlsx();
      onClose();
    }
  };

  // Spec 2026-05-08: Export Infrastructure as Terraform handler with disabled check
  const handleExportInfrastructureTerraformClick = () => {
    if (!exportInfrastructureTerraformDisabled && onExportInfrastructureTerraform) {
      onExportInfrastructureTerraform();
      onClose();
    }
  };

  // Spec 2026-05-08: Import Infrastructure from Terraform handler with disabled check
  const handleImportInfrastructureTerraformClick = () => {
    if (!importInfrastructureTerraformDisabled && onImportInfrastructureTerraform) {
      onImportInfrastructureTerraform();
      onClose();
    }
  };

  // 2026-08-20: Info handler — always enabled.
  const handleInfoClick = () => {
    if (onInfo) {
      onInfo();
      onClose();
    }
  };

  // Stop propagation on menu clicks
  const handleMenuClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };

  // Spec 2026-01-11: Updated menu order and removed trailing ellipses
  // Spec 2026-01-31: New order: Create, Open, Generate Standards, Save, Save As, Delete, (sep), Import/Export
  // Only one separator between Delete and Import as JSON
  // Spec 2026-01-19: Database-dependent items conditionally rendered
  const menuContent = (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{
        left: posX,
        top: posY,
      }}
      onClick={handleMenuClick}
      onContextMenu={handleMenuClick}
      data-testid="project-menu"
    >
      {/* Spec 2026-01-19: Database-dependent items conditionally rendered */}
      {includeDatabase && (
        <>
          {/* Create Project as FIRST item */}
          <div
            className={styles.menuItem}
            onClick={handleCreateProjectClick}
            data-testid="project-menu-create"
          >
            Create
          </div>

          {/* 2026-07-27: Edit the ACTIVE project — the Create modal in edit
              mode, prefilled; Save persists + runs workspace init. */}
          <div
            className={`${styles.menuItem} ${editProjectDisabled ? styles.menuItemDisabled : ''}`}
            onClick={handleEditProjectClick}
            data-testid="project-menu-edit"
          >
            Edit
          </div>

          {/* Open from backend */}
          <div
            className={styles.menuItem}
            onClick={handleOpenBackendClick}
            data-testid="project-menu-open"
          >
            Open
          </div>

          {/* Spec 2026-01-31: Generate Standards - between Open and Save */}
          <div
            className={`${styles.menuItem} ${generateStandardsDisabled ? styles.menuItemDisabled : ''}`}
            onClick={handleGenerateStandardsClick}
            data-testid="project-menu-generate-standards"
          >
            Generate Standards
          </div>

          {/* Spec 2026-01-11: Save to backend (immediate, no prompt) */}
          <div
            className={`${styles.menuItem} ${saveDisabled ? styles.menuItemDisabled : ''}`}
            onClick={handleSaveClick}
            data-testid="project-menu-save"
          >
            Save
          </div>

          {/* Save As to backend - Spec 2026-01-11: Added disabled state */}
          <div
            className={`${styles.menuItem} ${saveAsDisabled ? styles.menuItemDisabled : ''}`}
            onClick={handleSaveAsBackendClick}
            data-testid="project-menu-save-as"
          >
            Save As
          </div>

          {/* Spec 2026-01-10: Delete Project */}
          <div
            className={styles.menuItem}
            onClick={handleDeleteClick}
            data-testid="project-menu-delete"
          >
            Delete
          </div>

          {/* Close Project - deactivates and returns to landing page */}
          <div
            className={`${styles.menuItem} ${closeProjectDisabled ? styles.menuItemDisabled : ''}`}
            onClick={handleCloseProjectClick}
            data-testid="project-menu-close"
          >
            Close
          </div>

          {/* Spec 2026-01-11: Single separator between Close and Import as JSON */}
          {/* Spec 2026-01-19: Separator only rendered when DB items are visible */}
          <div className={styles.separator} />
        </>
      )}

      {/* JSON import/export - Spec 2026-01-11: Added disabled states */}
      {/* Spec 2026-01-19: File-only items always render regardless of includeDatabase */}
      {/* Spec 2026-01-19: Import JSON is always enabled (importJsonDisabled always false) */}
      <div
        className={`${styles.menuItem} ${importJsonDisabled ? styles.menuItemDisabled : ''}`}
        onClick={handleImportJsonClick}
        data-testid="project-menu-import-json"
      >
        Import as JSON
      </div>
      <div
        className={`${styles.menuItem} ${exportJsonDisabled ? styles.menuItemDisabled : ''}`}
        onClick={handleExportJsonClick}
        data-testid="project-menu-export-json"
      >
        Export as JSON
      </div>

      {/* XLSX import/export - no separator before these */}
      {/* Spec 2026-01-19: Import XLSX is always enabled (importXlsxDisabled always false) */}
      <div
        className={`${styles.menuItem} ${importXlsxDisabled ? styles.menuItemDisabled : ''}`}
        onClick={handleImportXlsxClick}
        data-testid="project-menu-import-xlsx"
      >
        Import as XLSX
      </div>
      {/* Spec 2026-01-11: Export XLSX with disabled state */}
      <div
        className={`${styles.menuItem} ${exportXlsxDisabled ? styles.menuItemDisabled : ''}`}
        onClick={handleExportXlsxClick}
        data-testid="project-menu-export-xlsx"
      >
        Export as XLSX
      </div>

      {/* Spec 2026-05-08: Import Infrastructure from Terraform - parallel to Export entry */}
      <div
        className={`${styles.menuItem} ${importInfrastructureTerraformDisabled ? styles.menuItemDisabled : ''}`}
        onClick={handleImportInfrastructureTerraformClick}
        data-testid="project-menu-import-infrastructure-terraform"
      >
        Import Infrastructure from Terraform
      </div>

      {/* Spec 2026-05-08: Export Infrastructure as Terraform - parallel to JSON / XLSX exports */}
      <div
        className={`${styles.menuItem} ${exportInfrastructureTerraformDisabled ? styles.menuItemDisabled : ''}`}
        onClick={handleExportInfrastructureTerraformClick}
        data-testid="project-menu-export-infrastructure-terraform"
      >
        Export Infrastructure as Terraform
      </div>

      {/* 2026-08-20: build-info modal — last item, own separator, always
          enabled (build identity needs no active project). */}
      {onInfo && (
        <>
          <div className={styles.separator} />
          <div
            className={styles.menuItem}
            onClick={handleInfoClick}
            data-testid="project-menu-info"
          >
            Info
          </div>
        </>
      )}
    </div>
  );

  // Render using portal to body for proper z-index stacking
  return ReactDOM.createPortal(menuContent, document.body);
}
