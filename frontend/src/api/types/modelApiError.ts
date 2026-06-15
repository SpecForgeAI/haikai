/**
 * ModelApiError
 *
 * Step 1 of the 5-step save-validation improvement series.
 *
 * Custom error class thrown by `modelApi.ts` save helpers when the backend
 * returns a non-2xx response. Carries the structured envelope emitted by the
 * `architecture-model-service` `GlobalExceptionHandler`:
 *
 *   {
 *     timestamp: ISO-8601 string,
 *     status:    int,
 *     error:     "Bad Request" | "Conflict" | ...,
 *     message:   human-readable string,
 *     code?:     short stable token (e.g. "duplicate_name"),
 *     field?:    field name (e.g. "name")
 *   }
 *
 * Field names mirror the backend JSON keys exactly so callers can route
 * errors based on `code` / `field` without re-mapping.
 *
 * The `.message` property is set to the most informative human-readable string
 * available, in priority order:
 *   1. backend `message` field
 *   2. backend `error` field
 *   3. `${status} ${statusText}`
 *
 * Step 4 of this series extends the envelope with the structured-validation
 * triple `entity_type`, `entity_id`, `entity_name` (snake_case on the wire,
 * camelCase as exposed properties on the class). These let the frontend
 * route a backend ValidationException into the existing pre-save validation
 * panel so it looks identical to a frontend-side rule failure.
 */

/**
 * Optional structured envelope fields parsed from the backend response body.
 *
 * Snake_case keys mirror the JSON wire format emitted by the
 * `GlobalExceptionHandler`. `message` and `error` carry their backend
 * meanings (human-readable text and reason phrase respectively).
 */
export interface ModelApiErrorEnvelope {
  /** Backend HTTP status (mirrors `status` field, kept here for direct access). */
  status: number;
  /** Human-readable message (backend `message` field). */
  message?: string;
  /** Short stable token (backend `code` field, e.g. "duplicate_name"). */
  code?: string;
  /** Field name the error refers to (backend `field` field). */
  field?: string;
  /** Reason phrase / error category (backend `error` field). */
  error?: string;
  /** ISO-8601 timestamp from the backend (backend `timestamp` field). */
  timestamp?: string;
  /**
   * Entity type (backend `entity_type` field, e.g. "application_points").
   * Populated for service-layer ValidationException responses introduced
   * in Step 4 of the save-validation series.
   */
  entity_type?: string;
  /**
   * Entity id (backend `entity_id` field). Populated alongside `entity_type`.
   */
  entity_id?: string;
  /**
   * Entity name (backend `entity_name` field). May be undefined for entities
   * that have no `name` (e.g. relationship records).
   */
  entity_name?: string;
  /** Raw response body text (kept for debugging / logging). */
  rawBody?: string;
}

/**
 * Error thrown by save-side `modelApi` helpers when the backend returns
 * a non-2xx response. Exposes both a sensible `.message` and the structured
 * envelope fields for callers that want to route errors based on `code` or
 * `field`.
 */
export class ModelApiError extends Error {
  /** Backend HTTP status. */
  public readonly status: number;
  /** Backend `code` token, if present. */
  public readonly code?: string;
  /** Backend `field` name, if present. */
  public readonly field?: string;
  /** Backend `error` reason phrase, if present. */
  public readonly errorCategory?: string;
  /** Backend `timestamp`, if present. */
  public readonly timestamp?: string;
  /**
   * Backend `entity_type`, if present. Populated for service-layer
   * `ValidationException` responses introduced in Step 4.
   */
  public readonly entityType?: string;
  /** Backend `entity_id`, if present. */
  public readonly entityId?: string;
  /** Backend `entity_name`, if present. */
  public readonly entityName?: string;
  /** Raw response body text (best-effort). */
  public readonly rawBody?: string;

  constructor(message: string, envelope: ModelApiErrorEnvelope) {
    super(message);
    this.name = 'ModelApiError';
    this.status = envelope.status;
    this.code = envelope.code;
    this.field = envelope.field;
    this.errorCategory = envelope.error;
    this.timestamp = envelope.timestamp;
    this.entityType = envelope.entity_type;
    this.entityId = envelope.entity_id;
    this.entityName = envelope.entity_name;
    this.rawBody = envelope.rawBody;

    // Restore prototype chain for `instanceof` to work correctly when
    // targeting older transpilation targets.
    Object.setPrototypeOf(this, ModelApiError.prototype);
  }
}
