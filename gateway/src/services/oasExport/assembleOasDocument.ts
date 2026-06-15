/**
 * Deterministic OpenAPI 3.0 document assembly.
 *
 * Direct build 2026-06-11 (oracle weaknesses #5). Pure function: the same
 * interface context + gap report always produce byte-identical output —
 * no timestamps, no randomness, no LLM. Where the architecture model does
 * not specify something the assembler applies the gap engine's documented
 * defaults and says so in the emitted document, rather than guessing.
 *
 * Coverage guarantee (repo philosophy: enumeration by code): every endpoint
 * in the context is either expressed as a path operation or listed in
 * `x-haikai-unmapped-endpoints` with a reason. A mismatch throws.
 */

import {
  InterfaceOasContext,
  OasAssemblyResult,
  OasAssemblySummary,
  OasGapReport,
  OasInterfaceEndpoint,
  OasLogicalEntity,
  UnmappedEndpoint,
} from './types';

const HTTP_VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const WRITE_VERBS = ['POST', 'PUT', 'PATCH'];
const SUCCESS_STATUS_BY_VERB: Record<string, number> = {
  GET: 200,
  POST: 201,
  PUT: 200,
  PATCH: 200,
  DELETE: 204,
  HEAD: 200,
  OPTIONS: 200,
};

export class OasCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OasCoverageError';
  }
}

// ---------------------------------------------------------------------------
// Naming helpers (all deterministic)
// ---------------------------------------------------------------------------

/** PascalCase schema component name from an entity name. */
function toSchemaName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9]+/g, ' ').trim();
  if (!cleaned) return 'UnnamedEntity';
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

/** Normalised comparison key: lowercase alphanumerics only. */
function normaliseKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Naive singular form for path-segment ↔ entity matching ("users" → "user"). */
function singularise(key: string): string {
  if (key.endsWith('ies') && key.length > 3) return `${key.slice(0, -3)}y`;
  if (key.endsWith('ses') && key.length > 3) return key.slice(0, -2);
  if (key.endsWith('s') && !key.endsWith('ss') && key.length > 1) return key.slice(0, -1);
  return key;
}

export function slugifyFilename(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'interface';
}

function extractPathParams(path: string): string[] {
  const params: string[] = [];
  const regex = /\{([^}]+)\}/g;
  let match;
  while ((match = regex.exec(path)) !== null) params.push(match[1]);
  return params;
}

// ---------------------------------------------------------------------------
// Schema assembly
// ---------------------------------------------------------------------------

interface SchemaIndex {
  /** componentName → schema object, in deterministic (sorted) order. */
  schemas: Record<string, Record<string, unknown>>;
  /** normalised entity-name key → component name (for path matching). */
  byKey: Map<string, string>;
}

function buildSchemas(
  entities: OasLogicalEntity[],
  typeMap: Map<string, Record<string, unknown>>
): SchemaIndex {
  const schemas: Record<string, Record<string, unknown>> = {};
  const byKey = new Map<string, string>();
  const usedNames = new Set<string>();

  const sorted = [...entities].sort((a, b) => a.name.localeCompare(b.name));
  for (const entity of sorted) {
    let componentName = toSchemaName(entity.name);
    let suffix = 2;
    while (usedNames.has(componentName)) {
      componentName = `${toSchemaName(entity.name)}${suffix}`;
      suffix += 1;
    }
    usedNames.add(componentName);

    const properties: Record<string, Record<string, unknown>> = {};
    const required: string[] = [];
    const sortedAttrs = [...entity.attributes].sort((a, b) => a.name.localeCompare(b.name));
    for (const attr of sortedAttrs) {
      const mapped = attr.dataType
        ? typeMap.get(attr.dataType.toLowerCase().trim())
        : undefined;
      const propSchema: Record<string, unknown> = mapped
        ? { ...mapped }
        : { type: 'string' };
      if (attr.description) propSchema.description = attr.description;
      if (attr.isNullable === true) propSchema.nullable = true;
      if (attr.isPrimaryKey === true) propSchema['x-primary-key'] = true;
      properties[attr.name] = propSchema;
      if (attr.isNullable === false) required.push(attr.name);
    }

    const schema: Record<string, unknown> = { type: 'object' };
    if (entity.description) schema.description = entity.description;
    schema.properties = properties;
    if (required.length > 0) schema.required = required.sort();

    schemas[componentName] = schema;
    const key = normaliseKey(entity.name);
    if (key && !byKey.has(key)) byKey.set(key, componentName);
  }

  return { schemas, byKey };
}

/**
 * Deterministic entity match for a path: take the last static (non-`{param}`)
 * segment, normalise, try exact then singularised entity-name match.
 * Returns the component name or null — no fuzzy guessing.
 */
function matchEntityForPath(path: string, index: SchemaIndex): string | null {
  const segments = path.split('/').filter((s) => s.length > 0 && !s.startsWith('{'));
  if (segments.length === 0) return null;
  const last = normaliseKey(segments[segments.length - 1]);
  if (!last) return null;
  return index.byKey.get(last) ?? index.byKey.get(singularise(last)) ?? null;
}

// ---------------------------------------------------------------------------
// Main assembly
// ---------------------------------------------------------------------------

export function assembleOasDocument(
  context: InterfaceOasContext,
  gapReport: OasGapReport
): OasAssemblyResult {
  // Type-mapping dictionary from the gap engine (lowercased keys).
  const typeMap = new Map<string, Record<string, unknown>>();
  for (const tm of gapReport.typeMappings) {
    typeMap.set(tm.logicalType.toLowerCase().trim(), tm.oasSchema);
  }

  // camelCase operationIds from the gap engine, keyed by endpoint id.
  const operationIdByEndpoint = new Map<string, string>();
  for (const suggestion of gapReport.operationIds) {
    if (suggestion.style === 'camelCase') {
      operationIdByEndpoint.set(suggestion.endpointId, suggestion.operationId);
    }
  }

  const infoVersionDefault = gapReport.defaults.find(
    (d) => d.code === 'DEFAULT_INFO_VERSION'
  );
  const version =
    typeof infoVersionDefault?.value === 'string' ? infoVersionDefault.value : '1.0.0';

  const schemaIndex = buildSchemas(context.logicalEntities, typeMap);

  // Servers: model-provided candidates, else an explicit placeholder tied to
  // the SERVER_URL_MISSING gap (never silently invent a real-looking URL).
  const serverCandidates = (context.notes?.serverUrlCandidates ?? []).filter(
    (u) => typeof u === 'string' && u.trim() !== ''
  );
  const servers =
    serverCandidates.length > 0
      ? [...serverCandidates].sort().map((url) => ({ url }))
      : [
          {
            url: 'https://server-url-not-specified.invalid',
            description:
              'Placeholder — no server URL in the architecture model (gap SERVER_URL_MISSING). Replace before use.',
          },
        ];

  // Paths: endpoints sorted by (path, verb) for stable output.
  const paths: Record<string, Record<string, unknown>> = {};
  const unmappedEndpoints: UnmappedEndpoint[] = [];
  let mappedCount = 0;

  const sortedEndpoints = [...context.endpoints].sort((a, b) => {
    const pa = a.pathOrAddress ?? '';
    const pb = b.pathOrAddress ?? '';
    if (pa !== pb) return pa.localeCompare(pb);
    return (a.operationVerb ?? '').localeCompare(b.operationVerb ?? '');
  });

  for (const endpoint of sortedEndpoints) {
    const reason = unmappableReason(endpoint);
    if (reason) {
      unmappedEndpoints.push({ endpointId: endpoint.id, name: endpoint.name, reason });
      continue;
    }

    const verb = endpoint.operationVerb!.trim().toUpperCase();
    const path = normalisePath(endpoint.pathOrAddress!.trim());
    const operation = buildOperation(endpoint, verb, path, context, schemaIndex, operationIdByEndpoint);

    if (!paths[path]) paths[path] = {};
    const verbKey = verb.toLowerCase();
    if (paths[path][verbKey]) {
      // Duplicate (path, verb) rows cannot both exist in one OAS document.
      unmappedEndpoints.push({
        endpointId: endpoint.id,
        name: endpoint.name,
        reason: `Duplicate operation ${verb} ${path} — already emitted for another endpoint.`,
      });
      continue;
    }
    paths[path][verbKey] = operation;
    mappedCount += 1;
  }

  // Coverage assertion: every endpoint accounted for, mapped or unmapped.
  if (mappedCount + unmappedEndpoints.length !== context.endpoints.length) {
    throw new OasCoverageError(
      `OAS assembly coverage mismatch for interface ${context.interface.id}: ` +
        `${context.endpoints.length} endpoints, ${mappedCount} mapped, ` +
        `${unmappedEndpoints.length} unmapped.`
    );
  }

  const descriptionParts: string[] = [];
  if (context.interface.description) descriptionParts.push(context.interface.description);
  const ownerParts: string[] = [];
  if (context.service) ownerParts.push(`service "${context.service.name}"`);
  if (context.application) ownerParts.push(`application "${context.application.name}"`);
  if (ownerParts.length > 0) {
    descriptionParts.push(`Exposed by ${ownerParts.join(' of ')}.`);
  }
  descriptionParts.push(
    'Generated deterministically from the architecture model by Haikai. ' +
      'Unspecified details are marked with explicit gap notes rather than invented.'
  );

  const document: Record<string, unknown> = {
    openapi: '3.0.3',
    info: {
      title: context.interface.name,
      description: descriptionParts.join('\n\n'),
      version,
    },
    servers,
    paths,
  };
  if (Object.keys(schemaIndex.schemas).length > 0) {
    document.components = { schemas: schemaIndex.schemas };
  }
  if (unmappedEndpoints.length > 0) {
    document['x-haikai-unmapped-endpoints'] = unmappedEndpoints;
  }

  const gapCounts = {
    blocking: gapReport.gaps.filter((g) => g.severity === 'BLOCKING').length,
    recommended: gapReport.gaps.filter((g) => g.severity === 'RECOMMENDED').length,
    info: gapReport.gaps.filter((g) => g.severity === 'INFO').length,
  };

  const summary: OasAssemblySummary = {
    endpointCount: context.endpoints.length,
    mappedEndpointCount: mappedCount,
    unmappedEndpoints,
    schemaCount: Object.keys(schemaIndex.schemas).length,
    gapCounts,
  };

  return { document, summary };
}

// ---------------------------------------------------------------------------
// Endpoint → operation
// ---------------------------------------------------------------------------

function unmappableReason(endpoint: OasInterfaceEndpoint): string | null {
  const endpointType = (endpoint.endpointType ?? '').toUpperCase();
  if (endpointType.includes('SOAP')) {
    return 'SOAP endpoint — not expressible in OpenAPI; use the WSDL/WADL contract instead.';
  }
  const verb = (endpoint.operationVerb ?? '').trim().toUpperCase();
  const path = (endpoint.pathOrAddress ?? '').trim();
  if (!verb && !path) return 'No HTTP method or path in the architecture model.';
  if (!verb) return 'No HTTP method in the architecture model (gap ENDPOINT_METHOD_MISSING).';
  if (!path) return 'No path in the architecture model (gap ENDPOINT_PATH_MISSING).';
  if (!HTTP_VERBS.includes(verb)) {
    return `Operation verb "${endpoint.operationVerb}" is not an HTTP method.`;
  }
  return null;
}

/** Ensure a leading slash; strip protocol/host if a full URL was modelled. */
function normalisePath(raw: string): string {
  let path = raw;
  const urlMatch = /^https?:\/\/[^/]+(\/.*)?$/i.exec(raw);
  if (urlMatch) path = urlMatch[1] ?? '/';
  if (!path.startsWith('/')) path = `/${path}`;
  return path;
}

function buildOperation(
  endpoint: OasInterfaceEndpoint,
  verb: string,
  path: string,
  context: InterfaceOasContext,
  schemaIndex: SchemaIndex,
  operationIdByEndpoint: Map<string, string>
): Record<string, unknown> {
  const operation: Record<string, unknown> = {};

  const operationId = operationIdByEndpoint.get(endpoint.id);
  if (operationId) operation.operationId = operationId;
  operation.summary = endpoint.name;
  if (endpoint.description) operation.description = endpoint.description;
  operation.tags = [context.interface.name];

  const pathParams = extractPathParams(path);
  if (pathParams.length > 0) {
    operation.parameters = pathParams.map((param) => ({
      name: param,
      in: 'path',
      required: true,
      schema: { type: 'string' },
      description:
        'Parameter type not specified in the architecture model (gap PATH_PARAMS_NEED_SCHEMA).',
    }));
  }

  const matchedSchema = matchEntityForPath(path, schemaIndex);
  const endsWithParam = /\{[^}]+\}\/?$/.test(path);

  if (WRITE_VERBS.includes(verb)) {
    operation.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: matchedSchema
            ? { $ref: `#/components/schemas/${matchedSchema}` }
            : {
                type: 'object',
                description:
                  'Request body schema not specified in the architecture model (gap REQUEST_BODY_UNDEFINED).',
              },
        },
      },
    };
  }

  const successStatus = SUCCESS_STATUS_BY_VERB[verb] ?? 200;
  const responses: Record<string, unknown> = {};
  if (successStatus === 204) {
    responses['204'] = { description: 'No content.' };
  } else {
    let responseSchema: Record<string, unknown>;
    if (matchedSchema && verb === 'GET' && !endsWithParam) {
      responseSchema = {
        type: 'array',
        items: { $ref: `#/components/schemas/${matchedSchema}` },
      };
    } else if (matchedSchema) {
      responseSchema = { $ref: `#/components/schemas/${matchedSchema}` };
    } else {
      responseSchema = {
        type: 'object',
        description:
          'Response schema not specified in the architecture model (gap RESPONSES_UNDEFINED).',
      };
    }
    responses[String(successStatus)] = {
      description: 'Successful response (status from REST conventions; confirm per endpoint).',
      content: { 'application/json': { schema: responseSchema } },
    };
  }
  responses.default = { description: 'Unexpected error.' };
  operation.responses = responses;

  return operation;
}
