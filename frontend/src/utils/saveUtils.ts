/**
 * Save Utility Functions
 *
 * Spec 2026-01-05: Auto-Save After Create Project
 * Task Group 1: Extracted save logic from TopBar for reusability
 *
 * Provides a reusable save function that can be called from multiple
 * components (TopBar, CreateProjectModal) to save the model to the backend.
 *
 * Step 1 of the 5-step save-validation improvement series (2026-05-08):
 *   On `ModelApiError` from `saveModelByFilename`, propagate the structured
 *   envelope (`status`, `code`, `field`, `message`) on the SaveResult so
 *   downstream callers can route to the existing pre-save validation panel
 *   in Step 4. The `result.error` string remains populated for the existing
 *   toast call site -- it carries the most informative human-readable
 *   message available (`message` -> `error` -> `${status} ${statusText}`).
 *
 * Step 4 of the 5-step save-validation improvement series (2026-05-08):
 *   When the backend returns a structured ValidationException (carrying
 *   `entity_type` + `code` + `field` + `entity_id` + `entity_name`), map
 *   it to a `ValidationError` and return it on `result.validationErrors`
 *   so the existing pre-save validation panel renders it identically to
 *   a frontend-side rule failure. Generic 4xx without `entity_type` /
 *   `code` continue to flow through `result.error` to the toast.
 *
 * Spec 2026-05-11 Frontend Architecture-Scoped Save Migration:
 *   `saveModelToBackend` now takes `projectId` and `architectureId` as
 *   required arguments and threads them through to the architecture-scoped
 *   `saveModelByFilename` API call. There is NO legacy overload -- every
 *   caller must pass the active project id and architecture id at the call
 *   site (typically from `useProject()` / `useActiveArchitectureId()`).
 *   Without architecture scoping the backend save endpoint is non-deterministic
 *   in the post-clone scenario where two model_files rows share a filename
 *   across architectures.
 */

import { ArchitectureModel } from '../types/model';
import { ValidationError } from '../types/config';
import { AppAction } from '../contexts/ArchitectureContext';
import { prepareModelForSave, validateModel } from './validation';
import { sanitizeModelForBackendSave } from './sanitize';
import { saveModelByFilename } from '../api/modelApi';
import { ModelApiError } from '../api/types/modelApiError';
import { validateFilename } from './validateName';
import { mapBackendErrorToValidationErrors } from './backendValidationError';

/**
 * Structured backend error envelope, surfaced on SaveResult when the backend
 * rejects the save with a non-2xx that carries a `GlobalExceptionHandler`
 * envelope. Mirrors the backend JSON keys verbatim. Step 4 of the save-
 * validation series uses `code` + `entityType` to route the error to the
 * existing pre-save validation panel.
 */
export interface SaveResultBackendError {
  /** HTTP status code from the backend. */
  status: number;
  /** Backend `code` token (e.g. "duplicate_name"), if present. */
  code?: string;
  /** Backend `field` name (e.g. "name"), if present. */
  field?: string;
  /** Backend `message` field -- the human-readable message. */
  message: string;
  /**
   * Backend `entity_type` (camelCase here on the SaveResult). Present when
   * a service-layer ValidationException routed via the structured 400.
   */
  entityType?: string;
  /** Backend `entity_id` (camelCase). */
  entityId?: string;
  /** Backend `entity_name` (camelCase). */
  entityName?: string;
}

/**
 * Result object returned by saveModelToBackend.
 * Provides structured information about the save operation outcome.
 */
export interface SaveResult {
  /** Whether the save was successful */
  success: boolean;
  /** The filename that was saved (only on success) */
  filename?: string;
  /** Error message (only on API failure) */
  error?: string;
  /** Validation errors (only when validation fails) */
  validationErrors?: ValidationError[];
  /**
   * Structured backend error envelope (only when the backend returns a
   * `ModelApiError`). Provided in addition to `error` so callers can route
   * structured errors to the validation panel without parsing strings.
   *
   * Step 1 of the save-validation series: this field is populated for the
   * existing toast call site to ignore (it reads `error`).
   * Step 4 reads it via `mapBackendErrorToValidationErrors` to route
   * structured errors into `validationErrors`.
   */
  backendError?: SaveResultBackendError;
}

/**
 * Save the model to the backend.
 *
 * This function encapsulates the complete save flow:
 * 1. Prepare model (reconcile all derived entities)
 * 2. Validate the prepared model
 * 3. Sanitize the model for backend (convert "" to undefined for FK fields)
 * 4. Save to backend via API (architecture-scoped URL)
 * 5. Dispatch LOAD_MODEL action to update state (including loadedFileName)
 *
 * Spec 2026-05-11: `projectId` and `architectureId` are REQUIRED. They are
 * threaded through to `saveModelByFilename` which will throw before issuing
 * the fetch when either is missing -- making missing-context bugs fail loud
 * at the call site rather than silently corrupting the wrong architecture's
 * model_file via the legacy filename-only lookup.
 *
 * @param model - The architecture model to save
 * @param filename - The filename to save as
 * @param projectId - The active project UUID -- REQUIRED, must be non-empty
 * @param architectureId - The active architecture UUID -- REQUIRED, must be non-empty
 * @param dispatch - The dispatch function from ArchitectureContext
 * @returns A SaveResult object indicating success or failure with details
 */
export async function saveModelToBackend(
  model: ArchitectureModel,
  filename: string,
  projectId: string,
  architectureId: string,
  dispatch: React.Dispatch<AppAction>
): Promise<SaveResult> {
  try {
    // 0. Validate filename before any processing
    const filenameError = validateFilename(filename);
    if (filenameError) {
      return {
        success: false,
        validationErrors: [{
          entityType: 'root',
          entityId: '',
          field: 'filename',
          message: filenameError,
          type: 'required',
        }],
      };
    }

    // 1. Prepare model (reconcile all derived entities)
    const prepared = prepareModelForSave(model);

    // 2. Validate the prepared model
    const errors = validateModel(prepared);

    // 3. If validation fails, return failure result with validation errors
    if (errors.length > 0) {
      return {
        success: false,
        validationErrors: errors,
      };
    }

    // 4. Sanitize the model for backend (convert "" to undefined for FK fields)
    const sanitized = sanitizeModelForBackendSave(prepared);

    // 5. Save to backend (architecture-scoped URL -- spec 2026-05-11)
    await saveModelByFilename(projectId, architectureId, filename, sanitized);

    // 6. Update the loaded filename in state (use prepared model to preserve reconciliation)
    dispatch({ type: 'LOAD_MODEL', payload: prepared, fileName: filename });

    return {
      success: true,
      filename,
    };
  } catch (err) {
    // Step 1 of save-validation series: when the API helper threw a
    // structured `ModelApiError`, expose the envelope on the SaveResult so
    // downstream callers can route to a validation panel. The existing
    // toast call site continues to read `result.error`.
    if (err instanceof ModelApiError) {
      const backendError: SaveResultBackendError = {
        status: err.status,
        code: err.code,
        field: err.field,
        message: err.message,
        entityType: err.entityType,
        entityId: err.entityId,
        entityName: err.entityName,
      };
      // Step 4 of save-validation series: when the backend error carries
      // `entityType` AND `code` (i.e. a structured ValidationException
      // from ModelService), map it to a ValidationError so the existing
      // pre-save validation panel renders it identically to a frontend
      // rule failure. Generic 4xx without those fields fall through to
      // the `error` toast path.
      const validationErrors = mapBackendErrorToValidationErrors(backendError);
      if (validationErrors.length > 0) {
        return {
          success: false,
          validationErrors,
          backendError,
        };
      }
      return {
        success: false,
        error: err.message,
        backendError,
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to save model to server',
    };
  }
}
