/**
 * Backend Validation Error -> ValidationError mapper
 *
 * Spec: Step 4 of the save-validation improvement series (2026-05-08).
 *
 * The backend `architecture-model-service` `ModelService` throws a
 * structured `ValidationException` carrying an
 * `(entity_type, code, field, entity_id, entity_name)` tuple. Spring's
 * `GlobalExceptionHandler` serialises that as a 400 response with snake_case
 * keys; `modelApi.saveModelByFilename` parses the envelope into a
 * `ModelApiError` with camelCase properties; `saveUtils` builds a
 * `SaveResultBackendError` from those.
 *
 * This helper takes that `SaveResultBackendError`-shaped envelope and
 * converts it into the frontend's existing `ValidationError` shape so the
 * existing pre-save validation panel renders it identically to a
 * frontend-side rule failure.
 *
 * Routing rule:
 *   - If `code` AND `entityType` are both set, return a one-element
 *     `ValidationError[]` derived from the envelope.
 *   - Otherwise return `[]` and let the caller fall back to the toast path.
 *
 * Code -> ValidationError.type mapping is documented inline in
 * {@link CODE_TO_TYPE_MAPPING}. Codes not in the map fall back to
 * `'missing_reference'` (the most generic existing variant), which keeps
 * the panel working for forward-compatibility with new backend codes.
 */

import { ValidationError } from '../types/config';

/**
 * Local-only structural shape of the backend error envelope this helper
 * accepts. Defined inline (not imported from `saveUtils`) to avoid an
 * import cycle -- `saveUtils` is the caller, so the dependency direction
 * has to flow from `saveUtils` -> here.
 */
export interface BackendValidationErrorInput {
  /** HTTP status code from the backend. */
  status: number;
  /** Backend `code` token (e.g. "duplicate_name"), if present. */
  code?: string;
  /** Backend `field` name, if present. */
  field?: string;
  /** Backend `message` field -- the human-readable message. */
  message: string;
  /** Backend `entity_type` (camelCase here). */
  entityType?: string;
  /** Backend `entity_id` (camelCase). */
  entityId?: string;
  /** Backend `entity_name` (camelCase). */
  entityName?: string;
}

/**
 * Concrete mapping of backend `code` tokens to the closest existing
 * {@link ValidationError.type} variant.
 *
 * Backend codes (introduced in Step 4 ModelService refactor):
 * - `application_id_required`     -> `required` (missing required field)
 * - `target_pairwise`             -> `pairwise_constraint`
 * - `invalid_target_type`         -> `invalid_enum`
 * - `invalid_target_ref`          -> `missing_reference`
 * - `endpoint_required`           -> `missing_reference` (missing FK endpoint)
 * - `xor_constraint`              -> `xor_constraint`
 * - `conditional_required`        -> `conditional_required`
 * - `invalid_relationship_type`   -> `invalid_enum`
 * - `name_required`               -> `required`
 *
 * Step 5 codes (DB-layer rejections handled by the GlobalExceptionHandler
 * directly -- they don't carry `entity_type`, so they fall through to the
 * toast path; we don't need to map them here):
 * - `null_violation` / `foreign_key_violation` / `unique_violation` /
 *   `bean_validation` / `constraint_violation`.
 */
export const CODE_TO_TYPE_MAPPING: Record<string, ValidationError['type']> = {
  application_id_required: 'required',
  target_pairwise: 'pairwise_constraint',
  invalid_target_type: 'invalid_enum',
  invalid_target_ref: 'missing_reference',
  endpoint_required: 'missing_reference',
  xor_constraint: 'xor_constraint',
  conditional_required: 'conditional_required',
  invalid_relationship_type: 'invalid_enum',
  name_required: 'required',
};

/**
 * Maps a structured backend error to the frontend's `ValidationError[]`.
 *
 * @param backendError The backend error envelope.
 * @returns A one-element array if the error is structured (has both
 * `entityType` and `code`); otherwise an empty array (caller should fall
 * back to the toast path).
 */
export function mapBackendErrorToValidationErrors(
  backendError: BackendValidationErrorInput | undefined
): ValidationError[] {
  if (!backendError) {
    return [];
  }
  if (!backendError.code || !backendError.entityType) {
    // Generic 4xx without structured fields -- caller renders as toast.
    return [];
  }

  const type = CODE_TO_TYPE_MAPPING[backendError.code] ?? 'missing_reference';

  const validationError: ValidationError = {
    entityType: backendError.entityType,
    entityId: backendError.entityId ?? '',
    field: backendError.field ?? '',
    message: backendError.message,
    type,
  };

  if (backendError.entityName) {
    validationError.entityName = backendError.entityName;
  }

  return [validationError];
}
