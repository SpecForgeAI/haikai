/**
 * Gap Computation Service for OAS Generation
 *
 * Analyzes InterfaceOasContextDto and produces a deterministic GapReport
 * containing gaps, defaults, type mappings, and operationId suggestions.
 *
 * This is a pure, stateless service - given the same input, it always produces
 * the same output.
 */

import type {
  InterfaceOasContextDto,
  InterfaceEndpointDto,
  LogicalEntitySchemaDto,
  GapItem,
  GapReport,
  DefaultAssumption,
  TypeMapping,
} from '../types';
import { mapLogicalTypeToOas } from './logicalTypeToOas';
import { generateOperationIdsWithCollisionHandling } from './operationId';

// ============================================================================
// Constants
// ============================================================================

/**
 * HTTP verbs that typically require a request body
 */
const WRITE_VERBS = ['POST', 'PUT', 'PATCH'];

/**
 * Regex pattern to extract path parameters from a path
 * Matches {paramName} patterns
 */
const PATH_PARAM_REGEX = /\{([^}]+)\}/g;

// ============================================================================
// Gap Computation Functions
// ============================================================================

/**
 * Computes interface-level and endpoint-level gaps from the context.
 *
 * Always emits:
 * - SERVER_URL_MISSING (BLOCKING)
 * - SECURITY_NOT_SPECIFIED (RECOMMENDED)
 * - INFO_VERSION_DEFAULTED (INFO)
 *
 * Per endpoint emits:
 * - RESPONSES_UNDEFINED (BLOCKING) - for endpoints with verb AND path
 * - REQUEST_BODY_UNDEFINED (BLOCKING) - for POST/PUT/PATCH
 * - PATH_PARAMS_NEED_SCHEMA (RECOMMENDED) - for paths with {param}
 * - ENDPOINT_METHOD_MISSING (BLOCKING) - for missing operationVerb
 * - ENDPOINT_PATH_MISSING (BLOCKING) - for missing pathOrAddress
 *
 * @param context - The interface context to analyze
 * @returns Array of gap items
 */
export function computeInterfaceGaps(context: InterfaceOasContextDto): GapItem[] {
  const gaps: GapItem[] = [];
  const interfaceId = context.interface.id;

  // Always emit SERVER_URL_MISSING (BLOCKING)
  gaps.push({
    code: 'SERVER_URL_MISSING',
    severity: 'BLOCKING',
    message: 'No server base URL is specified for this API.',
    location: { interfaceId },
    suggestedQuestions: [
      'What is the base URL for this API?',
      'What environment(s) should be configured (development, staging, production)?',
    ],
  });

  // Always emit SECURITY_NOT_SPECIFIED (RECOMMENDED)
  gaps.push({
    code: 'SECURITY_NOT_SPECIFIED',
    severity: 'RECOMMENDED',
    message: 'No authentication/security scheme is specified.',
    location: { interfaceId },
    suggestedQuestions: [
      'What authentication method does this API use (API key, OAuth2, JWT, Basic Auth)?',
      'Are there endpoints that should be publicly accessible without authentication?',
    ],
  });

  // Always emit INFO_VERSION_DEFAULTED (INFO)
  gaps.push({
    code: 'INFO_VERSION_DEFAULTED',
    severity: 'INFO',
    message: 'Interface has no explicit version; a default will be used.',
    location: { interfaceId },
    suggestedQuestions: [
      'What is the current version of this API?',
    ],
  });

  // Process each endpoint
  for (const endpoint of context.endpoints) {
    const hasVerb = endpoint.operationVerb != null && endpoint.operationVerb.trim() !== '';
    const hasPath = endpoint.pathOrAddress != null && endpoint.pathOrAddress.trim() !== '';

    // Check for missing method
    if (!hasVerb) {
      gaps.push({
        code: 'ENDPOINT_METHOD_MISSING',
        severity: 'BLOCKING',
        message: 'HTTP method is not specified for this endpoint.',
        location: {
          interfaceId,
          endpointId: endpoint.id,
          path: endpoint.pathOrAddress || undefined,
        },
        suggestedQuestions: [
          'What HTTP method should this endpoint use (GET, POST, PUT, PATCH, DELETE)?',
        ],
      });
    }

    // Check for missing path
    if (!hasPath) {
      gaps.push({
        code: 'ENDPOINT_PATH_MISSING',
        severity: 'BLOCKING',
        message: 'Path/address is not specified for this endpoint.',
        location: {
          interfaceId,
          endpointId: endpoint.id,
          method: endpoint.operationVerb || undefined,
        },
        suggestedQuestions: [
          'What is the URL path for this endpoint?',
        ],
      });
    }

    // Only emit RESPONSES_UNDEFINED if both verb and path are present
    if (hasVerb && hasPath) {
      gaps.push({
        code: 'RESPONSES_UNDEFINED',
        severity: 'BLOCKING',
        message: 'Response status codes and response schema are not specified.',
        location: {
          interfaceId,
          endpointId: endpoint.id,
          method: endpoint.operationVerb!,
          path: endpoint.pathOrAddress!,
        },
        suggestedQuestions: [
          'What response status codes should this endpoint return?',
          'What is the structure of the response body?',
        ],
      });

      // Check for REQUEST_BODY_UNDEFINED on write operations
      const verb = endpoint.operationVerb!.toUpperCase();
      if (WRITE_VERBS.includes(verb)) {
        gaps.push({
          code: 'REQUEST_BODY_UNDEFINED',
          severity: 'BLOCKING',
          message: 'Request body schema is not specified for a write operation.',
          location: {
            interfaceId,
            endpointId: endpoint.id,
            method: endpoint.operationVerb!,
            path: endpoint.pathOrAddress!,
          },
          suggestedQuestions: [
            'What is the structure of the request body?',
            'Which fields are required vs optional?',
          ],
        });
      }

      // Check for PATH_PARAMS_NEED_SCHEMA
      const pathParams = extractPathParams(endpoint.pathOrAddress!);
      if (pathParams.length > 0) {
        gaps.push({
          code: 'PATH_PARAMS_NEED_SCHEMA',
          severity: 'RECOMMENDED',
          message: 'Path parameters are present but types/formats are not specified.',
          location: {
            interfaceId,
            endpointId: endpoint.id,
            method: endpoint.operationVerb!,
            path: endpoint.pathOrAddress!,
          },
          data: {
            params: pathParams,
          },
          suggestedQuestions: pathParams.map(
            param => `What is the type and format of the '${param}' path parameter?`
          ),
        });
      }
    }
  }

  return gaps;
}

/**
 * Extracts path parameter names from a path string.
 *
 * @param path - The URL path (e.g., '/users/{id}/orders/{orderId}')
 * @returns Array of parameter names (e.g., ['id', 'orderId'])
 */
function extractPathParams(path: string): string[] {
  const params: string[] = [];
  let match;

  // Reset regex state and find all matches
  PATH_PARAM_REGEX.lastIndex = 0;
  while ((match = PATH_PARAM_REGEX.exec(path)) !== null) {
    params.push(match[1]);
  }

  return params;
}

/**
 * Computes default assumptions that will be applied during OAS generation.
 *
 * Always includes:
 * - DEFAULT_INFO_VERSION = "1.0.0"
 * - SUGGESTED_SUCCESS_STATUS_BY_VERB
 *
 * Conditionally includes:
 * - DEFAULT_MEDIA_TYPE = "application/json" (if REST_API or any endpoint is HTTP_REST)
 *
 * @param context - The interface context to analyze
 * @returns Array of default assumptions
 */
export function computeDefaults(context: InterfaceOasContextDto): DefaultAssumption[] {
  const defaults: DefaultAssumption[] = [];

  // Always include DEFAULT_INFO_VERSION
  defaults.push({
    code: 'DEFAULT_INFO_VERSION',
    value: '1.0.0',
    rationale: 'OpenAPI requires info.version; interface does not provide one.',
  });

  // Check if we should include DEFAULT_MEDIA_TYPE
  const isRestApi = context.interface.interfaceType === 'REST_API';
  const hasHttpRestEndpoint = context.endpoints.some(
    ep => ep.endpointType === 'HTTP_REST' || ep.protocol === 'HTTP' || ep.protocol === 'HTTPS'
  );

  if (isRestApi || hasHttpRestEndpoint) {
    defaults.push({
      code: 'DEFAULT_MEDIA_TYPE',
      value: 'application/json',
      rationale: 'Assume JSON for REST/HTTP endpoints unless specified otherwise.',
    });
  }

  // Always include SUGGESTED_SUCCESS_STATUS_BY_VERB
  defaults.push({
    code: 'SUGGESTED_SUCCESS_STATUS_BY_VERB',
    value: {
      GET: 200,
      POST: 201,
      PUT: 200,
      PATCH: 200,
      DELETE: 204,
    },
    rationale: 'Common REST conventions; confirm per endpoint.',
  });

  return defaults;
}

/**
 * Result of type mapping computation
 */
export interface TypeMappingResult {
  /** Type mappings from logical types to OAS schemas */
  mappings: TypeMapping[];
  /** Gap items for unknown types */
  unknownTypeGaps: GapItem[];
}

/**
 * Computes type mappings for all logical types found in the interface.
 *
 * Extracts unique logical types from all attributes in all logical entities,
 * maps each to an OAS schema, and emits UNKNOWN_LOGICAL_TYPE_MAPPING gaps
 * for any types not in the mapping dictionary.
 *
 * @param context - The interface context to analyze
 * @returns Object containing mappings and unknown type gaps
 */
export function computeTypeMappings(context: InterfaceOasContextDto): TypeMappingResult {
  const mappings: TypeMapping[] = [];
  const unknownTypeGaps: GapItem[] = [];
  const interfaceId = context.interface.id;

  // Collect all unique logical types from attributes
  const uniqueTypes = new Set<string>();

  for (const entity of context.logicalEntities) {
    for (const attribute of entity.attributes) {
      if (attribute.dataType != null && attribute.dataType.trim() !== '') {
        uniqueTypes.add(attribute.dataType);
      }
    }
  }

  // Convert Set to sorted array for deterministic output
  const sortedTypes = Array.from(uniqueTypes).sort();

  // Map each type
  for (const logicalType of sortedTypes) {
    const result = mapLogicalTypeToOas(logicalType);

    mappings.push({
      logicalType,
      oasSchema: result.schema,
    });

    if (result.isUnknown) {
      unknownTypeGaps.push({
        code: 'UNKNOWN_LOGICAL_TYPE_MAPPING',
        severity: 'RECOMMENDED',
        message: `Logical type '${logicalType}' has no explicit mapping; defaulting to string.`,
        location: { interfaceId },
        data: {
          logicalType,
          defaultSchema: result.schema,
        },
        suggestedQuestions: [
          `What is the OpenAPI schema type for '${logicalType}'?`,
        ],
      });
    }
  }

  return { mappings, unknownTypeGaps };
}

/**
 * Main gap computation function that orchestrates all analysis.
 *
 * This is the primary entry point for gap computation. It:
 * 1. Computes interface and endpoint gaps
 * 2. Computes default assumptions
 * 3. Computes type mappings
 * 4. Generates operationId suggestions with collision handling
 * 5. Assembles and returns the complete GapReport
 *
 * The computation is deterministic - same input always produces same output.
 *
 * @param context - The interface context to analyze
 * @returns Complete GapReport
 */
export function computeOasGaps(context: InterfaceOasContextDto): GapReport {
  // Compute interface and endpoint gaps
  const interfaceGaps = computeInterfaceGaps(context);

  // Compute default assumptions
  const defaults = computeDefaults(context);

  // Compute type mappings
  const { mappings: typeMappings, unknownTypeGaps } = computeTypeMappings(context);

  // Generate operationId suggestions
  const { suggestions: operationIds, collisions: collisionGaps } =
    generateOperationIdsWithCollisionHandling(context.endpoints);

  // Merge all gaps: interface gaps + type gaps + collision gaps
  const allGaps = [...interfaceGaps, ...unknownTypeGaps, ...collisionGaps];

  // Generate ISO timestamp
  const generatedAt = new Date().toISOString();

  return {
    interfaceId: context.interface.id,
    generatedAt,
    gaps: allGaps,
    defaults,
    typeMappings,
    operationIds,
  };
}
