/**
 * TypeScript type definitions for tool execution
 */

// ============================================================================
// Tool Names
// ============================================================================

/**
 * Union type of all allowed tool names (strict allow-list)
 */
export type ToolName =
  | 'list_interfaces'
  | 'get_interface_oas_context'
  | 'compute_oas_gaps'
  | 'save_oas_spec'
  | 'save_product_artifacts'
  | 'save_architecture_baseline'
  | 'save_roadmap_structure'
  | 'save_markdown_artifact'
  | 'save_users_interactions'
  | 'save_backlog_items'
  | 'saveTemporaryArchitectureDiagram'
  | 'save_user_journeys'
  | 'save_discovery_config'
  | 'save_project_anchor_entities'
  | 'create_project_artifact';

/**
 * Array of allowed tool names for runtime checking
 */
export const ALLOWED_TOOL_NAMES: ToolName[] = [
  'list_interfaces',
  'get_interface_oas_context',
  'compute_oas_gaps',
  'save_oas_spec',
  'save_product_artifacts',
  'save_architecture_baseline',
  'save_roadmap_structure',
  'save_markdown_artifact',
  'save_users_interactions',
  'save_backlog_items',
  'saveTemporaryArchitectureDiagram',
  'save_user_journeys',
  'save_discovery_config',
  'save_project_anchor_entities',
  'create_project_artifact',
];

// ============================================================================
// Tool Definition Types (for OpenAI)
// ============================================================================

/**
 * OpenAI function parameter schema
 */
export interface ToolParameterSchema {
  type: 'object';
  required?: string[];
  properties: Record<string, {
    type: string;
    description?: string;
    enum?: string[];
    items?: {
      type: string;
      properties?: Record<string, { type: string; description?: string }>;
      required?: string[];
    };
  }>;
}

/**
 * OpenAI function definition
 */
export interface ToolFunctionDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

/**
 * OpenAI tool definition (function type)
 */
export interface ToolDefinition {
  type: 'function';
  function: ToolFunctionDefinition;
}

// ============================================================================
// Tool Call Types
// ============================================================================

/**
 * A tool call from OpenAI response
 */
export interface ToolCall {
  /** Tool name */
  name: ToolName | string;
  /** Parsed tool arguments */
  arguments: Record<string, unknown>;
  /** OpenAI call ID for matching results */
  callId: string;
}

/**
 * Result of a tool execution
 */
export interface ToolResult {
  /** OpenAI call ID to match with the original call */
  callId: string;
  /** Tool output (JSON-serializable) */
  output?: unknown;
  /** Error message if execution failed */
  error?: string;
}

// ============================================================================
// MCP Tool Parameter Types
// ============================================================================

/**
 * Parameters for list_interfaces tool
 */
export interface ListInterfacesParams {
  /** Architecture model filename */
  filename: string;
}

/**
 * Parameters for get_interface_oas_context tool
 */
export interface GetInterfaceOasContextParams {
  /** Interface ID to get context for */
  interfaceId: string;
}

/**
 * Parameters for compute_oas_gaps tool
 */
export interface ComputeOasGapsParams {
  /** Interface ID to compute gaps for */
  interfaceId: string;
  /** Optional draft OAS content for gap analysis */
  draftOas?: string;
}

/**
 * Parameters for save_oas_spec tool
 */
export interface SaveOasSpecParams {
  /** Architecture model filename */
  filename: string;
  /** Interface ID to save spec for */
  interfaceId: string;
  /** Output format */
  format: 'yaml' | 'json';
  /** Full OpenAPI spec content */
  oasContents: string;
}

/**
 * Parameters for save_product_artifacts tool
 */
export interface SaveProductArtifactsParams {
  /** Absolute path to the project root folder */
  projectParentFolder: string;
  /** Project UUID (v4 format) */
  projectId: string;
  /** Product name (max 255 characters) */
  productName: string;
  /** Full markdown content for MISSION.MD */
  missionMarkdown: string;
  /** Whether to overwrite existing MISSION.MD (default: true) */
  overwrite?: boolean;
}

/**
 * Parameters for save_architecture_baseline tool
 */
export interface SaveArchitectureBaselineParams {
  /** Project UUID (v4 format) */
  projectId: string;
  /** JSON string containing the architecture baseline payload with entity arrays */
  architectureBaselineJson: string;
}

/**
 * Parameters for save_roadmap_structure tool
 */
export interface SaveRoadmapStructureParams {
  /** Project UUID (v4 format) */
  projectId: string;
  /** JSON string containing the roadmap structure with initiatives and epics */
  roadmapJson: string;
}

/**
 * Parameters for save_markdown_artifact tool
 */
export interface SaveMarkdownArtifactParams {
  /** Project UUID (v4 format) */
  projectId: string;
  /** Optional absolute path to the project root folder */
  projectParentFolder?: string;
  /** Target filename (must end in .MD or .md, no path traversal) */
  artifactFilename: string;
  /** Full markdown content to write */
  markdown: string;
}

/**
 * Parameters for save_users_interactions tool
 */
export interface SaveUsersInteractionsParams {
  /** Project UUID (v4 format) */
  projectId: string;
  /** JSON string containing the users & interactions payload */
  usersInteractionsJson: string;
}
/** * Parameters for save_backlog_items tool */export interface SaveBacklogItemsParams {  /** Project UUID (v4 format) */  projectId: string;  /** JSON string containing the backlog payload with epicId, features, optional deletedWorkItemIds, and optional epicPriorityUpdates */  backlogJson: string;}

/**
 * Parameters for saveTemporaryArchitectureDiagram tool
 */
export interface SaveTemporaryArchitectureDiagramParams {
  /** Project UUID (v4 format) */
  projectId: string;
  /** JSON string containing the TemporaryArchitectureDiagram payload */
  diagramJson: string;
}

/**
 * Parameters for save_user_journeys tool
 */
export interface SaveUserJourneysParams {
  /** Project UUID (v4 format) */
  projectId: string;
  /** JSON string containing { user_journeys, activity_steps } arrays with name-based FK references */
  userJourneysJson: string;
}

/**
 * Parameters for save_discovery_config tool
 */
export interface SaveDiscoveryConfigParams {
  /** Project UUID (v4 format) */
  projectId: string;
  /** JSON string containing the discovery config payload */
  discoveryConfigJson: string;
}

/**
 * Parameters for save_project_anchor_entities tool
 */
export interface SaveProjectAnchorEntitiesParams {
  /** Project UUID (v4 format) */
  projectId: string;
  /** Array of applications to add */
  applications: Array<{ name: string; description: string }>;
  /** Array of app components to add */
  appComponents: Array<{ name: string; applicationName: string; description: string }>;
}

/**
 * Parameters for create_project_artifact tool
 */
export interface CreateProjectArtifactParams {
  /** Project UUID (v4 format) */
  projectId: string;
  /** The artifact type (e.g., "DISCOVERY_BRIEF_MD") */
  artifactType: string;
  /** The artifact content (e.g., markdown text) */
  content: string;
  /** The source identifier for the artifact */
  source: string;
}

/**
 * Union type of all tool parameter types
 */
export type ToolParams =
  | ListInterfacesParams
  | GetInterfaceOasContextParams
  | ComputeOasGapsParams
  | SaveOasSpecParams
  | SaveProductArtifactsParams
  | SaveArchitectureBaselineParams
  | SaveRoadmapStructureParams
  | SaveMarkdownArtifactParams
  | SaveUsersInteractionsParams
  | SaveBacklogItemsParams
  | SaveTemporaryArchitectureDiagramParams
  | SaveUserJourneysParams
  | SaveDiscoveryConfigParams
  | SaveProjectAnchorEntitiesParams
  | CreateProjectArtifactParams;

// ============================================================================
// Tool Definitions for OpenAI
// ============================================================================

/**
 * OpenAI tool definitions for the allowed MCP tools
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'list_interfaces',
      description: 'List all interfaces for a given architecture model filename',
      parameters: {
        type: 'object',
        required: ['filename'],
        properties: {
          filename: {
            type: 'string',
            description: 'Architecture model filename'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_interface_oas_context',
      description: 'Get full OAS-ready context for a specific interface including endpoints, logical entities, and service details',
      parameters: {
        type: 'object',
        required: ['interfaceId'],
        properties: {
          interfaceId: {
            type: 'string',
            description: 'Interface ID'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'compute_oas_gaps',
      description: 'Compute gaps, defaults, type mappings, and operationId suggestions for OAS generation',
      parameters: {
        type: 'object',
        required: ['interfaceId'],
        properties: {
          interfaceId: {
            type: 'string',
            description: 'Interface ID'
          },
          draftOas: {
            type: 'string',
            description: 'Optional draft OAS content'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_oas_spec',
      description: 'Save a generated OpenAPI spec to disk and update the interface record',
      parameters: {
        type: 'object',
        required: ['filename', 'interfaceId', 'format', 'oasContents'],
        properties: {
          filename: {
            type: 'string',
            description: 'Architecture model filename'
          },
          interfaceId: {
            type: 'string',
            description: 'Interface ID'
          },
          format: {
            type: 'string',
            enum: ['yaml', 'json'],
            description: 'Output format'
          },
          oasContents: {
            type: 'string',
            description: 'Full OpenAPI spec content'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_product_artifacts',
      description: 'Save product artifacts: writes MISSION.MD to agent-os/product/ and upserts a minimal ProductDefinition record',
      parameters: {
        type: 'object',
        required: ['projectParentFolder', 'projectId', 'productName', 'missionMarkdown'],
        properties: {
          projectParentFolder: {
            type: 'string',
            description: 'Absolute path to the project root folder'
          },
          projectId: {
            type: 'string',
            description: 'Project UUID (v4 format)'
          },
          productName: {
            type: 'string',
            description: 'Product name (max 255 characters)'
          },
          missionMarkdown: {
            type: 'string',
            description: 'Full markdown content for MISSION.MD'
          },
          overwrite: {
            type: 'boolean',
            description: 'Whether to overwrite existing MISSION.MD (default: true)'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_architecture_baseline',
      description: 'Save an architecture baseline: persists services, interfaces, endpoints, data entities, business logic, and data movements into the architecture model using a GET-merge-PUT strategy that preserves existing model data',
      parameters: {
        type: 'object',
        required: ['projectId', 'architectureBaselineJson'],
        properties: {
          projectId: {
            type: 'string',
            description: 'Project UUID (v4 format)'
          },
          architectureBaselineJson: {
            type: 'string',
            description: 'JSON string containing the architecture baseline payload with optional arrays: services, interfaces, interfaceEndpoints, logicalDataEntities, physicalDataEntities, logicalDataAttributes, physicalDataAttributes, businessLogic, dataMovements, dataEntityRelationships, entitiesToDelete, relationshipsToDelete. All ref fields use human-readable names.'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_roadmap_structure',
      description: 'Persist a roadmap structure of initiatives and epics as canonical work items. Supports both initial creation and subsequent updates via externalRef-first, title-fallback upsert matching.',
      parameters: {
        type: 'object',
        required: ['projectId', 'roadmapJson'],
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID (auto-injected)'
          },
          projectId: {
            type: 'string',
            description: 'Project UUID (v4 format)'
          },
          roadmapJson: {
            type: 'string',
            description: 'JSON string containing { initiatives: [{ title, description?, externalRef?, epics?: [{ title, description?, externalRef? }] }] }'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_markdown_artifact',
      description: 'Save a markdown artifact to agent-os/product/. Generic tool for writing any markdown file (TECH-STACK.MD, TEST-STRATEGY.MD, etc.) with atomic write semantics.',
      parameters: {
        type: 'object',
        required: ['projectId', 'artifactFilename', 'markdown'],
        properties: {
          projectId: {
            type: 'string',
            description: 'Project UUID (v4 format)'
          },
          projectParentFolder: {
            type: 'string',
            description: 'Optional absolute path to the project root folder'
          },
          artifactFilename: {
            type: 'string',
            description: 'Target filename (must end in .MD or .md, no path traversal characters)'
          },
          markdown: {
            type: 'string',
            description: 'Full markdown content to write'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_users_interactions',
      description: 'Save users & interactions: persists business users, business processes, process activities, and UI screens into the architecture model using a GET-merge-PUT strategy that preserves existing model data.',
      parameters: {
        type: 'object',
        required: ['projectId', 'usersInteractionsJson'],
        properties: {
          projectId: {
            type: 'string',
            description: 'Project UUID (v4 format)'
          },
          usersInteractionsJson: {
            type: 'string',
            description: 'JSON string containing { business_users, business_processes, process_activities, ui_screens } arrays with name-based references.'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_backlog_items',
      description: 'Persist features and stories as work items under a specific epic. Supports creation, updates (via ID-first or title-fallback matching), and deletion of work items. Optionally updates epic priority values.',
      parameters: {
        type: 'object',
        required: ['projectId', 'backlogJson'],
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID (auto-injected)'
          },
          projectId: {
            type: 'string',
            description: 'Project UUID'
          },
          backlogJson: {
            type: 'string',
            description: 'JSON string with epicId, features array, optional deletedWorkItemIds array, and optional epicPriorityUpdates array'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'saveTemporaryArchitectureDiagram',
      description: 'Save a temporary architecture diagram payload for future mapping and rendering',
      parameters: {
        type: 'object',
        required: ['projectId', 'diagramJson'],
        properties: {
          projectId: {
            type: 'string',
            description: 'Project UUID (v4 format)'
          },
          diagramJson: {
            type: 'string',
            description: 'JSON string containing the TemporaryArchitectureDiagram payload'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_user_journeys',
      description: 'Save user journeys and activity steps: persists them into the architecture model using a GET-merge-PUT strategy with name-to-ID resolution and upsert semantics. Reports CREATED/UPDATED status per entity.',
      parameters: {
        type: 'object',
        required: ['projectId', 'userJourneysJson'],
        properties: {
          projectId: {
            type: 'string',
            description: 'Project UUID (v4 format)'
          },
          userJourneysJson: {
            type: 'string',
            description: 'JSON string containing { user_journeys, activity_steps } arrays with name-based FK references for business users, business processes, process activities, and applications.'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_discovery_config',
      description: 'Save the Phase 0 discovery configuration for a project. Persists structured JSONB config covering repo scope, repo-to-application mappings, tech hints, exclusions, and notes.',
      parameters: {
        type: 'object',
        required: ['projectId', 'discoveryConfigJson'],
        properties: {
          projectId: {
            type: 'string',
            description: 'Project UUID (v4 format)'
          },
          discoveryConfigJson: {
            type: 'string',
            description: 'JSON string containing the discovery config payload with repos, repoApplicationMappings, techHints, exclusions, and notes'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'save_project_anchor_entities',
      description: 'Save anchor entities (applications and app_components) to the architecture model using a GET-merge-PUT strategy with name-based deduplication. Used by Phase 0 discovery framing to persist discovered applications and components.',
      parameters: {
        type: 'object',
        required: ['projectId', 'applications', 'appComponents'],
        properties: {
          projectId: {
            type: 'string',
            description: 'Project UUID (v4 format)'
          },
          applications: {
            type: 'array',
            description: 'Array of applications to add, each with name and description',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Application name' },
                description: { type: 'string', description: 'Application description' }
              },
              required: ['name', 'description']
            }
          },
          appComponents: {
            type: 'array',
            description: 'Array of app components to add, each with name, applicationName (parent reference), and description',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Component name' },
                applicationName: { type: 'string', description: 'Parent application name' },
                description: { type: 'string', description: 'Component description' }
              },
              required: ['name', 'applicationName', 'description']
            }
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_project_artifact',
      description: 'Create a project artifact in the architecture model service. Stores content with a specified artifact type and source identifier.',
      parameters: {
        type: 'object',
        required: ['projectId', 'artifactType', 'content', 'source'],
        properties: {
          projectId: {
            type: 'string',
            description: 'Project UUID (v4 format)'
          },
          artifactType: {
            type: 'string',
            description: 'The artifact type (e.g., "DISCOVERY_BRIEF_MD")'
          },
          content: {
            type: 'string',
            description: 'The artifact content (e.g., markdown text)'
          },
          source: {
            type: 'string',
            description: 'The source identifier for the artifact (e.g., "discovery-framing")'
          }
        }
      }
    }
  },
];
