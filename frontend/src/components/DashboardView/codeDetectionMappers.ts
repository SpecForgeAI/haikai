/**
 * codeDetectionMappers.ts
 *
 * Spec 2 (2026-05-10): Code Detection Detail Mappers — Task Group 1.
 *
 * Pure (no React, no CSS, no API, no logging side-effects) mapper layer
 * that converts a `DiscoveryCandidateDto` into a curated, render-ready
 * `CodeDetectionDisplay` describing why the candidate was detected from
 * code. The renderer (`CodeDetectionPanel.tsx`) consumes this layer and
 * walks the returned `fields` array.
 *
 * The mappers consume `candidate.data` exactly as the discovery-service
 * adapters emit it today (camelCase field names: `httpMethod`, `fullPath`,
 * `controllerClassName`, `methodName`, `responseType`,
 * `interfaceClassName`, `logicalEntityName`, ...). No DTO, no adapter,
 * no API change is required.
 *
 * Behaviour rules:
 * - Drop optional fields silently when missing/null/empty — never emit a
 *   label with no value.
 * - Source files are deduped, capped at 5, and overflow with
 *   `…and N more` as a trailing list element (N counts the original
 *   pre-dedup overflow per the test fixture in
 *   `__tests__/codeDetectionMappers.test.ts`).
 * - The bean-definition discriminator
 *   (`data.interfaceSubtype === 'spring-bean-definition'`) selects a
 *   dedicated bean layout instead of the controller layout for
 *   `interfaces` candidates.
 * - The dispatcher's default branch is defensive only; unsupported
 *   candidate types are gated upstream by `supportsDetails()`.
 *
 * Spec 2026-05-29 (Endpoint->Data-Effect Call Graph for Discovery) —
 * Task Group 4.2: a new `endpoint_data_effects` branch curates the
 * headline access mode plus the endpoint -> entity identity (and the
 * operation hint / transactional flag) into Code Detection fields. The
 * structured controller -> service -> repository hop list itself renders
 * as a SEPARATE read-only, expandable block in `CandidateDetailsPanel`
 * (Task Group 4.3) via `buildEndpointDataEffectPathHops` below — NOT as
 * flat Code Detection fields — so this mapper deliberately stops at the
 * summary fields. The `data` shape it reads is exactly what the
 * discovery-service Spring Classic adapter emits
 * (`endpointDataEffectCandidates.ts`): `endpointName`, `dataEntityName`,
 * `access_mode`, `operation_hint`, `transactional`, plus the
 * `path_metadata_json` object consumed by the hop-list helper.
 *
 * Spec 2026-05-29 (Business-logic behaviour capture — Gap C) — Task
 * Group 3.3/3.4: a `business_logics` candidate may carry a structured
 * 7-part behaviour block under `data.behavior` (the snake_case JSONB blob
 * Group 1/Group 2 persist). The loose snake_case typing
 * (`DiscoveryBehaviourBlock`) and the malformed-tolerant reader
 * (`buildBehaviourBlock`) live below, alongside `buildEndpointDataEffectPathHops`,
 * so `CandidateDetailsPanel`'s read-only expandable `BehaviourBlock`
 * component can consume them. The block renders nothing when no usable
 * structured block is present (same idiom as the hop-list helper returning
 * `[]`).
 */

import type { DiscoveryCandidateDto } from '../../api/discoveryApi';

// ===========================================================================
// Display model
// ===========================================================================

/**
 * One curated row in the Code Detection panel.
 *
 * `value` may be a single string (rendered on the same line as the label)
 * or a `string[]` (rendered as a vertical list under the label). Array-of-
 * objects payloads (`pathVariables`, `requestParams`, `openApiResponses`)
 * are flattened to `string[]` by the formatting helpers below.
 */
export interface CodeDetectionField {
  label: string;
  value: string | string[];
}

/**
 * The full Code Detection display model the renderer consumes.
 *
 * - `detectedBy` is the human-readable adapter label (or
 *   "deterministic code analysis" when no adapter tag is present).
 * - `reason` is a single sentence describing why the candidate was
 *   produced; mappers pick it from a small per-type set.
 * - `sourceFiles` is the deduped, capped list of source paths
 *   (with a trailing `…and N more` line when overflowing).
 * - `fields` is the ordered curated list of type-specific rows.
 * - `isMostlyEmpty` is true when the candidate type is supported but
 *   no curated fields are populated. The renderer uses this to drop
 *   a single subdued "Type-specific details: not available." line.
 */
export interface CodeDetectionDisplay {
  detectedBy: string;
  reason: string;
  sourceFiles: string[];
  fields: CodeDetectionField[];
  isMostlyEmpty: boolean;
}

// ===========================================================================
// Adapter display-name helper
// ===========================================================================

/**
 * Explicit map for the 18 known `_addedBy` adapter values
 * (per shaping notes §2.1). Irregular labels (jQuery, NestJS, Oat++,
 * wxWidgets, ASP.NET, AngularJS, React (axios/fetch)) are baked in here
 * so we never have to guess at casing.
 */
const ADAPTER_DISPLAY_NAMES: Record<string, string> = {
  'spring-boot-adapter': 'Spring Boot Adapter',
  'spring-classic-adapter': 'Spring Classic Adapter',
  'angular-adapter': 'Angular Adapter',
  'angularjs-classic-adapter': 'AngularJS Classic Adapter',
  'react-axios-adapter': 'React (axios/fetch) Adapter',
  'aspnetcore-adapter': 'ASP.NET Core Adapter',
  'aspnet-framework-adapter': 'ASP.NET Framework Adapter',
  'django-adapter': 'Django Adapter',
  'flask-adapter': 'Flask Adapter',
  'jquery-adapter': 'jQuery Adapter',
  'kratos-adapter': 'Kratos Adapter',
  'magento-adapter': 'Magento Adapter',
  'nestjs-adapter': 'NestJS Adapter',
  'oatpp-adapter': 'Oat++ Adapter',
  'rails-adapter': 'Rails Adapter',
  'symfony-adapter': 'Symfony Adapter',
  'wordpress-adapter': 'WordPress Adapter',
  'wxwidgets-adapter': 'wxWidgets Adapter',
};

/**
 * Normalise an adapter `_addedBy` tag into a display label.
 *
 * - Known values use the explicit map above.
 * - Unknown values are derived: strip a trailing `-adapter` segment,
 *   split on `-`, title-case each segment, join with spaces, append
 *   ` Adapter` (so `some-new-adapter` -> `Some New Adapter`).
 * - Null / undefined / empty-string returns `"deterministic code analysis"`
 *   (preserves Spec 1's adapter-less wording).
 */
export function formatAdapterDisplayName(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    return 'deterministic code analysis';
  }
  const known = ADAPTER_DISPLAY_NAMES[value];
  if (known) {
    return known;
  }
  // Unknown-value derivation
  const stripped = value.endsWith('-adapter') ? value.slice(0, -'-adapter'.length) : value;
  const segments = stripped.split('-').filter((s) => s.length > 0);
  if (segments.length === 0) {
    return 'Adapter';
  }
  const titled = segments.map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase());
  return `${titled.join(' ')} Adapter`;
}

// ===========================================================================
// Internal helpers — type-narrowing reads
// ===========================================================================

function readString(data: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!data) return undefined;
  const v = data[key];
  if (typeof v === 'string' && v.length > 0) return v;
  return undefined;
}

function readNestedString(
  data: Record<string, unknown> | undefined,
  parentKey: string,
  childKey: string
): string | undefined {
  if (!data) return undefined;
  const parent = data[parentKey];
  if (parent && typeof parent === 'object' && !Array.isArray(parent)) {
    const v = (parent as Record<string, unknown>)[childKey];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function readArrayOfObjects(
  data: Record<string, unknown> | undefined,
  key: string
): Array<Record<string, unknown>> | undefined {
  if (!data) return undefined;
  const v = data[key];
  if (Array.isArray(v) && v.length > 0) {
    return v.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as Array<
      Record<string, unknown>
    >;
  }
  return undefined;
}

function readBoolean(
  data: Record<string, unknown> | undefined,
  key: string
): boolean | undefined {
  if (!data) return undefined;
  const v = data[key];
  if (typeof v === 'boolean') return v;
  return undefined;
}

// ===========================================================================
// Array-of-object formatting helpers
// ===========================================================================

function asString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  return undefined;
}

/**
 * Format `pathVariables` entries (e.g. `[{name: 'ownerId', type: 'int'}]`)
 * into readable strings: `name: type`, or just `name` when type missing.
 * Entries with no usable name are skipped.
 */
export function formatPathVariables(items: Array<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const item of items) {
    const name = asString(item['name']);
    if (!name) continue;
    const type = asString(item['type']);
    out.push(type ? `${name}: ${type}` : name);
  }
  return out;
}

/**
 * Format `requestParams` entries
 * (e.g. `[{name, type, required, defaultValue?}]`) into:
 *   `petId: int (required, default=1)`
 * Optional sub-fields are tolerated. Entries with no usable name are skipped.
 */
export function formatRequestParams(items: Array<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const item of items) {
    const name = asString(item['name']);
    if (!name) continue;
    const type = asString(item['type']);
    const base = type ? `${name}: ${type}` : name;
    const annotations: string[] = [];
    if (item['required'] === true) annotations.push('required');
    const defaultValue = asString(item['defaultValue']);
    if (defaultValue !== undefined) annotations.push(`default=${defaultValue}`);
    out.push(annotations.length > 0 ? `${base} (${annotations.join(', ')})` : base);
  }
  return out;
}

/**
 * Format `openApiResponses` entries
 * (e.g. `[{responseCode: '200', description: 'OK', content?}]`) into:
 *   `200: OK`
 * Entries with no usable response code are skipped.
 */
export function formatOpenApiResponses(items: Array<Record<string, unknown>>): string[] {
  const out: string[] = [];
  for (const item of items) {
    const code = asString(item['responseCode']);
    if (!code) continue;
    const description = asString(item['description']);
    out.push(description ? `${code}: ${description}` : code);
  }
  return out;
}

// ===========================================================================
// Source-files helper
// ===========================================================================

const SOURCE_FILES_CAP = 5;

/**
 * Dedup, cap at the first 5 paths, and append `…and N more` as a
 * trailing list element when the original (pre-dedup) list exceeded 5.
 *
 * Per the test fixture in `__tests__/codeDetectionMappers.test.ts`, N is
 * computed from `originalLength - cap` (i.e. it counts the duplicate
 * entries too), so 7 unique paths plus a duplicate (8 total) yields
 * 5 unique entries followed by `…and 3 more`.
 */
function buildSourceFilesList(rawSources: string[] | undefined | null): string[] {
  if (!rawSources || rawSources.length === 0) return [];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of rawSources) {
    if (typeof path !== 'string' || path.length === 0) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    unique.push(path);
  }
  if (rawSources.length <= SOURCE_FILES_CAP) {
    return unique;
  }
  const head = unique.slice(0, SOURCE_FILES_CAP);
  const overflow = rawSources.length - SOURCE_FILES_CAP;
  if (overflow > 0) {
    head.push(`…and ${overflow} more`); // "…and N more"
  }
  return head;
}

// ===========================================================================
// Field-pushing helper
// ===========================================================================

/**
 * Push a field onto the list, dropping `undefined`, `null`, empty-string,
 * and empty-array values silently. This is the gate that guarantees no
 * empty labels ever leak into the renderer.
 */
function pushField(
  fields: CodeDetectionField[],
  label: string,
  value: string | string[] | undefined | null
): void {
  if (value === undefined || value === null) return;
  if (typeof value === 'string') {
    if (value.length === 0) return;
    fields.push({ label, value });
    return;
  }
  // Array
  if (value.length === 0) return;
  fields.push({ label, value });
}

// ===========================================================================
// Per-type builders
// ===========================================================================

const REASON_ENDPOINT_SERVER =
  'Detected as a controller method exposed through framework route annotations.';
const REASON_ENDPOINT_CLIENT =
  'Detected as an HTTP call from frontend code making framework HTTP-client calls.';
const REASON_ENDPOINT_FALLBACK =
  'Detected as an HTTP endpoint from framework route metadata in code.';

const REASON_INTERFACE_BEAN =
  'Detected as a Spring bean definition from a @Configuration class.';
const REASON_INTERFACE_CONTROLLER =
  'Detected as an interface/API surface from framework controller metadata.';

const REASON_LOGICAL_TS =
  'Detected as a logical data shape from TypeScript or JavaScript model/type metadata.';
const REASON_LOGICAL_DEFAULT =
  'Detected as a logical data shape referenced by interface or endpoint code.';

const REASON_INTERFACE_LOGICAL =
  'Detected because interface code references this logical data entity.';

/**
 * Spec 2026-05-29 Task Group 4.2: reason for an `endpoint_data_effects`
 * candidate — the edge is the result of statically walking the
 * controller -> service -> repository -> entity call chain.
 */
const REASON_ENDPOINT_DATA_EFFECT =
  'Detected as a data read/write by statically resolving the controller -> service -> repository -> entity call chain.';

const REASON_DEFAULT = 'Detected from deterministic code analysis.';

/**
 * Build the Code Detection display for an `endpoints` candidate.
 *
 * Server shape (presence of `controllerClassName`):
 *   HTTP method, Path, Controller, Handler method, Request body type,
 *   Response type (responseType > unwrappedReturnType > returnType),
 *   Path variables, Request parameters, Security, OpenAPI operation,
 *   Transactional.
 *
 * Client shape (presence of `url` or `canonicalUrl` plus `apiLibrary`):
 *   HTTP method, URL (canonicalUrl > url), Calling function, API library,
 *   Response type.
 *
 * Otherwise the fallback reason is used and only the universally-safe
 * fields (HTTP method + Path/URL + Response type) are emitted.
 */
export function buildEndpointCodeDetails(candidate: DiscoveryCandidateDto): CodeDetectionDisplay {
  const data = candidate.data ?? {};
  const detectedBy = formatAdapterDisplayName(readString(data, '_addedBy'));
  const sourceFiles = buildSourceFilesList(candidate.source_cluster_ids);
  const fields: CodeDetectionField[] = [];

  const controllerClassName = readString(data, 'controllerClassName');
  const url = readString(data, 'url');
  const canonicalUrl = readString(data, 'canonicalUrl');
  const apiLibrary = readString(data, 'apiLibrary');

  const isServerShape = controllerClassName !== undefined;
  const isClientShape = !isServerShape && (url !== undefined || canonicalUrl !== undefined) && apiLibrary !== undefined;

  let reason: string;
  if (isServerShape) {
    reason = REASON_ENDPOINT_SERVER;
  } else if (isClientShape) {
    reason = REASON_ENDPOINT_CLIENT;
  } else {
    reason = REASON_ENDPOINT_FALLBACK;
  }

  // Common: HTTP method
  pushField(fields, 'HTTP method', readString(data, 'httpMethod'));

  if (isServerShape) {
    pushField(fields, 'Path', readString(data, 'fullPath'));
    pushField(fields, 'Controller', controllerClassName);
    pushField(fields, 'Handler method', readString(data, 'methodName'));
    pushField(fields, 'Request body type', readString(data, 'requestBodyType'));
    const responseType =
      readString(data, 'responseType') ??
      readString(data, 'unwrappedReturnType') ??
      readString(data, 'returnType');
    pushField(fields, 'Response type', responseType);

    const pathVariables = readArrayOfObjects(data, 'pathVariables');
    if (pathVariables) {
      pushField(fields, 'Path variables', formatPathVariables(pathVariables));
    }
    const requestParams = readArrayOfObjects(data, 'requestParams');
    if (requestParams) {
      pushField(fields, 'Request parameters', formatRequestParams(requestParams));
    }

    pushField(fields, 'Security', readNestedString(data, 'security', 'annotation'));

    const openApiOperation =
      readNestedString(data, 'openApiOperation', 'operationId') ??
      readNestedString(data, 'openApiOperation', 'summary');
    pushField(fields, 'OpenAPI operation', openApiOperation);

    // Transactional: prefer propagation; otherwise boolean from declared.
    const transactionalPropagation = readNestedString(data, 'transactional', 'propagation');
    if (transactionalPropagation) {
      pushField(fields, 'Transactional', transactionalPropagation);
    } else {
      const transactional = data['transactional'];
      if (transactional && typeof transactional === 'object' && !Array.isArray(transactional)) {
        const declared = (transactional as Record<string, unknown>)['declared'];
        if (typeof declared === 'boolean') {
          pushField(fields, 'Transactional', String(declared));
        }
      }
    }
  } else if (isClientShape) {
    pushField(fields, 'URL', canonicalUrl ?? url);
    pushField(fields, 'Calling function', readString(data, 'callingFunction'));
    pushField(fields, 'API library', apiLibrary);
    pushField(fields, 'Response type', readString(data, 'responseType'));
  } else {
    // Defensive: fallback (unknown shape) — emit whatever HTTP-ish fields we can find
    pushField(fields, 'URL', canonicalUrl ?? url);
    pushField(fields, 'Response type', readString(data, 'responseType'));
  }

  return {
    detectedBy,
    reason,
    sourceFiles,
    fields,
    isMostlyEmpty: fields.length === 0,
  };
}

/**
 * Build the Code Detection display for an `interfaces` candidate.
 *
 * Discriminates on `data.interfaceSubtype === 'spring-bean-definition'`:
 *
 * Bean shape:
 *   Bean name, Bean return type, Configuration class, Package, Scope,
 *   Primary (only when isPrimary === true), Lazy (only when isLazy === true).
 *
 * Controller shape:
 *   Class, Interface type (controllerType > interfaceSubtype), Base path,
 *   Package, Resource (Rails), OpenAPI tag, Security.
 */
export function buildInterfaceCodeDetails(candidate: DiscoveryCandidateDto): CodeDetectionDisplay {
  const data = candidate.data ?? {};
  const detectedBy = formatAdapterDisplayName(readString(data, '_addedBy'));
  const sourceFiles = buildSourceFilesList(candidate.source_cluster_ids);
  const fields: CodeDetectionField[] = [];

  const isBean = data['interfaceSubtype'] === 'spring-bean-definition';
  let reason: string;

  if (isBean) {
    reason = REASON_INTERFACE_BEAN;
    pushField(fields, 'Bean name', readString(data, 'beanName'));
    pushField(fields, 'Bean return type', readString(data, 'beanReturnType'));
    pushField(fields, 'Configuration class', readString(data, 'configurationClassName'));
    pushField(fields, 'Package', readString(data, 'packageName'));
    pushField(fields, 'Scope', readString(data, 'scope'));
    if (readBoolean(data, 'isPrimary') === true) {
      pushField(fields, 'Primary', 'true');
    }
    if (readBoolean(data, 'isLazy') === true) {
      pushField(fields, 'Lazy', 'true');
    }
  } else {
    reason = REASON_INTERFACE_CONTROLLER;
    pushField(fields, 'Class', readString(data, 'className'));
    pushField(
      fields,
      'Interface type',
      readString(data, 'controllerType') ?? readString(data, 'interfaceSubtype')
    );
    pushField(fields, 'Base path', readString(data, 'basePath'));
    pushField(fields, 'Package', readString(data, 'packageName'));
    pushField(fields, 'Resource', readString(data, 'resource'));
    pushField(fields, 'OpenAPI tag', readNestedString(data, 'openApiTag', 'name'));
    pushField(fields, 'Security', readNestedString(data, 'security', 'annotation'));
  }

  return {
    detectedBy,
    reason,
    sourceFiles,
    fields,
    isMostlyEmpty: fields.length === 0,
  };
}

/**
 * Build the Code Detection display for a `logical_data_entities` candidate.
 *
 * Reason: TS-flavoured when `data.isInterface` is set (angular / reactAxios
 * adapters); otherwise the default cross-language reason.
 *
 * Fields (in order, omit when absent):
 *   Type (className), Package (packageName),
 *   Kind ('interface' only when isInterface === true),
 *   Extends (only when extends non-null/non-empty).
 *
 * Spring-* candidates intentionally produce only Type + Package + source
 * file today — that is the expected output and is NOT a regression.
 */
export function buildLogicalDataEntityCodeDetails(
  candidate: DiscoveryCandidateDto
): CodeDetectionDisplay {
  const data = candidate.data ?? {};
  const detectedBy = formatAdapterDisplayName(readString(data, '_addedBy'));
  const sourceFiles = buildSourceFilesList(candidate.source_cluster_ids);
  const fields: CodeDetectionField[] = [];

  const isInterfaceFlag = readBoolean(data, 'isInterface');
  const reason = isInterfaceFlag !== undefined ? REASON_LOGICAL_TS : REASON_LOGICAL_DEFAULT;

  pushField(fields, 'Type', readString(data, 'className'));
  pushField(fields, 'Package', readString(data, 'packageName'));
  if (isInterfaceFlag === true) {
    pushField(fields, 'Kind', 'interface');
  }
  pushField(fields, 'Extends', readString(data, 'extends'));

  return {
    detectedBy,
    reason,
    sourceFiles,
    fields,
    isMostlyEmpty: fields.length === 0,
  };
}

/**
 * Build the Code Detection display for an `interface_logical_entities`
 * candidate.
 *
 * Reason is always the fallback wording — adapters do not emit a
 * directional role today, so the brief's "Relationship role" /
 * "Supporting method" wording is omitted (per shaping notes §2.5).
 *
 * Fields (in order, omit when absent):
 *   Interface (interfaceClassName), Logical data entity (logicalEntityName).
 */
export function buildInterfaceLogicalEntityCodeDetails(
  candidate: DiscoveryCandidateDto
): CodeDetectionDisplay {
  const data = candidate.data ?? {};
  const detectedBy = formatAdapterDisplayName(readString(data, '_addedBy'));
  const sourceFiles = buildSourceFilesList(candidate.source_cluster_ids);
  const fields: CodeDetectionField[] = [];

  pushField(fields, 'Interface', readString(data, 'interfaceClassName'));
  pushField(fields, 'Logical data entity', readString(data, 'logicalEntityName'));

  return {
    detectedBy,
    reason: REASON_INTERFACE_LOGICAL,
    sourceFiles,
    fields,
    isMostlyEmpty: fields.length === 0,
  };
}

/**
 * Build the Code Detection display for an `endpoint_data_effects` candidate.
 *
 * Spec 2026-05-29 Task Group 4.2/4.3.
 *
 * The candidate `data` is shaped by the discovery-service Spring Classic
 * adapter (`endpointDataEffectCandidates.ts`). This mapper curates the
 * SUMMARY fields that make the edge legible at a glance:
 *   Endpoint (endpointName), Data entity (dataEntityName),
 *   Access mode (access_mode), Operation hint (operation_hint),
 *   Transactional (transactional → 'true'/'false'), Controller
 *   (controllerClassName), Handler method (endpointMethodName).
 *
 * The structured controller -> service -> repository hop list itself is
 * intentionally NOT flattened here — it renders as a dedicated read-only,
 * expandable block in `CandidateDetailsPanel` (Task Group 4.3) sourced
 * from `buildEndpointDataEffectPathHops`. Keeping the hop walk out of the
 * flat Code Detection fields avoids a wall of method ids in the column
 * and matches the "no graph visualization / read-only expandable
 * metadata" UI contract.
 */
export function buildEndpointDataEffectCodeDetails(
  candidate: DiscoveryCandidateDto
): CodeDetectionDisplay {
  const data = candidate.data ?? {};
  const detectedBy = formatAdapterDisplayName(readString(data, '_addedBy'));
  const sourceFiles = buildSourceFilesList(candidate.source_cluster_ids);
  const fields: CodeDetectionField[] = [];

  pushField(fields, 'Endpoint', readString(data, 'endpointName'));
  pushField(fields, 'Data entity', readString(data, 'dataEntityName'));
  pushField(fields, 'Access mode', readString(data, 'access_mode'));
  pushField(fields, 'Operation hint', readString(data, 'operation_hint'));
  const transactional = readBoolean(data, 'transactional');
  if (transactional !== undefined) {
    pushField(fields, 'Transactional', String(transactional));
  }
  pushField(fields, 'Controller', readString(data, 'controllerClassName'));
  pushField(fields, 'Handler method', readString(data, 'endpointMethodName'));

  return {
    detectedBy,
    reason: REASON_ENDPOINT_DATA_EFFECT,
    sourceFiles,
    fields,
    isMostlyEmpty: fields.length === 0,
  };
}

// ===========================================================================
// Endpoint->data-effect path-hop extraction (Task Group 4.3)
// ===========================================================================

/**
 * One read-only hop in the controller -> service -> repository path of an
 * `endpoint_data_effects` candidate, normalized for display.
 *
 * - `methodId` is the stable method identifier (FQN + signature, e.g.
 *   `com.foo.OwnerService#save(Owner)`) stamped by discovery-service
 *   (Task Group 3.6). It is the headline, monospace-friendly line.
 * - `className` / `methodName` are the split convenience fields.
 * - `role` is `controller` | `service` | `repository` (or whatever the
 *   adapter emitted — passed through as a string so future roles render
 *   without a frontend change).
 */
export interface EndpointDataEffectPathHopDisplay {
  methodId: string;
  className?: string;
  methodName?: string;
  role?: string;
}

/**
 * Extract the ordered, read-only path hops from an `endpoint_data_effects`
 * candidate's `data.path_metadata_json`.
 *
 * The structured shape is exactly what `endpointDataEffectCandidates.ts`
 * persists into the AMS `path_metadata_json` column:
 *   { hops: [{ method_id, class_name, method_name, role }, ...],
 *     operation_hint, transactional }
 *
 * Tolerant of a missing / malformed `path_metadata_json` (returns `[]`) so
 * the expandable block simply does not render. Each returned hop is keyed
 * by its `method_id` (FQN + signature); hops without a usable `method_id`
 * are skipped so we never render an empty line.
 */
export function buildEndpointDataEffectPathHops(
  candidate: DiscoveryCandidateDto
): EndpointDataEffectPathHopDisplay[] {
  const data = candidate.data ?? {};
  const meta = data['path_metadata_json'];
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return [];
  const hopsRaw = (meta as Record<string, unknown>)['hops'];
  if (!Array.isArray(hopsRaw)) return [];

  const out: EndpointDataEffectPathHopDisplay[] = [];
  for (const raw of hopsRaw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const hop = raw as Record<string, unknown>;
    const methodId = asString(hop['method_id']);
    if (!methodId) continue;
    out.push({
      methodId,
      className: asString(hop['class_name']),
      methodName: asString(hop['method_name']),
      role: asString(hop['role']),
    });
  }
  return out;
}

/**
 * Read the operation hint from an `endpoint_data_effects` candidate's
 * `path_metadata_json` (falls back to the top-level `operation_hint` field
 * the adapter also stamps). Returns `undefined` when absent.
 */
export function readEndpointDataEffectOperationHint(
  candidate: DiscoveryCandidateDto
): string | undefined {
  const data = candidate.data ?? {};
  const meta = data['path_metadata_json'];
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const hint = asString((meta as Record<string, unknown>)['operation_hint']);
    if (hint) return hint;
  }
  return readString(data, 'operation_hint');
}

/**
 * Read the `transactional` flag from an `endpoint_data_effects` candidate's
 * `path_metadata_json` (falls back to the top-level `transactional` field).
 * Returns `undefined` when neither is a boolean.
 */
export function readEndpointDataEffectTransactional(
  candidate: DiscoveryCandidateDto
): boolean | undefined {
  const data = candidate.data ?? {};
  const meta = data['path_metadata_json'];
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const v = (meta as Record<string, unknown>)['transactional'];
    if (typeof v === 'boolean') return v;
  }
  return readBoolean(data, 'transactional');
}

// ===========================================================================
// Business-logic behaviour-block extraction (Gap C, Task Group 3.3/3.4)
// ===========================================================================

/**
 * Loose snake_case typing for the structured 7-part behaviour block carried
 * on a `business_logics` candidate's `data.behavior`.
 *
 * Spec 2026-05-29 (Business-logic behaviour capture — Gap C). The block is a
 * LOOSE JSONB blob (mirrors Spec 1's `path_metadata_json` precedent): every
 * sub-field is optional, prose is free text (string), and unknown / extra
 * keys are tolerated. Field names are snake_case to match the AMS wire
 * (the column carries NO `@CamelCaseWire`) and the discovery-service writer.
 *
 * The seven parts:
 *   1. `io`             — input names/types/meaning + output type/meaning.
 *   2. `validation`     — checks + error/exception -> HTTP status / SOAP fault.
 *   3. `transformation` — formulas, field mappings, aggregations, branches,
 *                         sort/order, defaulting (structured pseudo-logic + prose).
 *   4. `data_effects`   — method-level data touches (Spec 1's edges are LINKED
 *                         live at render/consume time, NOT embedded here).
 *   5. `side_effects`   — external calls, events, audit, idempotency.
 *   6. `edge_cases`     — null/empty/boundary per branch.
 *   7. provenance + confidence — `provenance` (source method id FQN+signature)
 *                         and a `confidence` score (0..1 boxed Double on AMS).
 *
 * Internal bookkeeping: `schema_version` (loose-JSONB version stamp) and
 * `source_hash` (re-run skip key) live INSIDE the block.
 */
export interface DiscoveryBehaviourBlock {
  schema_version?: string | number;
  source_hash?: string;
  io?: unknown;
  validation?: unknown;
  transformation?: unknown;
  data_effects?: unknown;
  side_effects?: unknown;
  edge_cases?: unknown;
  provenance?: unknown;
  confidence?: number | null;
  [key: string]: unknown;
}

/**
 * One render-ready section of the 7-part behaviour block. `key` is the stable
 * snake_case field key (also used as the per-section `data-testid` suffix in
 * the UI); `label` is the human-readable heading; `lines` is the prose /
 * structured content flattened to display strings (already non-empty —
 * sections with no usable content are dropped by the reader).
 */
export interface BehaviourBlockSection {
  key: string;
  label: string;
  lines: string[];
}

/**
 * The normalized, render-ready behaviour block consumed by the read-only
 * `BehaviourBlock` component in `CandidateDetailsPanel`.
 *
 * - `sections` is the ordered list of the (present) seven parts, each
 *   flattened to display strings. Parts with no usable content are omitted
 *   so the UI never renders an empty section heading.
 * - `confidence` is the block-level confidence score (0..1) when present,
 *   else `undefined` (the embedded boxed `Double` may be null).
 * - `provenanceMethodId` is the source method id (FQN + signature) when the
 *   provenance part carries one, surfaced as the block's headline line.
 */
export interface BehaviourBlockDisplay {
  sections: BehaviourBlockSection[];
  confidence?: number;
  provenanceMethodId?: string;
}

/**
 * Ordered definition of the 7 parts: snake_case key + human-readable label.
 * Drives both the section order and the per-section `data-testid` suffixes.
 */
const BEHAVIOUR_SECTION_DEFS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'io', label: 'Inputs / outputs' },
  { key: 'validation', label: 'Validation / preconditions' },
  { key: 'transformation', label: 'Transformation / computation' },
  { key: 'data_effects', label: 'Data effects' },
  { key: 'side_effects', label: 'Side effects' },
  { key: 'edge_cases', label: 'Edge cases' },
  { key: 'provenance', label: 'Provenance' },
];

/**
 * Flatten an arbitrary loose JSONB sub-value into display strings.
 *
 * - A non-empty string -> one line.
 * - A number / boolean -> its string form.
 * - An array -> each element flattened (depth-1 recursion), skipping empties.
 * - An object -> `key: value` lines for each scalar-ish entry, recursing into
 *   nested arrays/objects with the key as a prefix. Keeps output bounded and
 *   never throws on an unexpected shape.
 *
 * Returns `[]` for null/undefined/empty so the caller can drop empty sections.
 */
function flattenBehaviourValue(value: unknown, depth = 0): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') {
    return value.length > 0 ? [value] : [];
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  // Bound recursion defensively (loose blob — never trust the depth).
  if (depth > 4) return [];
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) {
      out.push(...flattenBehaviourValue(item, depth + 1));
    }
    return out;
  }
  if (typeof value === 'object') {
    const out: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'string') {
        if (v.length > 0) out.push(`${k}: ${v}`);
      } else if (typeof v === 'number' || typeof v === 'boolean') {
        out.push(`${k}: ${String(v)}`);
      } else {
        const nested = flattenBehaviourValue(v, depth + 1);
        for (const line of nested) out.push(`${k}: ${line}`);
      }
    }
    return out;
  }
  return [];
}

/**
 * Read the loose behaviour block off a candidate's `data.behavior`.
 *
 * Tolerant of a missing / malformed `behavior` (returns `undefined`) so the
 * read-only block simply does not render — same idiom as
 * `buildEndpointDataEffectPathHops` returning `[]`. Never throws.
 */
function readBehaviourBlockRaw(
  candidate: DiscoveryCandidateDto
): DiscoveryBehaviourBlock | undefined {
  const data = candidate.data ?? {};
  const raw = data['behavior'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  return raw as DiscoveryBehaviourBlock;
}

/**
 * Extract a numeric confidence (0..1) from the behaviour block.
 *
 * The score may live at the block's top-level `confidence` OR nested inside
 * the `provenance` part (`provenance.confidence`) — the discovery writer is
 * free to place it either way as the loose shape evolves. Returns `undefined`
 * when neither carries a finite number.
 */
function readBehaviourConfidence(block: DiscoveryBehaviourBlock): number | undefined {
  const top = block['confidence'];
  if (typeof top === 'number' && Number.isFinite(top)) return top;
  const provenance = block['provenance'];
  if (provenance && typeof provenance === 'object' && !Array.isArray(provenance)) {
    const nested = (provenance as Record<string, unknown>)['confidence'];
    if (typeof nested === 'number' && Number.isFinite(nested)) return nested;
  }
  return undefined;
}

/**
 * Read the source method id (FQN + signature) from the block's `provenance`
 * part. Tolerates either a bare string provenance or an object carrying a
 * `method_id` / `source_method_id` key. Returns `undefined` when absent.
 */
function readBehaviourProvenanceMethodId(
  block: DiscoveryBehaviourBlock
): string | undefined {
  const provenance = block['provenance'];
  if (typeof provenance === 'string' && provenance.length > 0) return provenance;
  if (provenance && typeof provenance === 'object' && !Array.isArray(provenance)) {
    const p = provenance as Record<string, unknown>;
    return (
      asString(p['method_id']) ??
      asString(p['source_method_id']) ??
      asString(p['methodId'])
    );
  }
  return undefined;
}

/**
 * Build the normalized, render-ready 7-part behaviour block from a
 * `business_logics` candidate's `data.behavior`.
 *
 * Spec 2026-05-29 (Gap C) Task Group 3.4. The pure reader for the read-only
 * expandable `BehaviourBlock` component:
 *
 * - Returns `undefined` when there is no usable structured block (missing /
 *   malformed `behavior`, or every part empty) so the UI renders nothing —
 *   the malformed-tolerant contract (never throws).
 * - Each of the seven parts is flattened to display strings; parts with no
 *   usable content are dropped (no empty section headings).
 * - For the `provenance` part, the source method id (when present) is hoisted
 *   to `provenanceMethodId` AND retained as the section's leading line, and a
 *   nested `confidence` is NOT rendered as prose (it surfaces via the badge).
 * - The block-level (or provenance-nested) confidence surfaces separately as
 *   `confidence` for the confidence badge.
 */
export function buildBehaviourBlock(
  candidate: DiscoveryCandidateDto
): BehaviourBlockDisplay | undefined {
  const block = readBehaviourBlockRaw(candidate);
  if (!block) return undefined;

  const confidence = readBehaviourConfidence(block);
  const provenanceMethodId = readBehaviourProvenanceMethodId(block);

  const sections: BehaviourBlockSection[] = [];
  for (const def of BEHAVIOUR_SECTION_DEFS) {
    if (def.key === 'provenance') {
      // Provenance renders the method id (when present) plus any other prose
      // sub-fields, but never the bare confidence number (that is the badge).
      const lines: string[] = [];
      if (provenanceMethodId) {
        lines.push(provenanceMethodId);
      }
      const provenance = block['provenance'];
      if (provenance && typeof provenance === 'object' && !Array.isArray(provenance)) {
        const p = { ...(provenance as Record<string, unknown>) };
        delete p['confidence'];
        delete p['method_id'];
        delete p['source_method_id'];
        delete p['methodId'];
        lines.push(...flattenBehaviourValue(p));
      }
      if (lines.length > 0) {
        sections.push({ key: def.key, label: def.label, lines });
      }
      continue;
    }
    const lines = flattenBehaviourValue(block[def.key]);
    if (lines.length > 0) {
      sections.push({ key: def.key, label: def.label, lines });
    }
  }

  // No usable parts AND no confidence/provenance headline -> nothing to show.
  if (sections.length === 0 && confidence === undefined && !provenanceMethodId) {
    return undefined;
  }

  return { sections, confidence, provenanceMethodId };
}

// ===========================================================================
// Dispatcher
// ===========================================================================

/**
 * Build the full Code Detection display for a candidate.
 *
 * Switches on `candidate.candidate_type`. The default branch returns a
 * defensive generic display: in practice it is never reached because
 * `supportsDetails()` gates expansion to the allowlisted types.
 */
export function buildCodeDetectionDetails(
  candidate: DiscoveryCandidateDto
): CodeDetectionDisplay {
  switch (candidate.candidate_type) {
    case 'endpoints':
      return buildEndpointCodeDetails(candidate);
    case 'interfaces':
      return buildInterfaceCodeDetails(candidate);
    case 'logical_data_entities':
      return buildLogicalDataEntityCodeDetails(candidate);
    case 'interface_logical_entities':
      return buildInterfaceLogicalEntityCodeDetails(candidate);
    case 'endpoint_data_effects':
      return buildEndpointDataEffectCodeDetails(candidate);
    default: {
      const data = candidate.data ?? {};
      return {
        detectedBy: formatAdapterDisplayName(readString(data, '_addedBy')),
        reason: REASON_DEFAULT,
        sourceFiles: buildSourceFilesList(candidate.source_cluster_ids),
        fields: [],
        isMostlyEmpty: true,
      };
    }
  }
}
