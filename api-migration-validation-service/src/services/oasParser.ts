import path from 'path';
import SwaggerParser from '@apidevtools/swagger-parser';
import type { OpenAPI, OpenAPIV3 } from 'openapi-types';
import {
  HttpMethod,
  ParsedOasInventory,
  ParsedOasOperation,
} from '../types/oas';
import type { DiscoveryServiceClient } from './discoveryServiceClient';

/**
 * OAS spec parser. Wraps `@apidevtools/swagger-parser` to produce a flat
 * inventory of operations with dereferenced request / response schemas
 * attached.
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4.
 * Spec: 2026-05-17 Spec File Auto-Linking (Phase 3) -- Task Group 6 extends
 * {@link parseOasFromFile} with internal branching on `path.isAbsolute()`
 * so repo-relative `spec_link` values discovered by the new
 * `specFileLinker` scanner are resolved via Phase 2's discovery-service
 * source endpoint (the file lives in the cached clone, not on the AMVS
 * worker's disk). Absolute paths continue to use the local-read path for
 * back-compat with legacy manual-upload `spec_link` values.
 *
 * The output is held in-memory by the orchestrator and surfaced to the LLM
 * via the `list_oas_operations` and `get_oas_operation_detail` tools (no
 * disk reads from those tools). Persistence into `api_behaviour_operations`
 * happens in Group 6 via `archModelClient.createOperation`.
 *
 * This module is intentionally I/O-isolated: parsing accepts either a file
 * path OR an already-parsed object (for ad-hoc upload paths that read into
 * memory upstream).
 */

const HTTP_METHODS: ReadonlyArray<HttpMethod> = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
];

function isOasV3(spec: OpenAPI.Document): spec is OpenAPIV3.Document {
  return typeof (spec as { openapi?: string }).openapi === 'string';
}

function pickJsonRequestSchema(op: OpenAPIV3.OperationObject): OpenAPIV3.SchemaObject | null {
  const reqBody = op.requestBody as OpenAPIV3.RequestBodyObject | undefined;
  if (!reqBody || !reqBody.content) return null;
  const json = reqBody.content['application/json'];
  if (!json || !json.schema) return null;
  return json.schema as OpenAPIV3.SchemaObject;
}

function pickJsonResponseSchema(op: OpenAPIV3.OperationObject): OpenAPIV3.SchemaObject | null {
  if (!op.responses) return null;
  const codes = Object.keys(op.responses)
    .filter((c) => /^2\d\d$/.test(c))
    .sort();
  if (codes.length === 0) return null;
  const resp = op.responses[codes[0]] as OpenAPIV3.ResponseObject | undefined;
  if (!resp || !resp.content) return null;
  const json = resp.content['application/json'];
  if (!json || !json.schema) return null;
  return json.schema as OpenAPIV3.SchemaObject;
}

function synthesizeOperationId(method: HttpMethod, path: string): string {
  const slug = path
    .replace(/[{}]/g, '')
    .replace(/\W+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${method.toUpperCase()}_${slug || 'root'}`;
}

/**
 * Optional context for {@link parseOasFromFile} repo-relative resolution
 * (spec 2026-05-17 Spec File Auto-Linking Phase 3, Task Group 6).
 *
 * When `ctx` is supplied AND `specLinkPath` is repo-relative
 * (`path.isAbsolute(specLinkPath) === false`), the parser fetches the
 * file content via Phase 2's discovery-service source endpoint instead of
 * the local filesystem. The `discoveryRunId`, `projectId`, and
 * `architectureId` flow through to the source-fetch URL composition.
 *
 * When `ctx` is omitted (legacy callers) OR `specLinkPath` is absolute,
 * the parser falls back to the existing local `fs.readFile` -- back-compat
 * for legacy manual-upload `spec_link` values that are still absolute
 * paths on disk.
 */
export interface ParseOasFromFileCtx {
  /**
   * Discovery run id whose cached clone holds the source file. Read off
   * the capture session at the route layer
   * (`captureSessionActions.parse-oas`). When the session has no linked
   * discovery run, this is undefined and the call still works for absolute
   * paths (legacy fall-through).
   */
  discoveryRunId?: string;
  /**
   * Override for the source-fetch client. Production callers leave this
   * undefined; the parser falls back to the singleton import from
   * `discoveryServiceClient.ts`. Tests inject a stub so they can assert the
   * fetch URL and return canned bodies.
   */
  discoveryServiceClient?: DiscoveryServiceClient;
  /**
   * Project id for the source-fetch URL.
   */
  projectId?: string;
  /**
   * Architecture id for the source-fetch URL.
   */
  architectureId?: string;
}

/**
 * Structured error thrown when the discovery-service source endpoint
 * reports the cached clone has been evicted (HTTP 410 Gone). The route
 * layer in `captureSessionActions` catches this and surfaces a "Source no
 * longer cached" message to the wizard so the user can re-run discovery.
 *
 * Spec: 2026-05-17 Spec File Auto-Linking (Phase 3) -- Task Group 6.
 */
export class SpecLinkCloneEvictedError extends Error {
  public readonly kind: 'spec_link_clone_evicted' = 'spec_link_clone_evicted';
  public readonly specLinkPath: string;
  public readonly discoveryRunId?: string;

  constructor(specLinkPath: string, discoveryRunId?: string) {
    super(
      `Source no longer cached for spec_link='${specLinkPath}' on discovery run '${
        discoveryRunId ?? 'unknown'
      }'.`,
    );
    this.name = 'SpecLinkCloneEvictedError';
    this.specLinkPath = specLinkPath;
    this.discoveryRunId = discoveryRunId;
  }
}

/**
 * Private helper: fetch a repo-relative spec file via Phase 2's
 * discovery-service source endpoint and parse the returned bytes as
 * either JSON or YAML. The result is handed to the same downstream OAS
 * parser pipeline as the local-read branch.
 *
 * The 410-Gone surface is converted to a structured
 * {@link SpecLinkCloneEvictedError} so the caller can identify the
 * clone-evicted case and surface "Source no longer cached" to the wizard
 * without parsing error strings.
 */
async function fetchRepoRelativeSpec(
  specLinkPath: string,
  ctx: ParseOasFromFileCtx,
): Promise<object> {
  if (!ctx.discoveryServiceClient) {
    throw new Error(
      `parseOasFromFile: repo-relative spec_link='${specLinkPath}' requires a discoveryServiceClient in ctx.`,
    );
  }
  if (!ctx.projectId || !ctx.architectureId || !ctx.discoveryRunId) {
    throw new Error(
      `parseOasFromFile: repo-relative spec_link='${specLinkPath}' requires ctx.projectId, ctx.architectureId, and ctx.discoveryRunId.`,
    );
  }
  const fetched = await ctx.discoveryServiceClient.fetchSourceFile({
    projectId: ctx.projectId,
    architectureId: ctx.architectureId,
    runId: ctx.discoveryRunId,
    repoPath: specLinkPath,
  });
  if (fetched.kind === 'evicted') {
    throw new SpecLinkCloneEvictedError(specLinkPath, ctx.discoveryRunId);
  }
  if (fetched.kind === 'not_found') {
    throw new Error(
      `parseOasFromFile: discovery-service reported repo path '${specLinkPath}' not found on run '${ctx.discoveryRunId}'.`,
    );
  }
  if (fetched.kind === 'error') {
    throw new Error(
      `parseOasFromFile: discovery-service source fetch for '${specLinkPath}' failed: ${fetched.message}`,
    );
  }
  // kind === 'ok' -- parse body as JSON first, fall back to YAML on a
  // JSON.parse exception. The YAML branch uses `js-yaml`, which is already
  // present in the install graph as a transitive dependency of
  // `@apidevtools/swagger-parser`; we do NOT add a direct dep here.
  return parseSpecText(fetched.content, specLinkPath);
}

/**
 * Parse a contract source string into an in-memory object, accepting BOTH JSON
 * and YAML. Originally private to the repo-relative `spec_link` fetch path;
 * EXPORTED (spec 2026-06-03 OAS-YAML + WADL/XSD Contract Support, Task Group 1)
 * so the multipart-upload branch in `captureSessionActions.parse-oas` reuses
 * the exact same JSON-or-YAML tolerance for ad-hoc OAS uploads (the upload path
 * was previously hardcoded to `JSON.parse`, which rejected `.yaml` / `.yml`
 * specs).
 *
 * `specLinkPath` (or, on the upload path, the original file name) is only a
 * HINT for which parser to try first -- a `.json` suffix or a `{`/`[` first
 * character prefers JSON; the other parser is always the fallback, so a
 * mis-named file still parses. Throws when neither JSON nor YAML yields an
 * object; the route maps that throw to a clear 400.
 */
export function parseSpecText(content: string, specLinkPath: string): object {
  const trimmed = content.trimStart();
  // JSON typically starts with `{` or `[`; YAML starts with anything else
  // (commonly `openapi:` or a comment line). We try JSON first when the
  // path hints JSON or the content shape looks JSON-ish; otherwise YAML
  // first, then JSON as a fallback.
  const lower = specLinkPath.toLowerCase();
  const looksJson = lower.endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[');
  if (looksJson) {
    try {
      return JSON.parse(content) as object;
    } catch {
      return loadYaml(content, specLinkPath);
    }
  }
  return loadYaml(content, specLinkPath);
}

function loadYaml(content: string, specLinkPath: string): object {
  // Late require so the YAML parser is only loaded when actually needed
  // (e.g. mid-test the absolute-path branch never touches it).
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const yaml = require('js-yaml') as { load: (s: string) => unknown };
  const parsed = yaml.load(content);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(
      `parseOasFromFile: repo-relative spec '${specLinkPath}' did not parse to an object.`,
    );
  }
  return parsed as object;
}

/**
 * Parse + dereference + validate an OAS document by file path or
 * repo-relative `spec_link` value.
 *
 * Branching on `path.isAbsolute(specLinkPath)`:
 *
 *   - Absolute path (legacy manual-upload values, or `ctx` omitted) ->
 *     SwaggerParser reads the file directly from the local filesystem.
 *   - Repo-relative WITH `ctx` (new discovery-driven path; spec
 *     2026-05-17 Phase 3 Workstream C) -> fetch the bytes via Phase 2's
 *     discovery-service source endpoint using the `ctx.discoveryRunId`,
 *     parse JSON or YAML, then feed the in-memory object through the same
 *     downstream parser pipeline as {@link parseOasFromObject}.
 *
 * Throws on malformed / missing files. Callers in Group 6 catch this and
 * surface an `endpoint_skipped` / `failed_request` diagnostic against the
 * session. The 410-Gone source-endpoint surface is escalated as a
 * {@link SpecLinkCloneEvictedError} so the route layer can map it to the
 * "Source no longer cached" wizard message.
 */
export async function parseOasFromFile(
  specLinkPath: string,
  ctx?: ParseOasFromFileCtx,
): Promise<ParsedOasInventory> {
  // Repo-relative branch -- only taken when ctx is supplied AND the
  // spec_link value is NOT an absolute filesystem path. The check uses the
  // current platform's `path.isAbsolute` because that matches what
  // Workstream A's scanner emits (repo-relative POSIX-style segments) and
  // what legacy manual-upload values store (absolute platform paths).
  if (ctx && !path.isAbsolute(specLinkPath)) {
    const parsedObj = await fetchRepoRelativeSpec(specLinkPath, ctx);
    return parseOasFromObject(parsedObj);
  }
  // Absolute-path / legacy / no-ctx branch -- local fs.readFile via
  // SwaggerParser. Unchanged from the pre-Phase-3 behaviour.
  const validated = (await SwaggerParser.validate(specLinkPath)) as OpenAPI.Document;
  const dereferenced = (await SwaggerParser.dereference(validated)) as OpenAPI.Document;
  return buildInventory(dereferenced);
}

/**
 * Parse + dereference + validate an in-memory OAS document. Used by the
 * ad-hoc upload path where the file bytes were never written to disk
 * (raw bytes are NOT persisted -- only the parsed inventory) AND by the
 * repo-relative `parseOasFromFile` branch (spec 2026-05-17 Phase 3
 * Workstream C) once the source-endpoint fetch has produced an object.
 */
export async function parseOasFromObject(spec: object): Promise<ParsedOasInventory> {
  // SwaggerParser.validate accepts either path or object; clone-on-write
  // avoids it mutating the caller-supplied object.
  const cloned = JSON.parse(JSON.stringify(spec)) as OpenAPI.Document;
  const validated = (await SwaggerParser.validate(cloned)) as OpenAPI.Document;
  const dereferenced = (await SwaggerParser.dereference(validated)) as OpenAPI.Document;
  return buildInventory(dereferenced);
}

function buildInventory(spec: OpenAPI.Document): ParsedOasInventory {
  if (!isOasV3(spec)) {
    throw new Error(
      'OAS v2 (Swagger 2.0) documents are not supported -- convert to OAS v3 before upload.',
    );
  }
  const operations: ParsedOasOperation[] = [];
  const paths = spec.paths ?? {};
  for (const [routePath, pathItem] of Object.entries(paths)) {
    if (!pathItem) continue;
    const item = pathItem as OpenAPIV3.PathItemObject;
    for (const method of HTTP_METHODS) {
      const op = item[method] as OpenAPIV3.OperationObject | undefined;
      if (!op) continue;
      const operationId = op.operationId ?? synthesizeOperationId(method, routePath);
      operations.push({
        operationId,
        method,
        path: routePath,
        summary: op.summary ?? null,
        description: op.description ?? null,
        requestSchema: pickJsonRequestSchema(op),
        responseSchema: pickJsonResponseSchema(op),
        oasOperation: op,
      });
    }
  }
  return {
    operations,
    title: spec.info?.title ?? null,
    version: spec.info?.version ?? null,
  };
}
