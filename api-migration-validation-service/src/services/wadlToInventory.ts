/**
 * WADL -> ParsedOasInventory adapter.
 *
 * Spec: 2026-06-03 OAS-YAML + WADL/XSD Contract Support for the API Behaviour
 * capture harness, Task Group 2.
 *
 * Maps a `WadlParseResult` (REST operations: method + path + representations,
 * the body grammar declared via XSD `element=` refs) into the SAME
 * `ParsedOasInventory` shape the OAS parser produces, so the existing capture
 * pipeline (`persistInventory` -> `api_behaviour_operations`, the
 * `get_oas_operation_detail` LLM tool, the Sybase-sampled scenario generation)
 * consumes WADL operations UNCHANGED.
 *
 * Per-operation mapping:
 *   - `method`        = `httpMethod.toLowerCase()`
 *   - `path`          = `path`
 *   - `operationId`   = `methodId` when present, else synthesised from
 *                       `compositeId` (`POST /a/{b}` -> `POST_a_b`)
 *   - `summary`/`description` = `doc` (the WADL has a single doc string per op)
 *   - `requestSchema`  = the XSD-derived JSON Schema for the request
 *                        representation's `element=` ref (null when the
 *                        representation has no body / no grammar / unresolved)
 *   - `responseSchema` = same, for the response representation
 *   - `oasOperation`   = a minimal synthesised `OperationObject` embedding the
 *                        two schemas under `application/json` so AMS persistence
 *                        (`oas_operation_json`) has a non-null payload.
 *
 * The request/response schemas are produced by `elementToJsonSchema`, which
 * field-walks the XSD complex type behind the element into an
 * `OpenAPIV3.SchemaObject` (object `properties` + `required`, arrays via
 * `items`, restriction facets onto `enum`/`pattern`/bounds). That is EXACTLY
 * the JSON-Schema shape the LLM + DB sampler already understand, so a WADL+XSD
 * operation gets realistic Sybase-sourced inputs with no sampler change.
 *
 * Path/query/header params are likewise typed from their XSD `type=` qname via
 * `paramSchemaFromXsdType` (xsd built-ins -> primitive type/format; named
 * restricted simpleTypes -> base type + facets), so the LLM sees the real
 * `type`/`format`/`pattern`/`enum`/bounds rather than a bare `{type:'string'}`.
 *
 * MULTI-SEGMENT path templates: a WADL resource tree flattens to a path that
 * may carry SEVERAL `{...}` template segments (e.g. nested `<resource>` nodes
 * yield `hierarchynodes/{cobDate}/{orgId}`). EVERY such segment must surface as
 * its own `path` parameter -- otherwise the capture LLM, reading only the
 * declared `<param>` set, treats a multi-segment template like a single
 * `/{id}` and the request 500s. WADLs frequently declare a `<param
 * style="template">` for only SOME (or none) of the segments, so we
 * additionally synthesise a `path` parameter for any `{segment}` in the
 * flattened path template that has no declared template param, defaulting its
 * schema to `{ type: 'string' }`. Path params are always `required:true`.
 *
 * Pure: no I/O. Callers resolve the XSD source files (upload parts or
 * spec-link siblings) and hand them in already loaded.
 */

import type { OpenAPIV3 } from 'openapi-types';
import type { ParsedOasInventory, ParsedOasOperation, HttpMethod } from '../types/oas';
import type {
  WadlOperation,
  WadlParseResult,
  WadlRepresentation,
} from './wadlParser';
import {
  buildXsdRegistry,
  elementToJsonSchema,
  paramSchemaFromXsdType,
  type XsdTypeRegistry,
} from './xsdSchemaModel';

const VALID_HTTP_METHODS = new Set<HttpMethod>([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]);

/**
 * Extract the ordered list of `{segment}` template-variable names from a
 * flattened resource path. `hierarchynodes/{cobDate}/{orgId}` ->
 * `['cobDate', 'orgId']`. Returns an empty array for a path with no template
 * segments. Duplicate names (an unusual but legal authoring quirk) are kept in
 * order; the caller dedups against the declared/synthesised param set.
 */
function pathTemplateSegments(path: string): string[] {
  const out: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    const name = m[1].trim();
    if (name.length > 0) out.push(name);
  }
  return out;
}

/**
 * Synthesise an operationId from a WADL `compositeId` (`POST /a/{b}` ->
 * `POST_a_b`). Mirrors `oasParser.synthesizeOperationId` so WADL + OAS rows
 * share the same fallback id style.
 */
function synthOperationId(op: WadlOperation): string {
  const slug = op.path
    .replace(/[{}]/g, '')
    .replace(/\W+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${op.httpMethod.toUpperCase()}_${slug || 'root'}`;
}

/**
 * Pick the representation whose `element=` ref resolves into a schema. Prefers
 * an `application/json` representation, then any representation that carries a
 * `schemaElementRef`. WADL commonly lists the same element under both
 * `application/json` and `application/xml`; either yields the same schema.
 */
function pickRepresentation(reps: WadlRepresentation[]): WadlRepresentation | null {
  if (reps.length === 0) return null;
  const json = reps.find(
    (r) => r.mediaType === 'application/json' && r.schemaElementRef,
  );
  if (json) return json;
  const withRef = reps.find((r) => r.schemaElementRef);
  if (withRef) return withRef;
  return reps[0];
}

/**
 * Derive the JSON Schema for a representation's element ref against the XSD
 * registry. Returns null when the representation carries no element ref, or the
 * ref does not resolve in any provided grammar (the WADL parser separately
 * reports such refs on `missingSchemaElements`).
 */
function schemaForRepresentation(
  rep: WadlRepresentation | null,
  registry: XsdTypeRegistry,
): OpenAPIV3.SchemaObject | null {
  if (!rep || !rep.schemaElementRef) return null;
  const result = elementToJsonSchema(rep.schemaElementRef, registry);
  return result.resolved ? result.schema : null;
}

/**
 * Build a minimal synthesised `OperationObject` embedding the request/response
 * schemas under `application/json`, so AMS persistence + the
 * `get_oas_operation_detail` tool surface a coherent operation object. Marked
 * with `x-amvs-source: 'wadl'` so downstream diagnostics can spot
 * WADL-derived rows.
 *
 * Param schemas are derived from each `WadlParam.type` XSD qname via
 * `paramSchemaFromXsdType` against the shared `registry`, so they carry the
 * real XSD type/format/facets (with `{ type: 'string' }` the fallback for
 * `'unknown'` / missing / unresolved types).
 *
 * EVERY `{segment}` in the flattened path template is guaranteed a `path`
 * parameter: declared `<param style="template">` nodes carry their XSD type,
 * and any template segment WITHOUT a matching declared param is back-filled
 * with a `{ type: 'string' }` `path` param so a multi-segment template never
 * collapses to a single `/{id}` for the capture LLM. All path params are
 * `required:true`.
 */
function synthOperationObject(
  op: WadlOperation,
  requestSchema: OpenAPIV3.SchemaObject | null,
  responseSchema: OpenAPIV3.SchemaObject | null,
  registry: XsdTypeRegistry,
): OpenAPIV3.OperationObject {
  const operationObject: OpenAPIV3.OperationObject = {
    responses: {},
  };
  if (op.methodId) operationObject.operationId = op.methodId;
  if (op.doc) {
    operationObject.summary = op.doc;
    operationObject.description = op.doc;
  }

  // Path / query / header params -> OAS ParameterObjects so the LLM sees them.
  const parameters: OpenAPIV3.ParameterObject[] = [];
  // Track which path-param NAMES we have already emitted so the
  // template-segment back-fill below never duplicates a declared one.
  const emittedPathParamNames = new Set<string>();
  for (const p of op.params) {
    const location =
      p.style === 'template'
        ? 'path'
        : p.style === 'header'
          ? 'header'
          : p.style === 'matrix'
            ? 'path'
            : 'query';
    if (location === 'path') emittedPathParamNames.add(p.name);
    parameters.push({
      name: p.name,
      in: location as OpenAPIV3.ParameterObject['in'],
      required: location === 'path' ? true : p.required,
      schema: paramSchemaFromXsdType(p.type, registry),
    });
  }

  // Back-fill a `path` parameter for EVERY `{segment}` in the flattened path
  // template that has no declared template param. A multi-segment template
  // (e.g. `/hierarchynodes/{cobDate}/{orgId}`) often declares params for only
  // some -- or none -- of its segments; without this the LLM would never see
  // (and so never fill) the missing segments and the request 500s. The XSD
  // type is unknown for a back-filled segment, so it gets the `{ type:
  // 'string' }` fallback; segments WITH a declared param keep their typed
  // schema above. Always `required:true` (a path segment is never optional).
  for (const segName of pathTemplateSegments(op.path)) {
    if (emittedPathParamNames.has(segName)) continue;
    emittedPathParamNames.add(segName);
    parameters.push({
      name: segName,
      in: 'path',
      required: true,
      schema: { type: 'string' },
    });
  }

  if (parameters.length > 0) operationObject.parameters = parameters;

  if (requestSchema) {
    operationObject.requestBody = {
      content: {
        'application/json': { schema: requestSchema },
      },
    } as OpenAPIV3.RequestBodyObject;
  }
  operationObject.responses = {
    '200': responseSchema
      ? {
          description: op.doc ?? 'Success',
          content: { 'application/json': { schema: responseSchema } },
        }
      : { description: op.doc ?? 'Success' },
  } as OpenAPIV3.ResponsesObject;

  (operationObject as Record<string, unknown>)['x-amvs-source'] = 'wadl';
  return operationObject;
}

/**
 * Adapt a `WadlParseResult` (+ already-loaded XSD grammar sources) into a
 * `ParsedOasInventory`. `xsdSources` maps each grammar file's name -> its
 * contents (the WADL `<grammars><include href>` targets, supplied as upload
 * parts or spec-link siblings).
 */
export function wadlToInventory(
  result: WadlParseResult,
  xsdSources: Map<string, string>,
): ParsedOasInventory {
  const registry = buildXsdRegistry(xsdSources);
  const operations: ParsedOasOperation[] = [];

  for (const op of result.operations) {
    const rawMethod = op.httpMethod.toLowerCase();
    const method = (VALID_HTTP_METHODS.has(rawMethod as HttpMethod)
      ? rawMethod
      : 'post') as HttpMethod;

    const requestRep = pickRepresentation(op.request.representations);
    const responseRep = pickRepresentation(op.response.representations);
    const requestSchema = schemaForRepresentation(requestRep, registry);
    const responseSchema = schemaForRepresentation(responseRep, registry);

    const operationId =
      op.methodId && op.methodId.length > 0 ? op.methodId : synthOperationId(op);

    const oasOperation = synthOperationObject(
      op,
      requestSchema,
      responseSchema,
      registry,
    );

    operations.push({
      operationId,
      method,
      path: op.path,
      summary: op.doc,
      description: op.doc,
      requestSchema,
      responseSchema,
      oasOperation,
    });
  }

  const iface = result.interfaces[0];
  return {
    operations,
    title: iface?.applicationTitle ?? null,
    version: iface?.version ?? null,
  };
}
