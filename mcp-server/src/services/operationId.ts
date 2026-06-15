/**
 * OperationId Generation Service
 *
 * Generates operationId suggestions for OpenAPI specifications
 * from endpoint verb and path information.
 *
 * Supports both camelCase and snake_case naming conventions.
 * Handles collision detection and suffix generation for duplicates.
 */

import type { InterfaceEndpointDto, OperationIdSuggestion, GapItem } from '../types';

/**
 * Normalizes an HTTP verb to lowercase.
 * Returns null if the verb is null, undefined, or empty.
 *
 * @param verb - The HTTP verb (e.g., 'GET', 'POST')
 * @returns Lowercase verb or null if invalid
 */
export function normalizeVerb(verb: string | null | undefined): string | null {
  if (verb === null || verb === undefined) {
    return null;
  }
  const trimmed = verb.trim();
  if (trimmed === '') {
    return null;
  }
  return trimmed.toLowerCase();
}

/**
 * Converts a string to PascalCase (first letter uppercase, rest lowercase for each word)
 *
 * @param str - Input string
 * @returns PascalCase version
 */
function toPascalCase(str: string): string {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/**
 * Splits a segment by kebab-case or snake_case delimiters into words
 *
 * @param segment - A path segment like 'user-profiles' or 'user_profiles'
 * @returns Array of words like ['user', 'profiles']
 */
function splitSegmentIntoWords(segment: string): string[] {
  // Split by hyphen or underscore
  return segment.split(/[-_]/).filter(word => word.length > 0);
}

/**
 * Parses a path segment and returns the word representation.
 * Handles:
 * - Path parameters like {id} -> ['By', 'Id'] for camelCase or ['by', 'id'] for snake_case
 * - Kebab-case segments like 'user-profiles' -> ['user', 'profiles']
 * - Snake_case segments like 'user_profiles' -> ['user', 'profiles']
 * - Regular segments like 'users' -> ['users']
 *
 * @param segment - A single path segment
 * @param style - The naming style to use
 * @returns Array of words extracted from the segment
 */
function parseSegment(segment: string, style: 'camelCase' | 'snake_case'): string[] {
  if (!segment) return [];

  // Check if it's a path parameter like {id} or {userId}
  const paramMatch = segment.match(/^\{(.+)\}$/);
  if (paramMatch) {
    const paramName = paramMatch[1];
    const words = splitSegmentIntoWords(paramName);
    if (style === 'camelCase') {
      // For camelCase: {userId} -> ['By', 'UserId']
      return ['By', ...words.map(w => toPascalCase(w))];
    } else {
      // For snake_case: {userId} -> ['by', 'user', 'id']
      return ['by', ...words.map(w => w.toLowerCase())];
    }
  }

  // Regular segment - split by kebab-case or snake_case
  return splitSegmentIntoWords(segment);
}

/**
 * Parses path segments from a URL path.
 * Splits by '/', ignores empty segments, and converts each segment to words.
 *
 * @param path - The URL path (e.g., '/api/v1/users/{id}/orders')
 * @param style - The naming style to use
 * @returns Array of words extracted from all segments
 */
export function parsePathSegments(path: string, style: 'camelCase' | 'snake_case'): string[] {
  if (!path) return [];

  // Split by '/' and filter out empty segments
  const segments = path.split('/').filter(s => s.length > 0);

  // Parse each segment and flatten the results
  const allWords: string[] = [];
  for (const segment of segments) {
    const words = parseSegment(segment, style);
    allWords.push(...words);
  }

  return allWords;
}

/**
 * Generates an operationId from an HTTP verb and path.
 *
 * @param verb - The HTTP verb (e.g., 'GET', 'POST')
 * @param path - The URL path (e.g., '/users/{id}')
 * @param style - The naming style: 'camelCase' or 'snake_case'
 * @returns The generated operationId
 *
 * @example
 * generateOperationId('GET', '/resources', 'camelCase') // 'getResources'
 * generateOperationId('GET', '/resources', 'snake_case') // 'get_resources'
 * generateOperationId('GET', '/resources/{id}', 'camelCase') // 'getResourcesById'
 * generateOperationId('GET', '/resources/{id}', 'snake_case') // 'get_resources_by_id'
 */
export function generateOperationId(
  verb: string,
  path: string,
  style: 'camelCase' | 'snake_case'
): string {
  const normalizedVerb = normalizeVerb(verb);
  if (!normalizedVerb) {
    // If verb is invalid, we cannot generate an operationId
    // Return empty string - caller should handle this case
    return '';
  }

  const words = parsePathSegments(path, style);

  if (style === 'camelCase') {
    // camelCase: verb + PascalCase(words)
    // e.g., 'get' + 'Resources' + 'By' + 'Id' = 'getResourcesById'
    const pascalWords = words.map(w => toPascalCase(w)).join('');
    return normalizedVerb + pascalWords;
  } else {
    // snake_case: verb + '_' + words joined by '_'
    // e.g., 'get' + '_' + 'resources' + '_' + 'by' + '_' + 'id' = 'get_resources_by_id'
    const snakeWords = words.map(w => w.toLowerCase()).join('_');
    if (snakeWords) {
      return normalizedVerb + '_' + snakeWords;
    }
    return normalizedVerb;
  }
}

/**
 * Result of operationId generation with collision handling
 */
export interface OperationIdGenerationResult {
  /** Suggested operationIds for all endpoints */
  suggestions: OperationIdSuggestion[];
  /** Gap items for any collisions detected */
  collisions: GapItem[];
}

/**
 * Generates operationId suggestions for all endpoints with collision handling.
 *
 * For each endpoint with both operationVerb and pathOrAddress:
 * - Generates both camelCase and snake_case operationIds
 * - Detects collisions within the same style
 * - Adds suffixes to resolve collisions (2, 3, etc. for camelCase; _2, _3, etc. for snake_case)
 * - Emits OPERATION_ID_COLLISION gap items when collisions occur
 *
 * @param endpoints - Array of endpoint DTOs
 * @returns Object containing suggestions array and collisions array
 */
export function generateOperationIdsWithCollisionHandling(
  endpoints: InterfaceEndpointDto[]
): OperationIdGenerationResult {
  const suggestions: OperationIdSuggestion[] = [];
  const collisions: GapItem[] = [];

  // Track used operationIds per style
  const usedCamelCase = new Map<string, number>();
  const usedSnakeCase = new Map<string, number>();

  // First pass: collect all base operationIds to identify potential collisions
  interface PendingSuggestion {
    endpoint: InterfaceEndpointDto;
    baseCamelCase: string;
    baseSnakeCase: string;
  }

  const pendingSuggestions: PendingSuggestion[] = [];

  for (const endpoint of endpoints) {
    const verb = normalizeVerb(endpoint.operationVerb);
    const path = endpoint.pathOrAddress;

    // Skip endpoints without both verb and path
    if (!verb || !path || path.trim() === '') {
      continue;
    }

    const baseCamelCase = generateOperationId(verb, path, 'camelCase');
    const baseSnakeCase = generateOperationId(verb, path, 'snake_case');

    // Skip if generation failed
    if (!baseCamelCase || !baseSnakeCase) {
      continue;
    }

    pendingSuggestions.push({
      endpoint,
      baseCamelCase,
      baseSnakeCase,
    });

    // Count occurrences
    usedCamelCase.set(baseCamelCase, (usedCamelCase.get(baseCamelCase) || 0) + 1);
    usedSnakeCase.set(baseSnakeCase, (usedSnakeCase.get(baseSnakeCase) || 0) + 1);
  }

  // Track collision suffixes
  const camelCaseSuffix = new Map<string, number>();
  const snakeCaseSuffix = new Map<string, number>();

  // Second pass: assign operationIds with suffixes for collisions
  for (const { endpoint, baseCamelCase, baseSnakeCase } of pendingSuggestions) {
    // Handle camelCase
    let finalCamelCase = baseCamelCase;
    const camelCaseCount = usedCamelCase.get(baseCamelCase) || 0;

    if (camelCaseCount > 1) {
      const currentSuffix = (camelCaseSuffix.get(baseCamelCase) || 0) + 1;
      camelCaseSuffix.set(baseCamelCase, currentSuffix);

      if (currentSuffix > 1) {
        // Add suffix: getUsers2, getUsers3, etc.
        finalCamelCase = baseCamelCase + currentSuffix;
      }
      // First occurrence keeps the base name
    }

    // Handle snake_case
    let finalSnakeCase = baseSnakeCase;
    const snakeCaseCount = usedSnakeCase.get(baseSnakeCase) || 0;

    if (snakeCaseCount > 1) {
      const currentSuffix = (snakeCaseSuffix.get(baseSnakeCase) || 0) + 1;
      snakeCaseSuffix.set(baseSnakeCase, currentSuffix);

      if (currentSuffix > 1) {
        // Add suffix: get_users_2, get_users_3, etc.
        finalSnakeCase = baseSnakeCase + '_' + currentSuffix;
      }
      // First occurrence keeps the base name
    }

    // Add suggestions
    suggestions.push({
      endpointId: endpoint.id,
      method: endpoint.operationVerb || undefined,
      path: endpoint.pathOrAddress || undefined,
      style: 'camelCase',
      operationId: finalCamelCase,
    });

    suggestions.push({
      endpointId: endpoint.id,
      method: endpoint.operationVerb || undefined,
      path: endpoint.pathOrAddress || undefined,
      style: 'snake_case',
      operationId: finalSnakeCase,
    });
  }

  // Emit collision gap items for any base operationId that had duplicates
  const reportedCollisions = new Set<string>();

  for (const [operationId, count] of usedCamelCase) {
    if (count > 1 && !reportedCollisions.has(operationId)) {
      reportedCollisions.add(operationId);

      // Find all endpoints that collided
      const collidingEndpoints = pendingSuggestions
        .filter(p => p.baseCamelCase === operationId)
        .map(p => ({
          endpointId: p.endpoint.id,
          method: p.endpoint.operationVerb,
          path: p.endpoint.pathOrAddress,
        }));

      collisions.push({
        code: 'OPERATION_ID_COLLISION',
        severity: 'INFO',
        message: `Multiple operations produced the same operationId '${operationId}'; suffixes were added.`,
        data: {
          baseOperationId: operationId,
          collisionCount: count,
          endpoints: collidingEndpoints,
        },
      });
    }
  }

  return { suggestions, collisions };
}
