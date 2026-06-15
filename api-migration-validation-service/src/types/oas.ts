/**
 * OAS parser output types. The parser produces a flat inventory of operations
 * with dereferenced request / response schemas attached. The inventory is
 * held in-memory by the orchestrator and passed to the LLM tools
 * (`list_oas_operations`, `get_oas_operation_detail`) which never read from
 * disk directly.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 */

import type { OpenAPIV3 } from 'openapi-types';

export type HttpMethod =
  | 'get'
  | 'put'
  | 'post'
  | 'delete'
  | 'options'
  | 'head'
  | 'patch'
  | 'trace';

/** Verbs that are non-mutating from an HTTP semantics standpoint. */
export const NON_MUTATING_METHODS: ReadonlyArray<HttpMethod> = [
  'get',
  'head',
  'options',
];

export interface ParsedOasOperation {
  /**
   * `operationId` from the OAS document if present, else a synthesized
   * fallback `${method.toUpperCase()}_${path}` slug. The fallback ensures
   * downstream code can always key by a stable id.
   */
  operationId: string;
  method: HttpMethod;
  path: string;
  summary: string | null;
  description: string | null;
  /**
   * Dereferenced request body schema for `application/json` if present, else
   * null. The OAS object can carry many media-type schemas; the v1 capture
   * loop only targets `application/json`.
   */
  requestSchema: OpenAPIV3.SchemaObject | null;
  /**
   * Dereferenced 2xx response schema for `application/json` if present, else
   * null. Picks the lowest 2xx status code (200, 201, 204, ...).
   */
  responseSchema: OpenAPIV3.SchemaObject | null;
  /**
   * The full dereferenced OAS operation object. Stored for AMS persistence
   * (`oas_operation_json`) and surfaced to the LLM via
   * `get_oas_operation_detail`.
   */
  oasOperation: OpenAPIV3.OperationObject;
}

export interface ParsedOasInventory {
  operations: ParsedOasOperation[];
  /** Source spec title -- captured for diagnostic / log lines only. */
  title: string | null;
  version: string | null;
}
