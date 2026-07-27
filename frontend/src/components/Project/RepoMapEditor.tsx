/**
 * RepoMapEditor Component
 *
 * Spec 2026-06-12: Implementation-Service Init and Integration Repair --
 * Task Group 4.
 *
 * The POST-INIT "Repositories" home inside the Edit-project modal. Once
 * workspace registration (POST /projects/init) has succeeded, the Single/Poly
 * radio disappears and all repo-map changes go through the external service's
 * polyrepo CRUD, proxied by the gateway:
 *
 *   - On mount: loads the LIVE map via the gateway GET route. The gateway
 *     auto-syncs the AMS-stored map (external-wins) and reports `changed`;
 *     when true this component shows the visible
 *     "Repo map updated from workspace" notice. There is deliberately NO
 *     push-upstream "repair" action -- the external service is the source of
 *     truth for what is cloned.
 *   - Add row -> POST (clones immediately); re-point URL -> PUT /{folder}
 *     (re-clones); delete -> DELETE /{folder}. Every mutation returns the
 *     fresh RepoMapResponse, which this component re-renders from verbatim.
 *   - Client-side folder slug rule + dual-column uniqueness (mirroring the
 *     gateway and the Poly-table rules in repoMapValidation.ts) apply to add
 *     and re-point before any call is made.
 *
 * Styling reuses CreateProjectModal.module.css (the host modal's stylesheet).
 */

import { useState, useEffect, useCallback } from 'react';
import {
  getImplementationRepoMap,
  addImplementationRepo,
  updateImplementationRepo,
  deleteImplementationRepo,
  RepoMapGatewayResponse,
} from '../../api/implementationProjectsApi';
import {
  FOLDER_NAME_PATTERN,
  FOLDER_NAME_RULE_MESSAGE,
} from './repoMapValidation';
import styles from './CreateProjectModal.module.css';

export interface RepoMapEditorProps {
  /** Normalised organisation name (the upstream company identifier). */
  company: string;
  /** Normalised product name (the upstream project identifier). */
  project: string;
  /** Haikai project UUID (the gateway's AMS persistence target). */
  projectId: string;
  /**
   * Fired when the INITIAL live-map load fails (2026-07-27). The stored
   * init-success flag can DRIFT from reality — the workspace directory may be
   * gone (wiped host dir, different machine) while AMS still says
   * initialised. The Edit-project modal uses this to fall back to the
   * pre-init form so the user can RE-INITIALISE, instead of dead-ending on a
   * read error with no Save button.
   */
  onLoadFailed?: (message: string) => void;
}

/**
 * Validates an add/re-point against the current map. Returns an error
 * message or null. `excludeFolder` skips the folder being re-pointed when
 * checking URL uniqueness.
 */
export function validateRepoChange(
  repos: Record<string, string>,
  folder: string,
  url: string,
  options: { isNewFolder: boolean }
): string | null {
  if (options.isNewFolder) {
    if (!folder) return 'Folder name is required';
    if (!FOLDER_NAME_PATTERN.test(folder)) return FOLDER_NAME_RULE_MESSAGE;
    if (Object.prototype.hasOwnProperty.call(repos, folder)) {
      return `Folder "${folder}" already exists in the repo map`;
    }
  }
  if (!url) return 'Repo URL is required';
  const duplicate = Object.entries(repos).some(
    ([existingFolder, existingUrl]) => existingFolder !== folder && existingUrl === url
  );
  if (duplicate) return 'Duplicate repo URL: it is already mapped to another folder';
  return null;
}

/**
 * Renders the live workspace repo map as an editable table with
 * add / re-point / delete operations applied through the gateway CRUD
 * routes, plus the external-wins drift notice.
 */
export function RepoMapEditor({ company, project, projectId, onLoadFailed }: RepoMapEditorProps) {
  const [repos, setRepos] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** "Repo map updated from workspace" notice (GET drift, external-wins). */
  const [driftNotice, setDriftNotice] = useState(false);
  /** Inline error for the last attempted mutation. */
  const [actionError, setActionError] = useState<string | null>(null);
  /** Folder currently being mutated ('' = the add row), null = idle. */
  const [busyFolder, setBusyFolder] = useState<string | null>(null);
  /** Editable URL values, keyed by folder (seeded from the live map). */
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});
  /** The add-row form. */
  const [newFolder, setNewFolder] = useState('');
  const [newUrl, setNewUrl] = useState('');

  const applyResponse = useCallback((response: RepoMapGatewayResponse) => {
    setRepos(response.repos);
    setUrlDrafts({ ...response.repos });
  }, []);

  // Load the live map on mount (and when the project identity changes).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setDriftNotice(false);
    getImplementationRepoMap(company, project, projectId)
      .then((response) => {
        if (cancelled) return;
        applyResponse(response);
        setDriftNotice(response.changed === true);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load repo map';
        setLoadError(message);
        setLoading(false);
        // Surface the drift to the host modal (2026-07-27) so it can fall
        // back to the re-initialise form instead of dead-ending here.
        onLoadFailed?.(message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company, project, projectId, applyResponse]);

  const runMutation = async (
    folderKey: string,
    mutation: () => Promise<RepoMapGatewayResponse>
  ) => {
    setBusyFolder(folderKey);
    setActionError(null);
    try {
      const response = await mutation();
      applyResponse(response);
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Repo operation failed');
      return false;
    } finally {
      setBusyFolder(null);
    }
  };

  const handleAdd = async () => {
    if (!repos) return;
    const folder = newFolder.trim();
    const url = newUrl.trim();
    const validationError = validateRepoChange(repos, folder, url, { isNewFolder: true });
    if (validationError) {
      setActionError(validationError);
      return;
    }
    const ok = await runMutation('', () =>
      addImplementationRepo(company, project, projectId, folder, url)
    );
    if (ok) {
      setNewFolder('');
      setNewUrl('');
    }
  };

  const handleRepoint = async (folder: string) => {
    if (!repos) return;
    const url = (urlDrafts[folder] ?? '').trim();
    const validationError = validateRepoChange(repos, folder, url, { isNewFolder: false });
    if (validationError) {
      setActionError(validationError);
      return;
    }
    await runMutation(folder, () =>
      updateImplementationRepo(company, project, projectId, folder, url)
    );
  };

  const handleDelete = async (folder: string) => {
    await runMutation(folder, () =>
      deleteImplementationRepo(company, project, projectId, folder)
    );
  };

  if (loading) {
    return (
      <span className={styles.repoEditorStatus} data-testid="repo-map-loading">
        Loading repositories from workspace...
      </span>
    );
  }

  if (loadError || repos === null) {
    return (
      <div className={styles.errorMessage} data-testid="repo-map-load-error">
        {loadError ?? 'Failed to load repo map'}
      </div>
    );
  }

  const folders = Object.keys(repos);
  const busy = busyFolder !== null;

  return (
    <div data-testid="repo-map-editor">
      {/* External-wins drift auto-sync notice. No push-upstream repair. */}
      {driftNotice && (
        <div className={styles.driftNotice} data-testid="repo-drift-notice">
          Repo map updated from workspace
        </div>
      )}

      <table className={styles.repoTable} data-testid="repo-map-table">
        <thead>
          <tr>
            <th className={styles.repoTableHeader}>Folder</th>
            <th className={styles.repoTableHeader}>Repo URL</th>
            <th className={styles.repoTableHeader} aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          {folders.map((folder) => {
            const draft = urlDrafts[folder] ?? '';
            const changed = draft.trim() !== repos[folder];
            return (
              <tr key={folder} data-testid={`repo-map-row-${folder}`}>
                <td className={styles.repoTableCell}>
                  <input
                    type="text"
                    className={styles.input}
                    value={folder}
                    disabled
                    aria-label={`Folder ${folder}`}
                    data-testid={`repo-map-folder-${folder}`}
                  />
                </td>
                <td className={styles.repoTableCell}>
                  <input
                    type="text"
                    className={styles.input}
                    value={draft}
                    onChange={(e) =>
                      setUrlDrafts((drafts) => ({ ...drafts, [folder]: e.target.value }))
                    }
                    disabled={busy}
                    aria-label={`Repo URL for ${folder}`}
                    data-testid={`repo-map-url-${folder}`}
                  />
                </td>
                <td className={styles.repoTableActionCell}>
                  <button
                    type="button"
                    className={styles.repoEditorActionButton}
                    onClick={() => handleRepoint(folder)}
                    disabled={busy || !changed}
                    data-testid={`repo-map-update-${folder}`}
                  >
                    {busyFolder === folder ? 'Working...' : 'Update'}
                  </button>{' '}
                  <button
                    type="button"
                    className={styles.repoRowDeleteButton}
                    onClick={() => handleDelete(folder)}
                    disabled={busy}
                    aria-label={`Remove repo ${folder}`}
                    data-testid={`repo-map-delete-${folder}`}
                  >
                    &times;
                  </button>
                </td>
              </tr>
            );
          })}
          {/* Add-repo row */}
          <tr data-testid="repo-map-add-row">
            <td className={styles.repoTableCell}>
              <input
                type="text"
                className={styles.input}
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                placeholder="new folder"
                disabled={busy}
                aria-label="New repo folder name"
                data-testid="repo-map-new-folder"
              />
            </td>
            <td className={styles.repoTableCell}>
              <input
                type="text"
                className={styles.input}
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://github.com/acme/new-repo.git"
                disabled={busy}
                aria-label="New repo URL"
                data-testid="repo-map-new-url"
              />
            </td>
            <td className={styles.repoTableActionCell}>
              <button
                type="button"
                className={styles.repoEditorActionButton}
                onClick={handleAdd}
                disabled={busy || newFolder.trim() === '' || newUrl.trim() === ''}
                data-testid="repo-map-add-button"
              >
                {busyFolder === '' ? 'Working...' : 'Add'}
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      {actionError && (
        <div className={styles.errorMessage} data-testid="repo-map-action-error">
          {actionError}
        </div>
      )}
    </div>
  );
}

export default RepoMapEditor;
