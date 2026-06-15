/**
 * Diagram API Utilities
 *
 * Functions for interacting with the backend diagram API endpoints.
 * Provides typed interfaces for the Advanced Add expansion API.
 */

import { MetaModel, DiagramNode, DiagramEdge } from '../types/model';
import {
  AdvancedAddRequest,
  AdvancedAddResponse,
  SelectionDescriptor,
  NodeDescriptor,
  EdgeDescriptor,
} from '../types/advancedAdd';

// ============================================================================
// API Configuration
// ============================================================================

/**
 * Base URL for the backend API.
 * Uses window location or falls back to localhost for development.
 */
const API_BASE_URL = (typeof window !== 'undefined' && window.location.origin)
  ? `${window.location.origin}/api`
  : 'http://localhost:8080/api';

/**
 * Default fetch options for API requests.
 */
const DEFAULT_FETCH_OPTIONS: RequestInit = {
  headers: {
    'Content-Type': 'application/json',
  },
};

// ============================================================================
// Advanced Add Expansion API
// ============================================================================

/**
 * Request body structure expected by the backend API.
 */
interface AdvancedAddExpansionRequestBody {
  request: AdvancedAddRequest;
  metaModel: {
    entities: MetaModel['entities'];
    relationships: MetaModel['relationships'];
  };
  diagramData: {
    diagram_nodes: DiagramNode[];
    diagram_edges?: DiagramEdge[];
  };
}

/**
 * Calls the backend API to compute the expansion for an Advanced Add operation.
 *
 * This function sends the root entity information, user selections, meta-model,
 * and current diagram state to the backend, which computes what nodes and edges
 * should be added to the diagram.
 *
 * @param rootEntityType - Type of the root entity (e.g., 'APPLICATION')
 * @param rootEntityId - ID of the root entity
 * @param diagramId - ID of the target diagram
 * @param selections - User's relationship selections from the dialog
 * @param metaModel - The meta-model containing entities and relationships
 * @param diagramNodes - Current nodes on the diagram
 * @param diagramEdges - Current edges on the diagram (optional)
 * @returns Promise resolving to the expansion response
 */
export async function advancedAddExpansion(
  rootEntityType: string,
  rootEntityId: string,
  diagramId: string,
  selections: SelectionDescriptor[],
  metaModel: MetaModel,
  diagramNodes: DiagramNode[],
  diagramEdges?: DiagramEdge[]
): Promise<AdvancedAddResponse> {
  const requestBody: AdvancedAddExpansionRequestBody = {
    request: {
      rootEntityType,
      rootEntityId,
      diagramId,
      selections,
    },
    metaModel: {
      entities: metaModel.entities,
      relationships: metaModel.relationships,
    },
    diagramData: {
      diagram_nodes: diagramNodes,
      diagram_edges: diagramEdges || [],
    },
  };

  const response = await fetch(`${API_BASE_URL}/diagram/advanced-add-expansion`, {
    ...DEFAULT_FETCH_OPTIONS,
    method: 'POST',
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(errorData.message || `API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Processes the Advanced Add expansion response and prepares nodes for creation.
 *
 * This function filters out nodes that already exist on the diagram and
 * prepares the remaining nodes for creation using the existing node creation utilities.
 *
 * @param response - The expansion response from the API
 * @returns Object containing new nodes and edges to add
 */
export function processExpansionResponse(response: AdvancedAddResponse): {
  newNodes: NodeDescriptor[];
  newEdges: EdgeDescriptor[];
} {
  const newNodes = response.nodes.filter((node) => !node.alreadyOnDiagram);
  const newEdges = response.edges.filter((edge) => !edge.alreadyOnDiagram);

  return { newNodes, newEdges };
}

/**
 * Checks if the backend API is available.
 *
 * @returns Promise resolving to true if the API is available
 */
export async function checkApiHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * API error class for typed error handling.
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static isBadRequest(error: unknown): error is ApiError {
    return error instanceof ApiError && error.statusCode === 400;
  }

  static isNotFound(error: unknown): error is ApiError {
    return error instanceof ApiError && error.statusCode === 404;
  }

  static isServerError(error: unknown): error is ApiError {
    return error instanceof ApiError && error.statusCode >= 500;
  }
}

// ============================================================================
// Export Types
// ============================================================================

export type {
  AdvancedAddRequest,
  AdvancedAddResponse,
  SelectionDescriptor,
  NodeDescriptor,
  EdgeDescriptor,
};
