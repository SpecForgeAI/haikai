/**
 * Chat V2 Route Handler
 *
 * Spec 2026-02-28: Unified Conversation Engine v1 (Backend)
 * Task Group 7: POST /api/chat/v2 Endpoint
 * + Increment 2, Task Group 2: GET /api/chat/v2/thread Endpoint
 * + Increment 3, Task Group 1: POST /api/chat/v2/handoff Endpoint
 * + Hub Bootstrap 1, Task Group 2: POST /api/chat/v2/generate and POST /api/chat/v2/save-artifact
 * + Hub Bootstrap 2, Task Group 2: Roadmap endpoint extensions (context assembly, first-turn,
 *   /generate branching, /save-artifact adapter, nested validation)
 * + Hub Bootstrap 3, Task Group 2: Architecture baseline endpoint extensions (inline context,
 *   /generate with jsonMode + corrective retry, /save-artifact with defense-in-depth)
 * + Hub Bootstrap 4, Task Group 3: Tech stack + test strategy endpoint extensions (context injection,
 *   /generate with jsonMode + corrective retry, /save-artifact with JSON-to-markdown conversion)
 * + Unify Panel: Server-side allowedPersonaIds validation on all three POST endpoints
 *
 * Implements the new unified v2 chat endpoint that ties together:
 * - Registry lookup (persona + task definitions)
 * - Prompt composition pipeline
 * - Thread persistence (create / rehydrate / append)
 * - LLM call via sendChatRequest
 * - Structured response validation
 *
 * Mounted at /api/chat/v2 in server.ts.
 * The existing POST /api/chat endpoint remains completely untouched.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import {
  ChatV2Request,
  ChatV2Response,
  ThreadKey,
  PanelThreadKey,
  ThreadMessage,
  Thread,
  isChatV2Request,
  threadKeyToString,
  parseThreadKey,
  TaskDefinition,
} from '../types/chatV2';
import { getPersonaRegistry, getTaskRegistry } from '../services/registryLoader';
import { getContextResolverRegistry } from '../services/contextResolvers';
import { getThread, createThread, appendMessage, deleteThread, saveThread } from '../services/threadStore';
import { composeSystemPrompt } from '../services/promptComposer';
import { OpenAIMessage, ContentPart } from '../services/openaiClient';
import { getLlmClient } from '../services/llmClient';
import { logger } from '../services/logger';

// Hub Bootstrap 1 -- Task Group 2: New imports for /generate and /save-artifact endpoints
import { MISSION_GENERATION_PROMPT_TEMPLATE } from '../services/promptBuilder';
import { TOOL_DEFINITIONS, ToolDefinition } from '../types/tools';
import { fetchProductName, fetchProjectFolder } from '../services/architectureModelClient';
import { executeToolCall } from '../services/toolExecutor';

// Hub Bootstrap 2 -- Task Group 2: Roadmap-specific imports
import { fetchProductSummary } from '../services/architectureModelClient';
import { buildRoadmapSummary, hasExistingRoadmap, countRoadmapItems } from '../services/roadmapSummaryBuilder';
import { ROADMAP_EXISTS_INSTRUCTION_BLOCK } from '../services/promptBuilder';
import * as fs from 'fs/promises';
import * as path from 'path';

// Hub Bootstrap 3 -- Task Group 2: Architecture baseline imports
import {
  validateBaselineJsonShape,
  ensureMinimumServices,
  buildConversationTranscript,
  BASELINE_JSON_CORRECTIVE_INSTRUCTION,
} from './chatValidation';
import { ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE } from '../services/promptBuilder';

// Hub Bootstrap 4 -- Task Group 3: Tech stack + test strategy imports
import { fetchMetaModelSummary, resolveDefaultArchitectureId, listArchitectures } from '../services/architectureModelClient';
import {
  TECH_STACK_GENERATION_PROMPT_TEMPLATE,
  TEST_STRATEGY_GENERATION_PROMPT_TEMPLATE,
  USERS_INTERACTIONS_GENERATION_PROMPT_TEMPLATE,
  USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE,
} from '../services/promptBuilder';

// Spec 2026-03-14: Detailed Data Model Task -- architecture context builder import
import { buildArchitectureContextSection, buildDataModelContextSection } from '../services/architectureContextBuilder';
// Backlog task: epic list builder import
import { buildEpicListForBacklog } from '../services/backlogContextBuilder';

// Discovery Insights: extract Q&A pairs from discovery conversations, inject as context
import { extractAndSaveInsights, loadFormattedInsights } from '../services/discoveryInsightsService';

// Hub Bootstrap 6 -- Increment 11: Summarisation trigger
import { maybeSummariseThread } from '../services/threadSummariser';

// Spec 2026-03-04: Assistant "What's Next" v1 -- deterministic short-circuit imports
import { buildProjectSignals } from '../services/projectSignals';
import { evaluateNextActions } from '../services/whatsNextEvaluator';

// Spec 2026-03-04: What's Next v1-C -- Work item picker search import
import { searchWorkItems } from '../services/workItemSearchService';
// Spec 2026-04-03: UX Designer XLSX Ingestion for User Journeys
import { parseUserJourneyWorkbook, extractProcessActivitiesFromTranscript } from '../services/xlsxUserJourneyParser';

// Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- Group 6:
// derivedBindingResolver intercept for `derived-from-context` mode (architect--oas-spec).
import {
  resolve as resolveDerivedBinding,
  DerivedBindingError,
} from '../services/derivedBindingResolver';
import { ChatV2BindingError } from '../types/chatV2';

// Spec 2026-03-04: What's Next v1-C -- Picker state machine
interface PickerState {
  mode: 'awaiting-query' | 'awaiting-selection';
  actionId: string;
}
const pickerStateMap = new Map<string, PickerState>();

export const chatV2Router = Router();

// ============================================================================
// Response Validation Utility (Task 7.3)
// + Hub Bootstrap 2, Task 2.3: Nested array-item validation
// ============================================================================

/**
 * Lightweight structured response validator.
 *
 * Parses the raw LLM response as JSON and checks:
 * 1. The string is valid JSON
 * 2. Required top-level fields exist (from responseFormat.required)
 * 3. Field types match expected types (from responseFormat.properties)
 * 4. (Hub Bootstrap 2) Array items validated against items.properties schema
 *
 * No full JSON Schema library -- just field presence and type checks.
 *
 * @param raw - The raw LLM response string to validate
 * @param responseFormat - The task's responseFormat JSON schema object
 * @returns Validation result with parsed data or error message
 */
export function validateStructuredResponse(
  raw: string,
  responseFormat: Record<string, unknown>
): { valid: boolean; parsed?: unknown; error?: string } {
  // Step 1: Parse as JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      valid: false,
      error: `Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`,
    };
  }

  // Must be an object
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      valid: false,
      error: 'Expected a JSON object at top level',
    };
  }

  const obj = parsed as Record<string, unknown>;

  // Step 2: Check required fields exist
  const requiredFields = responseFormat.required;
  if (Array.isArray(requiredFields)) {
    for (const field of requiredFields) {
      if (typeof field === 'string' && !(field in obj)) {
        return {
          valid: false,
          parsed,
          error: `Missing required field: ${field}`,
        };
      }
    }
  }

  // Step 3: Check field types match expected types from properties
  const properties = responseFormat.properties;
  if (properties && typeof properties === 'object') {
    const propDefs = properties as Record<string, Record<string, unknown>>;
    for (const [fieldName, fieldSchema] of Object.entries(propDefs)) {
      if (!(fieldName in obj)) {
        // Field not present -- only required fields are enforced above
        continue;
      }

      const expectedType = fieldSchema?.type;
      if (typeof expectedType !== 'string') {
        continue;
      }

      const actualValue = obj[fieldName];

      // Map JSON Schema types to JavaScript typeof results
      let typeMatch = false;
      switch (expectedType) {
        case 'string':
          typeMatch = typeof actualValue === 'string';
          break;
        case 'number':
        case 'integer':
          typeMatch = typeof actualValue === 'number';
          break;
        case 'boolean':
          typeMatch = typeof actualValue === 'boolean';
          break;
        case 'array':
          typeMatch = Array.isArray(actualValue);
          // Hub Bootstrap 2, Task 2.3: Nested array-item validation
          // When the array type matches and schema defines items.type === 'object' with items.properties,
          // validate each array item against the nested schema.
          if (typeMatch && fieldSchema.items && typeof fieldSchema.items === 'object') {
            const itemsSchema = fieldSchema.items as Record<string, unknown>;
            if (itemsSchema.type === 'object' && itemsSchema.properties && typeof itemsSchema.properties === 'object') {
              const itemProps = itemsSchema.properties as Record<string, Record<string, unknown>>;
              const arr = actualValue as unknown[];
              for (let idx = 0; idx < arr.length; idx++) {
                const item = arr[idx];
                // Each item must be a non-null object
                if (typeof item !== 'object' || item === null || Array.isArray(item)) {
                  return {
                    valid: false,
                    parsed,
                    error: `Array item validation failed for ${fieldName}[${idx}]: expected object, got ${Array.isArray(item) ? 'array' : typeof item}`,
                  };
                }
                const itemObj = item as Record<string, unknown>;
                // Check each property defined in items.properties
                for (const [subFieldName, subFieldSchema] of Object.entries(itemProps)) {
                  const subExpectedType = subFieldSchema?.type;
                  if (typeof subExpectedType !== 'string') continue;
                  // Only validate if the sub-field is present in the item
                  if (!(subFieldName in itemObj)) continue;
                  const subActualValue = itemObj[subFieldName];
                  let subMatch = false;
                  switch (subExpectedType) {
                    case 'string':
                      subMatch = typeof subActualValue === 'string';
                      break;
                    case 'number':
                    case 'integer':
                      subMatch = typeof subActualValue === 'number';
                      break;
                    case 'boolean':
                      subMatch = typeof subActualValue === 'boolean';
                      break;
                    case 'array':
                      subMatch = Array.isArray(subActualValue);
                      // One more level of nesting: validate sub-array items (e.g., epics)
                      if (subMatch && subFieldSchema.items && typeof subFieldSchema.items === 'object') {
                        const subItemsSchema = subFieldSchema.items as Record<string, unknown>;
                        if (subItemsSchema.type === 'object' && subItemsSchema.properties && typeof subItemsSchema.properties === 'object') {
                          const subItemProps = subItemsSchema.properties as Record<string, Record<string, unknown>>;
                          const subArr = subActualValue as unknown[];
                          for (let subIdx = 0; subIdx < subArr.length; subIdx++) {
                            const subItem = subArr[subIdx];
                            if (typeof subItem !== 'object' || subItem === null || Array.isArray(subItem)) {
                              return {
                                valid: false,
                                parsed,
                                error: `Array item validation failed for ${fieldName}[${idx}].${subFieldName}[${subIdx}]: expected object, got ${Array.isArray(subItem) ? 'array' : typeof subItem}`,
                              };
                            }
                            const subItemObj = subItem as Record<string, unknown>;
                            for (const [deepFieldName, deepFieldSchema] of Object.entries(subItemProps)) {
                              const deepExpectedType = deepFieldSchema?.type;
                              if (typeof deepExpectedType !== 'string') continue;
                              if (!(deepFieldName in subItemObj)) continue;
                              const deepActualValue = subItemObj[deepFieldName];
                              if (deepExpectedType === 'string' && typeof deepActualValue !== 'string' && deepActualValue !== null) {
                                return {
                                  valid: false,
                                  parsed,
                                  error: `Array item validation failed for ${fieldName}[${idx}].${subFieldName}[${subIdx}]: ${deepFieldName} expected string, got ${typeof deepActualValue}`,
                                };
                              }
                            }
                          }
                        }
                      }
                      break;
                    case 'object':
                      subMatch = typeof subActualValue === 'object' && subActualValue !== null && !Array.isArray(subActualValue);
                      break;
                    default:
                      subMatch = true;
                      break;
                  }
                  if (!subMatch && subActualValue !== null) {
                    return {
                      valid: false,
                      parsed,
                      error: `Array item validation failed for ${fieldName}[${idx}]: ${subFieldName} expected ${subExpectedType}, got ${Array.isArray(subActualValue) ? 'array' : typeof subActualValue}`,
                    };
                  }
                }
              }
            }
          }
          break;
        case 'object':
          typeMatch = typeof actualValue === 'object' && actualValue !== null && !Array.isArray(actualValue);
          break;
        default:
          // Unknown type -- skip validation
          typeMatch = true;
          break;
      }

      if (!typeMatch && actualValue !== null) {
        return {
          valid: false,
          parsed,
          error: `Type mismatch: ${fieldName} expected ${expectedType}, got ${Array.isArray(actualValue) ? 'array' : typeof actualValue}`,
        };
      }
    }
  }

  return { valid: true, parsed };
}

// ============================================================================
// Content Parts Builder (mirrors buildContentParts from chat.ts)
// ============================================================================

/**
 * Builds OpenAI content parts from a user message and attached files.
 * Mirrors the pattern in chat.ts buildContentParts() but is self-contained
 * to avoid modifying or importing from the existing chat route.
 *
 * @param message - The user message text
 * @param files - Array of file attachments with filename, mimeType, and base64 data
 * @returns ContentPart[] array with text first, then file/image parts
 */
function buildContentPartsV2(
  message: string,
  files: Array<{ filename: string; mimeType: string; base64: string }>
): ContentPart[] {
  const parts: ContentPart[] = [
    { type: 'text', text: message },
  ];

  for (const file of files) {
    if (file.mimeType.startsWith('image/')) {
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${file.mimeType};base64,${file.base64}`,
          detail: 'auto',
        },
      });
    } else if (file.mimeType === 'application/pdf') {
      parts.push({
        type: 'file',
        file: {
          file_data: `data:${file.mimeType};base64,${file.base64}`,
          filename: file.filename,
        },
      });
    } else {
      // Text-based files: decode base64 and inline as text
      const decoded = Buffer.from(file.base64, 'base64').toString('utf-8');
      parts.push({
        type: 'text',
        text: `--- File: ${file.filename} ---\n${decoded}\n--- End of ${file.filename} ---`,
      });
    }
  }

  return parts;
}

// ============================================================================
// Hub Bootstrap 4 -- Task Group 3: Validation + Conversion Utilities
// ============================================================================

/**
 * Validates the shape of a tech stack JSON object.
 * Checks that top-level has categories (array), designDecisions (array), constraints (array).
 * Each category must have name (string) and technologies (array).
 * Each technology must have name (string).
 */
export function validateTechStackJsonShape(parsed: unknown): { valid: boolean; error?: string } {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { valid: false, error: 'Expected a JSON object at top level' };
  }
  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj.categories)) {
    return { valid: false, error: 'Missing or non-array field: categories' };
  }
  if (!Array.isArray(obj.designDecisions)) {
    return { valid: false, error: 'Missing or non-array field: designDecisions' };
  }
  if (!Array.isArray(obj.constraints)) {
    return { valid: false, error: 'Missing or non-array field: constraints' };
  }

  for (let i = 0; i < obj.categories.length; i++) {
    const cat = obj.categories[i] as Record<string, unknown>;
    if (typeof cat !== 'object' || cat === null) {
      return { valid: false, error: `categories[${i}] is not an object` };
    }
    if (typeof cat.name !== 'string') {
      return { valid: false, error: `categories[${i}].name is not a string` };
    }
    if (!Array.isArray(cat.technologies)) {
      return { valid: false, error: `categories[${i}].technologies is not an array` };
    }
    for (let j = 0; j < (cat.technologies as unknown[]).length; j++) {
      const tech = (cat.technologies as unknown[])[j] as Record<string, unknown>;
      if (typeof tech !== 'object' || tech === null) {
        return { valid: false, error: `categories[${i}].technologies[${j}] is not an object` };
      }
      if (typeof tech.name !== 'string') {
        return { valid: false, error: `categories[${i}].technologies[${j}].name is not a string` };
      }
    }
  }

  return { valid: true };
}

/**
 * Validates the shape of a test strategy JSON object.
 * Checks that top-level has testLevels (array), qualityGates (array), testingPrinciples (array).
 * Each testLevel must have name (string).
 * Each qualityGate must have name (string).
 */
export function validateTestStrategyJsonShape(parsed: unknown): { valid: boolean; error?: string } {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { valid: false, error: 'Expected a JSON object at top level' };
  }
  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj.testLevels)) {
    return { valid: false, error: 'Missing or non-array field: testLevels' };
  }
  if (!Array.isArray(obj.qualityGates)) {
    return { valid: false, error: 'Missing or non-array field: qualityGates' };
  }
  if (!Array.isArray(obj.testingPrinciples)) {
    return { valid: false, error: 'Missing or non-array field: testingPrinciples' };
  }

  for (let i = 0; i < obj.testLevels.length; i++) {
    const level = obj.testLevels[i] as Record<string, unknown>;
    if (typeof level !== 'object' || level === null) {
      return { valid: false, error: `testLevels[${i}] is not an object` };
    }
    if (typeof level.name !== 'string') {
      return { valid: false, error: `testLevels[${i}].name is not a string` };
    }
  }

  for (let i = 0; i < obj.qualityGates.length; i++) {
    const gate = obj.qualityGates[i] as Record<string, unknown>;
    if (typeof gate !== 'object' || gate === null) {
      return { valid: false, error: `qualityGates[${i}] is not an object` };
    }
    if (typeof gate.name !== 'string') {
      return { valid: false, error: `qualityGates[${i}].name is not a string` };
    }
  }

  return { valid: true };
}

/**
 * Converts tech stack JSON to human-readable markdown.
 */
export function convertTechStackToMarkdown(data: Record<string, unknown>): string {
  const lines: string[] = ['# Tech Stack', ''];

  const categories = (data.categories || []) as Array<Record<string, unknown>>;
  for (const cat of categories) {
    lines.push(`## ${cat.name}`, '');
    lines.push('| Name | Version | Purpose | Rationale |');
    lines.push('|------|---------|---------|-----------|');
    const techs = (cat.technologies || []) as Array<Record<string, unknown>>;
    for (const tech of techs) {
      lines.push(`| ${tech.name || ''} | ${tech.version || ''} | ${tech.purpose || ''} | ${tech.rationale || ''} |`);
    }
    lines.push('');
  }

  const decisions = (data.designDecisions || []) as Array<Record<string, unknown>>;
  if (decisions.length > 0) {
    lines.push('## Design Decisions', '');
    for (const d of decisions) {
      lines.push(`### ${d.title || 'Untitled'}`);
      if (d.description) lines.push(`${d.description}`);
      if (d.rationale) lines.push(`**Rationale:** ${d.rationale}`);
      lines.push('');
    }
  }

  const constraints = (data.constraints || []) as Array<Record<string, unknown>>;
  if (constraints.length > 0) {
    lines.push('## Constraints', '');
    for (const c of constraints) {
      lines.push(`- **${c.name || 'Unnamed'}** (${c.type || 'general'}): ${c.description || ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Converts test strategy JSON to human-readable markdown.
 */
export function convertTestStrategyToMarkdown(data: Record<string, unknown>): string {
  const lines: string[] = ['# Test Strategy', ''];

  const levels = (data.testLevels || []) as Array<Record<string, unknown>>;
  if (levels.length > 0) {
    lines.push('## Test Levels', '');
    for (const level of levels) {
      lines.push(`### ${level.name || 'Unnamed'}`);
      if (level.scope) lines.push(`- **Scope:** ${level.scope}`);
      if (level.coverageTarget) lines.push(`- **Coverage Target:** ${level.coverageTarget}`);
      if (Array.isArray(level.tools) && level.tools.length > 0) {
        lines.push(`- **Tools:** ${(level.tools as string[]).join(', ')}`);
      }
      if (level.rationale) lines.push(`- **Rationale:** ${level.rationale}`);
      lines.push('');
    }
  }

  const gates = (data.qualityGates || []) as Array<Record<string, unknown>>;
  if (gates.length > 0) {
    lines.push('## Quality Gates', '');
    for (const gate of gates) {
      lines.push(`### ${gate.name || 'Unnamed'}`);
      if (Array.isArray(gate.criteria) && gate.criteria.length > 0) {
        lines.push('**Criteria:**');
        for (const c of gate.criteria as string[]) {
          lines.push(`- ${c}`);
        }
      }
      if (gate.enforcement) lines.push(`**Enforcement:** ${gate.enforcement}`);
      lines.push('');
    }
  }

  const principles = (data.testingPrinciples || []) as Array<Record<string, unknown>>;
  if (principles.length > 0) {
    lines.push('## Testing Principles', '');
    for (const p of principles) {
      lines.push(`### ${p.title || 'Untitled'}`);
      if (p.description) lines.push(`${p.description}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// Phase 0 Completion: Discovery brief markdown generation (deterministic)
// Co-located with convertTechStackToMarkdown and convertTestStrategyToMarkdown
export function convertDiscoveryBriefToMarkdown(data: Record<string, unknown>): string {
  const lines: string[] = ['# Discovery Brief', ''];

  // Scope Summary
  if (data.summary && typeof data.summary === 'string') {
    lines.push('## Scope Summary', '');
    lines.push(data.summary, '');
  }

  // Applications table
  const applications = (data.applications || []) as Array<Record<string, unknown>>;
  if (applications.length > 0) {
    lines.push('## Applications', '');
    lines.push('| Name | Description |');
    lines.push('| --- | --- |');
    for (const app of applications) {
      lines.push(`| ${app.name || ''} | ${app.description || ''} |`);
    }
    lines.push('');
  }

  // Application Components table
  const appComponents = (data.appComponents || []) as Array<Record<string, unknown>>;
  if (appComponents.length > 0) {
    lines.push('## Application Components', '');
    lines.push('| Name | Application | Description |');
    lines.push('| --- | --- | --- |');
    for (const comp of appComponents) {
      lines.push(`| ${comp.name || ''} | ${comp.applicationName || ''} | ${comp.description || ''} |`);
    }
    lines.push('');
  }

  // Repositories table
  const repos = (data.repos || []) as Array<Record<string, unknown>>;
  if (repos.length > 0) {
    lines.push('## Repositories', '');
    lines.push('| URL | Branch | Include Paths | Exclude Paths |');
    lines.push('| --- | --- | --- | --- |');
    for (const repo of repos) {
      const includePaths = Array.isArray(repo.includePaths) ? (repo.includePaths as string[]).join(', ') : '';
      const excludePaths = Array.isArray(repo.excludePaths) ? (repo.excludePaths as string[]).join(', ') : '';
      lines.push(`| ${repo.url || ''} | ${repo.branch || ''} | ${includePaths} | ${excludePaths} |`);
    }
    lines.push('');
  }

  // Repository-Application Mappings table
  const repoAppMappings = (data.repoApplicationMappings || []) as Array<Record<string, unknown>>;
  if (repoAppMappings.length > 0) {
    lines.push('## Repository-Application Mappings', '');
    lines.push('| Repo URL | Path | Application |');
    lines.push('| --- | --- | --- |');
    for (const mapping of repoAppMappings) {
      lines.push(`| ${mapping.repoUrl || ''} | ${mapping.path || ''} | ${mapping.applicationName || ''} |`);
    }
    lines.push('');
  }

  // Technology Hints table
  const techHints = (data.techHints || []) as Array<Record<string, unknown>>;
  if (techHints.length > 0) {
    lines.push('## Technology Hints', '');
    lines.push('| Repo URL | Path | Technology | Language |');
    lines.push('| --- | --- | --- | --- |');
    for (const hint of techHints) {
      lines.push(`| ${hint.repoUrl || ''} | ${hint.path || ''} | ${hint.technology || ''} | ${hint.language || ''} |`);
    }
    lines.push('');
  }

  // Exclusions table
  const exclusions = (data.exclusions || []) as Array<Record<string, unknown>>;
  if (exclusions.length > 0) {
    lines.push('## Exclusions', '');
    lines.push('| Pattern | Reason |');
    lines.push('| --- | --- |');
    for (const excl of exclusions) {
      lines.push(`| ${excl.pattern || ''} | ${excl.reason || ''} |`);
    }
    lines.push('');
  }

  // Notes and Assumptions
  const notes = (data.notes || []) as string[];
  if (notes.length > 0) {
    lines.push('## Notes and Assumptions', '');
    for (const note of notes) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}



// Corrective instruction for tech stack JSON validation retry
const TECH_STACK_JSON_CORRECTIVE_INSTRUCTION = 'Your last response was not valid JSON matching the TechStack schema. Return ONLY a single JSON object with arrays for: categories (each with name and technologies array), designDecisions, constraints. No markdown, no code blocks.';

// Corrective instruction for test strategy JSON validation retry
const TEST_STRATEGY_JSON_CORRECTIVE_INSTRUCTION = 'Your last response was not valid JSON matching the TestStrategy schema. Return ONLY a single JSON object with arrays for: testLevels (each with name), qualityGates (each with name), testingPrinciples. No markdown, no code blocks.';


// Spec 2026-03-14: Data model generation prompt template
const DATA_MODEL_GENERATION_PROMPT_TEMPLATE = `You are a Data Model Extraction Assistant. Your task is to synthesize the entire data model discovery conversation into a single JSON object suitable for persisting via save_architecture_baseline.

## PRODUCT MISSION CONTEXT
{missionContent}

## TECHNICAL STANDARDS CONTEXT
{techStackContent}

## CONVERSATION TRANSCRIPT
{conversationTranscript}

## TARGET SCHEMA

The output JSON must be a single object with the following arrays. All arrays default to empty if no relevant entities were discussed.

### Top-Level Structure
{
  "logicalDataEntities": LogicalDataEntityInput[],
  "physicalDataEntities": PhysicalDataEntityInput[],
  "logicalDataAttributes": LogicalDataAttributeInput[],
  "physicalDataAttributes": PhysicalDataAttributeInput[],
  "logicalPhysicalEntityMappings": EntityMappingInput[],
  "dataEntityRelationships": DataEntityRelationshipInput[],
  "entitiesToDelete": EntityDeleteInput[],
  "relationshipsToDelete": RelationshipDeleteInput[]
}

### LogicalDataEntityInput
{
  "name": string,          // Required, must be non-empty
  "description": string,   // Optional
  "tags": string           // Optional, comma-separated
}

### PhysicalDataEntityInput
{
  "name": string,                  // Required, must be non-empty
  "description": string,           // Optional
  "physicalType": string,          // Optional (e.g., "TABLE", "COLLECTION")
  "database": string,              // Optional
  "logicalDataEntityRef": string,  // Optional -- name of a logical data entity
  "tags": string                   // Optional, comma-separated
}

### LogicalDataAttributeInput
{
  "name": string,              // Required, must be non-empty
  "description": string,       // Optional
  "logicalEntityRef": string,  // Required -- must match a logical data entity name
  "dataType": string,          // Optional (e.g., "String", "Integer", "UUID")
  "isPrimaryKey": boolean,     // Optional, default false
  "isNullable": boolean,       // Optional, default true
  "tags": string               // Optional, comma-separated
}

### PhysicalDataAttributeInput
{
  "name": string,              // Required, must be non-empty
  "description": string,       // Optional
  "physicalEntityRef": string, // Required -- must match a physical data entity name
  "dataType": string,          // Optional (e.g., "VARCHAR(255)", "INTEGER", "UUID")
  "isPrimaryKey": boolean,     // Optional, default false
  "isNullable": boolean,       // Optional, default true
  "tags": string               // Optional, comma-separated
}

### EntityMappingInput (logicalPhysicalEntityMappings)
{
  "logicalEntityName": string,   // Must match a logical data entity name
  "physicalEntityName": string   // Must match a physical data entity name
}

### DataEntityRelationshipInput (dataEntityRelationships)
Array of FK/association relationships between data entities.
{
  "fromEntityRef": "string -- Must match a logical or physical entity name",
  "fromEntityType": "'logical' | 'physical'",
  "toEntityRef": "string -- Must match a logical or physical entity name",
  "toEntityType": "'logical' | 'physical' -- MUST equal fromEntityType",
  "cardinality": "string -- Optional: ONE_TO_ONE, ONE_TO_MANY, MANY_TO_ONE, MANY_TO_MANY",
  "relationship": "string -- Optional: ASSOCIATION, COMPOSITION, AGGREGATION, GENERALIZATION, REALIZATION, DEPENDENCY",
  "description": "string -- Optional",
  "tags": "string -- Optional, comma-separated"
}

### EntityDeleteInput (entitiesToDelete)
Array of entities to delete from the existing architecture model.
{
  "entityType": "'logical_data_entities' | 'physical_data_entities'",
  "name": "string -- Name of entity to delete"
}

### RelationshipDeleteInput (relationshipsToDelete)
Array of relationships to delete by ID from the existing architecture model.
{
  "relationshipType": "string -- e.g. 'logical_data_entity_relationships', 'data_movements'",
  "id": "string -- UUID of the relationship from the architecture context"
}

## EXTRACTION RULES
1. Extract all data entities and attributes discussed in the conversation transcript above.
2. The "name" field is required for all entities and attributes and must be non-empty.
3. The "logicalEntityRef" on logical data attributes must match a logical entity name exactly.
4. The "physicalEntityRef" on physical data attributes must match a physical entity name exactly.
5. Only include entities and attributes that were discussed or can be reasonably inferred from the conversation.
6. Do not fabricate entities that have no basis in the conversation.
7. Use the PRODUCT MISSION and TECHNICAL STANDARDS context to inform naming conventions and data types.
8. If the conversation focused primarily on physical entities, ensure corresponding logical entities are derived and mapped.
9. If the conversation focused primarily on logical entities, ensure corresponding physical entities are derived and mapped.
10. Include logicalPhysicalEntityMappings linking each logical entity to its physical counterpart.
11. Include dataEntityRelationships for any FK/association relationships between entities discussed in the conversation.
12. fromEntityType must equal toEntityType -- no cross-type FK links allowed.
13. Include entitiesToDelete ONLY when the user explicitly discussed removing entities.
14. Include relationshipsToDelete ONLY when the user explicitly discussed removing relationships. Use the UUID from the architecture context.
15. entitiesToDelete and relationshipsToDelete may be empty arrays when no deletions were discussed.

## OUTPUT FORMAT
Return ONLY valid JSON matching the schema. No markdown, no prose, no code blocks.
Your entire response must be a single valid JSON object. Do not wrap it in backticks or any other formatting.`;

// Corrective instruction for data model JSON validation retry
const DATA_MODEL_JSON_CORRECTIVE_INSTRUCTION = 'Your last response was not valid JSON matching the data model schema. Return ONLY a single JSON object with arrays for: logicalDataEntities, physicalDataEntities, logicalDataAttributes, physicalDataAttributes, logicalPhysicalEntityMappings, and optional arrays: dataEntityRelationships, entitiesToDelete, relationshipsToDelete. At least one of logicalDataEntities or physicalDataEntities must be a non-empty array with entities that have non-empty name fields, OR entitiesToDelete must be a non-empty array. No markdown, no code blocks.';

/**
 * Validates the shape of a data model JSON payload.
 * Checks that at least one of logicalDataEntities or physicalDataEntities is a non-empty array
 * OR entitiesToDelete is a non-empty array,
 * that all entities have non-empty name fields, and that attribute arrays (if present) reference
 * entity names that exist in the entity arrays.
 * Also validates optional dataEntityRelationships, entitiesToDelete, and relationshipsToDelete arrays.
 *
 * Spec 2026-03-14: Detailed Data Model Task -- End-to-End Fix
 * Task Group 3: validateDataModelJsonShape
 */
export function validateDataModelJsonShape(parsed: unknown): { valid: boolean; error?: string } {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { valid: false, error: 'Expected a JSON object at top level' };
  }

  const obj = parsed as Record<string, unknown>;

  const logicalEntities = Array.isArray(obj.logicalDataEntities) ? obj.logicalDataEntities : [];
  const physicalEntities = Array.isArray(obj.physicalDataEntities) ? obj.physicalDataEntities : [];
  const entitiesToDelete = Array.isArray(obj.entitiesToDelete) ? obj.entitiesToDelete : [];

  // At least one of the entity arrays must be non-empty, OR entitiesToDelete must be non-empty
  if (logicalEntities.length === 0 && physicalEntities.length === 0 && entitiesToDelete.length === 0) {
    return { valid: false, error: 'At least one of logicalDataEntities or physicalDataEntities must be a non-empty array, or entitiesToDelete must be non-empty' };
  }

  // Validate all logical entities have non-empty name fields
  for (let i = 0; i < logicalEntities.length; i++) {
    const entity = logicalEntities[i] as Record<string, unknown>;
    if (!entity || typeof entity !== 'object') {
      return { valid: false, error: `logicalDataEntities[${i}] is not an object` };
    }
    if (typeof entity.name !== 'string' || entity.name.trim() === '') {
      return { valid: false, error: `logicalDataEntities[${i}].name is missing or empty` };
    }
  }

  // Validate all physical entities have non-empty name fields
  for (let i = 0; i < physicalEntities.length; i++) {
    const entity = physicalEntities[i] as Record<string, unknown>;
    if (!entity || typeof entity !== 'object') {
      return { valid: false, error: `physicalDataEntities[${i}] is not an object` };
    }
    if (typeof entity.name !== 'string' || entity.name.trim() === '') {
      return { valid: false, error: `physicalDataEntities[${i}].name is missing or empty` };
    }
  }

  // Collect known entity names for attribute reference validation
  const logicalEntityNames = new Set(
    logicalEntities.map((e: unknown) => (e as { name: string }).name)
  );
  const physicalEntityNames = new Set(
    physicalEntities.map((e: unknown) => (e as { name: string }).name)
  );

  // Validate logicalDataAttributes references (if present)
  if (Array.isArray(obj.logicalDataAttributes)) {
    for (let i = 0; i < obj.logicalDataAttributes.length; i++) {
      const attr = obj.logicalDataAttributes[i] as Record<string, unknown>;
      if (!attr || typeof attr !== 'object') {
        return { valid: false, error: `logicalDataAttributes[${i}] is not an object` };
      }
      if (typeof attr.logicalEntityRef === 'string' && attr.logicalEntityRef.trim() !== '') {
        if (!logicalEntityNames.has(attr.logicalEntityRef)) {
          return { valid: false, error: `logicalDataAttributes[${i}].logicalEntityRef "${attr.logicalEntityRef}" does not match any logical entity name` };
        }
      }
    }
  }

  // Validate physicalDataAttributes references (if present)
  if (Array.isArray(obj.physicalDataAttributes)) {
    for (let i = 0; i < obj.physicalDataAttributes.length; i++) {
      const attr = obj.physicalDataAttributes[i] as Record<string, unknown>;
      if (!attr || typeof attr !== 'object') {
        return { valid: false, error: `physicalDataAttributes[${i}] is not an object` };
      }
      if (typeof attr.physicalEntityRef === 'string' && attr.physicalEntityRef.trim() !== '') {
        if (!physicalEntityNames.has(attr.physicalEntityRef)) {
          return { valid: false, error: `physicalDataAttributes[${i}].physicalEntityRef "${attr.physicalEntityRef}" does not match any physical entity name` };
        }
      }
    }
  }

  // Validate dataEntityRelationships (if present and non-empty)
  if (Array.isArray(obj.dataEntityRelationships)) {
    for (let i = 0; i < obj.dataEntityRelationships.length; i++) {
      const rel = obj.dataEntityRelationships[i] as Record<string, unknown>;
      if (!rel || typeof rel !== 'object') {
        return { valid: false, error: `dataEntityRelationships[${i}] is not an object` };
      }
      if (typeof rel.fromEntityRef !== 'string' || rel.fromEntityRef.trim() === '') {
        return { valid: false, error: `dataEntityRelationships[${i}].fromEntityRef is missing or empty` };
      }
      if (typeof rel.toEntityRef !== 'string' || rel.toEntityRef.trim() === '') {
        return { valid: false, error: `dataEntityRelationships[${i}].toEntityRef is missing or empty` };
      }
      if (typeof rel.fromEntityType !== 'string' || rel.fromEntityType.trim() === '') {
        return { valid: false, error: `dataEntityRelationships[${i}].fromEntityType is missing or empty` };
      }
      if (typeof rel.toEntityType !== 'string' || rel.toEntityType.trim() === '') {
        return { valid: false, error: `dataEntityRelationships[${i}].toEntityType is missing or empty` };
      }
      if (rel.fromEntityType !== rel.toEntityType) {
        return { valid: false, error: `dataEntityRelationships[${i}].fromEntityType (${rel.fromEntityType}) must equal toEntityType (${rel.toEntityType}) -- no cross-type FK links` };
      }
    }
  }

  // Validate entitiesToDelete (if present and non-empty)
  if (Array.isArray(obj.entitiesToDelete)) {
    const validEntityTypes = ['logical_data_entities', 'physical_data_entities'];
    for (let i = 0; i < obj.entitiesToDelete.length; i++) {
      const del = obj.entitiesToDelete[i] as Record<string, unknown>;
      if (!del || typeof del !== 'object') {
        return { valid: false, error: `entitiesToDelete[${i}] is not an object` };
      }
      if (typeof del.name !== 'string' || del.name.trim() === '') {
        return { valid: false, error: `entitiesToDelete[${i}].name is missing or empty` };
      }
      if (typeof del.entityType !== 'string' || !validEntityTypes.includes(del.entityType)) {
        return { valid: false, error: `entitiesToDelete[${i}].entityType must be 'logical_data_entities' or 'physical_data_entities'` };
      }
    }
  }

  // Validate relationshipsToDelete (if present and non-empty)
  if (Array.isArray(obj.relationshipsToDelete)) {
    for (let i = 0; i < obj.relationshipsToDelete.length; i++) {
      const del = obj.relationshipsToDelete[i] as Record<string, unknown>;
      if (!del || typeof del !== 'object') {
        return { valid: false, error: `relationshipsToDelete[${i}] is not an object` };
      }
      if (typeof del.id !== 'string' || del.id.trim() === '') {
        return { valid: false, error: `relationshipsToDelete[${i}].id is missing or empty` };
      }
      if (typeof del.relationshipType !== 'string' || del.relationshipType.trim() === '') {
        return { valid: false, error: `relationshipsToDelete[${i}].relationshipType is missing or empty` };
      }
    }
  }

  return { valid: true };
}

// ============================================================================
// GET /thread Handler (Increment 2, Task Group 2)
// ============================================================================

/**
 * GET /thread handler for retrieving thread history.
 * Mounted at /api/chat/v2/thread in server.ts (via chatV2Router).
 *
 * Accepts query param `key` (serialized thread key string).
 * Returns the full Thread object as JSON, or an empty thread if none exists.
 * Returns 400 if `key` is missing or cannot be parsed.
 */
chatV2Router.get('/thread', async (req: Request, res: Response) => {
  try {
    const key = req.query.key;

    // Validate key query param is present and is a string
    if (!key || typeof key !== 'string') {
      res.status(400).json({
        error: 'Missing required query parameter: key',
      });
      return;
    }

    // Parse the serialized thread key string
    let parsedKey: ThreadKey;
    try {
      parsedKey = parseThreadKey(key);
    } catch (parseError) {
      res.status(400).json({
        error: `Invalid thread key: ${parseError instanceof Error ? parseError.message : 'parse error'}`,
      });
      return;
    }

    // Look up the thread from persistence
    const thread = await getThread(parsedKey);

    if (thread) {
      // Return the existing thread
      res.json(thread);
    } else {
      // Return an empty thread with no messages
      const now = new Date().toISOString();
      const emptyThread: Thread = {
        threadKey: threadKeyToString(parsedKey),
        projectId: parsedKey.projectId,
        messages: [],
        activePersonaId: null,
        activeTaskId: null,
        summary: null,
        summarisedUpToIndex: 0,
        createdAt: now,
        updatedAt: now,
      };
      res.json(emptyThread);
    }
  } catch (error) {
    logger.error('GET /thread failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    res.status(500).json({
      error: 'Internal server error',
    });
  }
});

// ============================================================================
// DELETE /thread Handler
// ============================================================================

/**
 * DELETE /thread handler for clearing a conversation thread.
 * Mounted at /api/chat/v2/thread in server.ts (via chatV2Router).
 *
 * Deletes the thread.json file from disk and clears any picker state.
 *
 * Query param: key (serialized threadKey string)
 * Returns: { success: true }
 * Returns 400 if key is missing or invalid, 500 for errors
 */
chatV2Router.delete('/thread', async (req: Request, res: Response) => {
  try {
    const key = req.query.key;

    if (!key || typeof key !== 'string') {
      res.status(400).json({
        error: 'Missing or invalid query parameter: key',
      });
      return;
    }

    const parsedKey = parseThreadKey(key);
    if (!parsedKey) {
      res.status(400).json({
        error: `Invalid thread key format: ${key}`,
      });
      return;
    }

    logger.debug('DELETE /thread request', { key });

    await deleteThread(parsedKey);

    // Clear any picker state for this thread
    pickerStateMap.delete(key);

    res.json({ success: true });
  } catch (error) {
    logger.error('DELETE /thread failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    res.status(500).json({
      error: 'Internal server error',
    });
  }
});

// ============================================================================
// POST /handoff Handler (Increment 3, Task Group 1)
// ============================================================================

/**
 * POST /handoff handler for persona handoff persistence.
 * Mounted at /api/chat/v2/handoff in server.ts (via chatV2Router).
 *
 * Persists a system-role "Switched to {displayName}" message to the thread
 * so that persona handoff markers survive page reloads.
 *
 * Request body: { threadKey: ThreadKey, personaId: string }
 * Returns: { success: true, threadKey: string } on success
 * Returns 400 if threadKey or personaId is missing/invalid or personaId not in registry
 */
chatV2Router.post('/handoff', async (req: Request, res: Response) => {
  try {
    const { threadKey, personaId } = req.body;

    // ---- Validate threadKey ----
    if (
      !threadKey ||
      typeof threadKey !== 'object' ||
      typeof threadKey.type !== 'string' ||
      typeof threadKey.projectId !== 'string'
    ) {
      res.status(400).json({
        error: 'Missing or invalid threadKey: must be an object with type and projectId',
      });
      return;
    }

    // ---- Validate personaId ----
    if (!personaId || typeof personaId !== 'string') {
      res.status(400).json({
        error: 'Missing or invalid personaId: must be a non-empty string',
      });
      return;
    }

    // ---- Look up personaId in persona registry ----
    const personaRegistry = getPersonaRegistry();
    const persona = personaRegistry.get(personaId);
    if (!persona) {
      res.status(400).json({
        error: `Unknown personaId: ${personaId}`,
      });
      return;
    }

    // ---- Resolve or create the thread ----
    const tk: ThreadKey = threadKey as ThreadKey;
    let thread = await getThread(tk);
    if (!thread) {
      thread = await createThread(tk);
    }

    // ---- Build and persist system handoff message ----
    const systemMessage: ThreadMessage = {
      id: uuidv4(),
      role: 'system',
      personaId: null,
      taskId: null,
      content: `Switched to ${persona.displayName}`,
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };

    await appendMessage(tk, systemMessage);

    logger.info('Persona handoff persisted', {
      threadKey: threadKeyToString(tk),
      personaId,
      displayName: persona.displayName,
    });

    // ---- Return success ----
    res.json({
      success: true,
      threadKey: threadKeyToString(tk),
    });
  } catch (error) {
    logger.error('POST /handoff failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    res.status(500).json({
      error: 'Internal server error',
    });
  }
});

// ============================================================================
// POST /generate Handler (Hub Bootstrap 1, Task Group 2)
// + Hub Bootstrap 2, Task 2.6: artifactType branching (roadmap vs mission)
// + Hub Bootstrap 3, Task 2.4: architecture-baseline branch (LLM + jsonMode + corrective retry)
// + Hub Bootstrap 4, Task 3.6-3.7: tech-stack + test-strategy branches
// + Unify Panel: allowedPersonaIds validation
// ============================================================================

/**
 * POST /generate handler for artifact generation.
 * Mounted at /api/chat/v2/generate in server.ts (via chatV2Router).
 *
 * For mission (default): calls LLM with MISSION_GENERATION_PROMPT_TEMPLATE.
 * For roadmap: extracts proposedInitiatives from thread history (no LLM call).
 * For architecture-baseline: calls LLM with jsonMode, validates JSON, retries on failure.
 * For tech-stack: calls LLM with jsonMode, validates JSON shape, retries on failure.
 * For test-strategy: calls LLM with jsonMode, validates JSON shape, retries on failure.
 *
 * Request body: { threadKey: ThreadKey, personaId: string, taskId: string }
 * Returns: { success: true, artifactContent: string, missionMarkdown?: string } on success
 * Returns: { success: false, error: string } on failure
 * Returns 400 if required fields are missing or thread does not exist
 */
chatV2Router.post('/generate', async (req: Request, res: Response) => {
  const requestId = req.requestId || uuidv4();

  try {
    const { threadKey, personaId, taskId } = req.body;

    // ---- Validate required fields ----
    if (
      !threadKey ||
      typeof threadKey !== 'object' ||
      typeof threadKey.type !== 'string' ||
      typeof threadKey.projectId !== 'string'
    ) {
      res.status(400).json({
        error: 'Missing or invalid threadKey: must be an object with type and projectId',
      });
      return;
    }

    if (!personaId || typeof personaId !== 'string') {
      res.status(400).json({
        error: 'Missing or invalid personaId: must be a non-empty string',
      });
      return;
    }

    // ---- Validate allowedPersonaIds ----
    const { allowedPersonaIds } = req.body;
    if (Array.isArray(allowedPersonaIds) && allowedPersonaIds.length > 0) {
      if (!allowedPersonaIds.includes(personaId)) {
        res.status(400).json({
          error: `Persona not allowed: ${personaId} is not in allowedPersonaIds`,
        });
        return;
      }
    }

    if (!taskId || typeof taskId !== 'string') {
      res.status(400).json({
        error: 'Missing or invalid taskId: must be a non-empty string',
      });
      return;
    }

    // ---- Resolve the thread ----
    const tk: ThreadKey = threadKey as ThreadKey;
    const threadKeyStr = threadKeyToString(tk);
    const thread = await getThread(tk);

    if (!thread) {
      res.status(400).json({
        error: 'Thread not found: no conversation to generate from',
      });
      return;
    }

    logger.info('Generate artifact request received', {
      requestId,
      threadKey: threadKeyStr,
      personaId,
      taskId,
      messageCount: thread.messages.length,
    });

    // ---- Hub Bootstrap 2, Task 2.6: Derive artifactType from task registry ----
    const taskRegistry = getTaskRegistry();
    const taskDef = taskRegistry.get(taskId);
    const artifactType = (taskDef?.artifacts?.[0] as Record<string, unknown>)?.artifactId as string || 'mission-md';

    // ---- Roadmap path: extract proposedInitiatives from thread (no LLM call) ----
    if (artifactType === 'roadmap') {
      let proposedInitiatives: unknown[] | undefined;
      for (let i = thread.messages.length - 1; i >= 0; i--) {
        const msg = thread.messages[i];
        if (msg.role === 'assistant') {
          try {
            const parsedMsg = JSON.parse(typeof msg.content === 'string' ? msg.content : '');
            if (parsedMsg && typeof parsedMsg === 'object' && parsedMsg.proposedInitiatives) {
              proposedInitiatives = parsedMsg.proposedInitiatives;
            }
          } catch {
            // Not valid JSON -- skip
          }
          break;
        }
      }

      if (!proposedInitiatives || proposedInitiatives.length === 0) {
        res.json({
          success: false,
          error: 'No proposed initiatives found in conversation history. Please continue the discovery conversation.',
        });
        return;
      }

      const artifactContent = JSON.stringify({ initiatives: proposedInitiatives });

      logger.info('Generate roadmap artifact succeeded (thread extraction)', {
        requestId,
        threadKey: threadKeyStr,
        initiativeCount: proposedInitiatives.length,
      });

      res.json({ success: true, artifactContent });
      return;
    }

    // ---- Hub Bootstrap 3, Task 2.4: Architecture baseline path ----
    // Direct LLM call with jsonMode, validation, and corrective retry
    if (artifactType === 'architecture-baseline') {
      // Build conversation transcript from thread messages
      const taskMessages: OpenAIMessage[] = thread.messages
        .filter(msg => msg.taskId === taskId && msg.role !== 'system')
        .map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        }));
      const conversationTranscript = buildConversationTranscript(taskMessages);

      // Load MISSION.MD and TECH-STACK.MD content from disk or thread resolvedContext
      const projectFolder = await fetchProjectFolder(tk.projectId);
      const basePath = projectFolder || process.cwd();

      let missionContent = 'Not available';
      try {
        const missionPath = path.join(basePath, 'agent-os', 'product', 'MISSION.MD');
        missionContent = await fs.readFile(missionPath, 'utf-8');
      } catch {
        try {
          const missionPathLower = path.join(basePath, 'agent-os', 'product', 'mission.md');
          missionContent = await fs.readFile(missionPathLower, 'utf-8');
        } catch {
          logger.debug('MISSION.MD not found for architecture baseline generation', { requestId });
        }
      }

      let techStackContent = 'Not available';
      try {
        const techStackPath = path.join(basePath, 'agent-os', 'product', 'TECH-STACK.MD');
        techStackContent = await fs.readFile(techStackPath, 'utf-8');
      } catch {
        try {
          const techStackPathLower = path.join(basePath, 'agent-os', 'product', 'tech-stack.md');
          techStackContent = await fs.readFile(techStackPathLower, 'utf-8');
        } catch {
          logger.debug('TECH-STACK.MD not found for architecture baseline generation', { requestId });
        }
      }

      // Populate the generation prompt template
      const populatedTemplate = ARCHITECTURE_BASELINE_GENERATION_PROMPT_TEMPLATE
        .replace('{missionContent}', missionContent)
        .replace('{techStackContent}', techStackContent)
        .replace('{conversationTranscript}', conversationTranscript);

      // Build generation messages (matching v1 at chat.ts lines 1819-1822)
      const generationMessages: OpenAIMessage[] = [
        { role: 'system', content: populatedTemplate },
        { role: 'user', content: 'Generate the architecture baseline JSON now.' },
      ];

      // Call sendChatRequest with jsonMode (matching v1 at chat.ts line 1831)
      let generationResponse = await getLlmClient().sendChatRequest(
        generationMessages,
        requestId,
        threadKeyStr,
        { jsonMode: true, temperature: 0.2, maxTokens: 64000 }
      );

      // Validate: parse JSON, validateBaselineJsonShape, ensureMinimumServices
      let parsedJson: Record<string, unknown> | null = null;

      // First attempt
      try {
        const firstParsed = JSON.parse(generationResponse.content || '');
        const shapeResult = validateBaselineJsonShape(firstParsed);
        if (!shapeResult.valid) {
          throw new Error(shapeResult.error || 'Structural validation failed');
        }
        parsedJson = ensureMinimumServices(firstParsed as Record<string, unknown>);
      } catch (firstError) {
        // First validation failed: attempt corrective retry
        logger.warn('Architecture baseline JSON first validation failed, attempting corrective retry', {
          requestId,
          threadKey: threadKeyStr,
          error: firstError instanceof Error ? firstError.message : 'Unknown error',
        });

        // Append invalid response and corrective instruction (matching v1 at lines 1856-1866)
        generationMessages.push({ role: 'assistant', content: generationResponse.content || '' });
        generationMessages.push({ role: 'user', content: BASELINE_JSON_CORRECTIVE_INSTRUCTION });

        // Resend once with same options
        generationResponse = await getLlmClient().sendChatRequest(
          generationMessages,
          requestId,
          threadKeyStr,
          { jsonMode: true, temperature: 0.2, maxTokens: 64000 }
        );

        // Second attempt
        try {
          const secondParsed = JSON.parse(generationResponse.content || '');
          const shapeResult = validateBaselineJsonShape(secondParsed);
          if (!shapeResult.valid) {
            throw new Error(shapeResult.error || 'Structural validation failed on retry');
          }
          parsedJson = ensureMinimumServices(secondParsed as Record<string, unknown>);
        } catch (secondError) {
          // Both attempts failed
          logger.error('Architecture baseline JSON validation failed after corrective retry', {
            requestId,
            threadKey: threadKeyStr,
            error: secondError instanceof Error ? secondError.message : 'Unknown validation error',
          });

          res.json({
            success: false,
            error: 'Architecture baseline generation failed after validation retry',
          });
          return;
        }
      }

      // Success: return validated JSON
      logger.info('Generate architecture baseline artifact succeeded', {
        requestId,
        threadKey: threadKeyStr,
      });

      res.json({
        success: true,
        artifactContent: JSON.stringify(parsedJson),
      });
      return;
    }

    // ---- Spec 2026-03-14: Data model generation path ----
    // Direct LLM call with jsonMode, validation, and corrective retry
    if (artifactType === 'data-model') {
      // Build conversation transcript from thread messages
      const taskMessages: OpenAIMessage[] = thread.messages
        .filter(msg => msg.taskId === taskId && msg.role !== 'system')
        .map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        }));
      const conversationTranscript = buildConversationTranscript(taskMessages);

      // Load MISSION.MD and TECH-STACK.MD content from disk
      const projectFolder = await fetchProjectFolder(tk.projectId);
      const basePath = projectFolder || process.cwd();

      let missionContent = 'Not available';
      try {
        const missionPath = path.join(basePath, 'agent-os', 'product', 'MISSION.MD');
        missionContent = await fs.readFile(missionPath, 'utf-8');
      } catch {
        try {
          const missionPathLower = path.join(basePath, 'agent-os', 'product', 'mission.md');
          missionContent = await fs.readFile(missionPathLower, 'utf-8');
        } catch {
          logger.debug('MISSION.MD not found for data model generation', { requestId });
        }
      }

      let techStackContent = 'Not available';
      try {
        const techStackPath = path.join(basePath, 'agent-os', 'product', 'TECH-STACK.MD');
        techStackContent = await fs.readFile(techStackPath, 'utf-8');
      } catch {
        try {
          const techStackPathLower = path.join(basePath, 'agent-os', 'product', 'tech-stack.md');
          techStackContent = await fs.readFile(techStackPathLower, 'utf-8');
        } catch {
          logger.debug('TECH-STACK.MD not found for data model generation', { requestId });
        }
      }

      // Populate the generation prompt template
      const populatedTemplate = DATA_MODEL_GENERATION_PROMPT_TEMPLATE
        .replace('{missionContent}', missionContent)
        .replace('{techStackContent}', techStackContent)
        .replace('{conversationTranscript}', conversationTranscript);

      // Build generation messages
      const generationMessages: OpenAIMessage[] = [
        { role: 'system', content: populatedTemplate },
        { role: 'user', content: 'Generate the data model JSON now.' },
      ];

      // Call sendChatRequest with jsonMode
      let generationResponse = await getLlmClient().sendChatRequest(
        generationMessages,
        requestId,
        threadKeyStr,
        { jsonMode: true, temperature: 0.2, maxTokens: 64000 }
      );

      // Validate: parse JSON, validateDataModelJsonShape
      let parsedJson: Record<string, unknown> | null = null;

      // First attempt
      try {
        const firstParsed = JSON.parse(generationResponse.content || '');
        const shapeResult = validateDataModelJsonShape(firstParsed);
        if (!shapeResult.valid) {
          throw new Error(shapeResult.error || 'Structural validation failed');
        }
        parsedJson = firstParsed as Record<string, unknown>;
      } catch (firstError) {
        // First validation failed: attempt corrective retry
        logger.warn('Data model JSON first validation failed, attempting corrective retry', {
          requestId,
          threadKey: threadKeyStr,
          error: firstError instanceof Error ? firstError.message : 'Unknown error',
        });

        // Append invalid response and corrective instruction
        generationMessages.push({ role: 'assistant', content: generationResponse.content || '' });
        generationMessages.push({ role: 'user', content: DATA_MODEL_JSON_CORRECTIVE_INSTRUCTION });

        // Resend once with same options
        generationResponse = await getLlmClient().sendChatRequest(
          generationMessages,
          requestId,
          threadKeyStr,
          { jsonMode: true, temperature: 0.2, maxTokens: 64000 }
        );

        // Second attempt
        try {
          const secondParsed = JSON.parse(generationResponse.content || '');
          const shapeResult = validateDataModelJsonShape(secondParsed);
          if (!shapeResult.valid) {
            throw new Error(shapeResult.error || 'Structural validation failed on retry');
          }
          parsedJson = secondParsed as Record<string, unknown>;
        } catch (secondError) {
          // Both attempts failed
          logger.error('Data model JSON validation failed after corrective retry', {
            requestId,
            threadKey: threadKeyStr,
            error: secondError instanceof Error ? secondError.message : 'Unknown validation error',
          });

          res.json({
            success: false,
            error: 'Data model generation failed after validation retry',
          });
          return;
        }
      }

      // Success: return validated JSON
      logger.info('Generate data model artifact succeeded', {
        requestId,
        threadKey: threadKeyStr,
      });

      res.json({
        success: true,
        artifactContent: JSON.stringify(parsedJson),
      });
      return;
    }

    // ---- Hub Bootstrap 4, Task 3.6: Tech stack generation path ----
    // Direct LLM call with jsonMode, validation, and corrective retry
    if (artifactType === 'tech-stack') {
      const taskMessages: OpenAIMessage[] = thread.messages
        .filter(msg => msg.taskId === taskId && msg.role !== 'system')
        .map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        }));
      const conversationTranscript = buildConversationTranscript(taskMessages);

      const techGenFolder = await fetchProjectFolder(tk.projectId);
      const techGenBasePath = techGenFolder || process.cwd();

      let missionContent = 'Not available';
      try {
        missionContent = await fs.readFile(path.join(techGenBasePath, 'agent-os', 'product', 'MISSION.MD'), 'utf-8');
      } catch {
        try {
          missionContent = await fs.readFile(path.join(techGenBasePath, 'agent-os', 'product', 'mission.md'), 'utf-8');
        } catch {
          logger.debug('MISSION.MD not found for tech stack generation', { requestId });
        }
      }

      let architectureContext = 'Not available';
      try {
        // Spec 2026-05-01 Multi-Architecture Plumbing - Task Group 3:
        // resolve project's Default architecture before the Bucket A call.
        const archIdForTechGen = await resolveDefaultArchitectureId(tk.projectId);
        if (archIdForTechGen) {
          const metaModel = await fetchMetaModelSummary(tk.projectId, archIdForTechGen);
          if (metaModel) {
            architectureContext = JSON.stringify(metaModel);
          }
        }
      } catch {
        logger.debug('fetchMetaModelSummary failed for tech stack generation', { requestId });
      }

      let existingTechStack = 'Not available';
      try {
        existingTechStack = await fs.readFile(path.join(techGenBasePath, 'agent-os', 'product', 'TECH-STACK.MD'), 'utf-8');
      } catch {
        try {
          existingTechStack = await fs.readFile(path.join(techGenBasePath, 'agent-os', 'product', 'tech-stack.md'), 'utf-8');
        } catch {
          logger.debug('TECH-STACK.MD not found for tech stack generation', { requestId });
        }
      }

      const populatedTemplate = TECH_STACK_GENERATION_PROMPT_TEMPLATE
        .replace('{missionContent}', missionContent)
        .replace('{architectureContext}', architectureContext)
        .replace('{existingTechStack}', existingTechStack)
        .replace('{conversationTranscript}', conversationTranscript);

      const generationMessages: OpenAIMessage[] = [
        { role: 'system', content: populatedTemplate },
        { role: 'user', content: 'Generate the tech stack JSON now.' },
      ];

      let generationResponse = await getLlmClient().sendChatRequest(
        generationMessages,
        requestId,
        threadKeyStr,
        { jsonMode: true, temperature: 0.2, maxTokens: 16000 }
      );

      let parsedJson: Record<string, unknown> | null = null;

      // First attempt
      try {
        const firstParsed = JSON.parse(generationResponse.content || '');
        const shapeResult = validateTechStackJsonShape(firstParsed);
        if (!shapeResult.valid) {
          throw new Error(shapeResult.error || 'Structural validation failed');
        }
        parsedJson = firstParsed as Record<string, unknown>;
      } catch (firstError) {
        logger.warn('Tech stack JSON first validation failed, attempting corrective retry', {
          requestId,
          threadKey: threadKeyStr,
          error: firstError instanceof Error ? firstError.message : 'Unknown error',
        });

        generationMessages.push({ role: 'assistant', content: generationResponse.content || '' });
        generationMessages.push({ role: 'user', content: TECH_STACK_JSON_CORRECTIVE_INSTRUCTION });

        generationResponse = await getLlmClient().sendChatRequest(
          generationMessages,
          requestId,
          threadKeyStr,
          { jsonMode: true, temperature: 0.2, maxTokens: 16000 }
        );

        // Second attempt
        try {
          const secondParsed = JSON.parse(generationResponse.content || '');
          const shapeResult = validateTechStackJsonShape(secondParsed);
          if (!shapeResult.valid) {
            throw new Error(shapeResult.error || 'Structural validation failed on retry');
          }
          parsedJson = secondParsed as Record<string, unknown>;
        } catch (secondError) {
          logger.error('Tech stack JSON validation failed after corrective retry', {
            requestId,
            threadKey: threadKeyStr,
            error: secondError instanceof Error ? secondError.message : 'Unknown validation error',
          });

          res.json({
            success: false,
            error: 'Tech stack generation failed after validation retry',
          });
          return;
        }
      }

      logger.info('Generate tech stack artifact succeeded', {
        requestId,
        threadKey: threadKeyStr,
      });

      res.json({
        success: true,
        artifactContent: JSON.stringify(parsedJson),
      });
      return;
    }

    // ---- Hub Bootstrap 4, Task 3.7: Test strategy generation path ----
    // Direct LLM call with jsonMode, validation, and corrective retry
    if (artifactType === 'test-strategy') {
      const taskMessages: OpenAIMessage[] = thread.messages
        .filter(msg => msg.taskId === taskId && msg.role !== 'system')
        .map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        }));
      const conversationTranscript = buildConversationTranscript(taskMessages);

      const testStratGenFolder = await fetchProjectFolder(tk.projectId);
      const testStratGenBasePath = testStratGenFolder || process.cwd();

      let missionContent = 'Not available';
      try {
        missionContent = await fs.readFile(path.join(testStratGenBasePath, 'agent-os', 'product', 'MISSION.MD'), 'utf-8');
      } catch {
        try {
          missionContent = await fs.readFile(path.join(testStratGenBasePath, 'agent-os', 'product', 'mission.md'), 'utf-8');
        } catch {
          logger.debug('MISSION.MD not found for test strategy generation', { requestId });
        }
      }

      let roadmapContext = 'Not available';
      try {
        const productSummary = await fetchProductSummary(tk.projectId);
        if (productSummary) {
          roadmapContext = buildRoadmapSummary(productSummary);
        }
      } catch {
        logger.debug('fetchProductSummary failed for test strategy generation', { requestId });
      }

      let techStackContent = 'Not available';
      try {
        techStackContent = await fs.readFile(path.join(testStratGenBasePath, 'agent-os', 'product', 'TECH-STACK.MD'), 'utf-8');
      } catch {
        try {
          techStackContent = await fs.readFile(path.join(testStratGenBasePath, 'agent-os', 'product', 'tech-stack.md'), 'utf-8');
        } catch {
          logger.debug('TECH-STACK.MD not found for test strategy generation', { requestId });
        }
      }

      const populatedTemplate = TEST_STRATEGY_GENERATION_PROMPT_TEMPLATE
        .replace('{missionContent}', missionContent)
        .replace('{roadmapContext}', roadmapContext)
        .replace('{techStackContent}', techStackContent)
        .replace('{conversationTranscript}', conversationTranscript);

      const generationMessages: OpenAIMessage[] = [
        { role: 'system', content: populatedTemplate },
        { role: 'user', content: 'Generate the test strategy JSON now.' },
      ];

      let generationResponse = await getLlmClient().sendChatRequest(
        generationMessages,
        requestId,
        threadKeyStr,
        { jsonMode: true, temperature: 0.2, maxTokens: 16000 }
      );

      let parsedJson: Record<string, unknown> | null = null;

      // First attempt
      try {
        const firstParsed = JSON.parse(generationResponse.content || '');
        const shapeResult = validateTestStrategyJsonShape(firstParsed);
        if (!shapeResult.valid) {
          throw new Error(shapeResult.error || 'Structural validation failed');
        }
        parsedJson = firstParsed as Record<string, unknown>;
      } catch (firstError) {
        logger.warn('Test strategy JSON first validation failed, attempting corrective retry', {
          requestId,
          threadKey: threadKeyStr,
          error: firstError instanceof Error ? firstError.message : 'Unknown error',
        });

        generationMessages.push({ role: 'assistant', content: generationResponse.content || '' });
        generationMessages.push({ role: 'user', content: TEST_STRATEGY_JSON_CORRECTIVE_INSTRUCTION });

        generationResponse = await getLlmClient().sendChatRequest(
          generationMessages,
          requestId,
          threadKeyStr,
          { jsonMode: true, temperature: 0.2, maxTokens: 16000 }
        );

        // Second attempt
        try {
          const secondParsed = JSON.parse(generationResponse.content || '');
          const shapeResult = validateTestStrategyJsonShape(secondParsed);
          if (!shapeResult.valid) {
            throw new Error(shapeResult.error || 'Structural validation failed on retry');
          }
          parsedJson = secondParsed as Record<string, unknown>;
        } catch (secondError) {
          logger.error('Test strategy JSON validation failed after corrective retry', {
            requestId,
            threadKey: threadKeyStr,
            error: secondError instanceof Error ? secondError.message : 'Unknown validation error',
          });

          res.json({
            success: false,
            error: 'Test strategy generation failed after validation retry',
          });
          return;
        }
      }

      logger.info('Generate test strategy artifact succeeded', {
        requestId,
        threadKey: threadKeyStr,
      });

      res.json({
        success: true,
        artifactContent: JSON.stringify(parsedJson),
      });
      return;
    }

    // ---- Users & Interactions generation path ----
    // Direct LLM call with jsonMode to extract business users, processes, activities, and UI screens
    if (artifactType === 'users-interactions') {
      const taskMessages: OpenAIMessage[] = thread.messages
        .filter(msg => msg.taskId === taskId && msg.role !== 'system')
        .map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        }));
      const conversationTranscript = buildConversationTranscript(taskMessages);

      const populatedTemplate = USERS_INTERACTIONS_GENERATION_PROMPT_TEMPLATE
        .replace('{conversationTranscript}', conversationTranscript);

      const generationMessages: OpenAIMessage[] = [
        { role: 'system', content: populatedTemplate },
        { role: 'user', content: 'Generate the users & interactions JSON now.' },
      ];

      let generationResponse = await getLlmClient().sendChatRequest(
        generationMessages,
        requestId,
        threadKeyStr,
        { jsonMode: true, temperature: 0.2, maxTokens: 16000 }
      );

      let parsedJson: Record<string, unknown> | null = null;

      // First attempt
      try {
        const firstParsed = JSON.parse(generationResponse.content || '');
        if (!firstParsed || typeof firstParsed !== 'object') {
          throw new Error('Expected a JSON object at top level');
        }
        parsedJson = firstParsed as Record<string, unknown>;
      } catch (firstError) {
        logger.warn('Users & interactions JSON first validation failed, attempting corrective retry', {
          requestId,
          threadKey: threadKeyStr,
          error: firstError instanceof Error ? firstError.message : 'Unknown error',
        });

        generationMessages.push({ role: 'assistant', content: generationResponse.content || '' });
        generationMessages.push({ role: 'user', content: 'The previous response was not valid JSON. Please return ONLY a valid JSON object with business_users, business_processes, process_activities, and ui_screens arrays. No markdown, no prose.' });

        generationResponse = await getLlmClient().sendChatRequest(
          generationMessages,
          requestId,
          threadKeyStr,
          { jsonMode: true, temperature: 0.2, maxTokens: 16000 }
        );

        // Second attempt
        try {
          const secondParsed = JSON.parse(generationResponse.content || '');
          if (!secondParsed || typeof secondParsed !== 'object') {
            throw new Error('Expected a JSON object at top level');
          }
          parsedJson = secondParsed as Record<string, unknown>;
        } catch (secondError) {
          logger.error('Users & interactions JSON validation failed after corrective retry', {
            requestId,
            threadKey: threadKeyStr,
            error: secondError instanceof Error ? secondError.message : 'Unknown validation error',
          });

          res.json({
            success: false,
            error: 'Users & interactions generation failed after validation retry',
          });
          return;
        }
      }

      logger.info('Generate users & interactions artifact succeeded', {
        requestId,
        threadKey: threadKeyStr,
      });

      res.json({
        success: true,
        artifactContent: JSON.stringify(parsedJson),
      });
      return;
    }

    // ---- User Journeys generation path ----
    // Direct LLM call with jsonMode to extract user journeys and activity steps
    if (artifactType === 'user-journeys') {
      const taskMessages: OpenAIMessage[] = thread.messages
        .filter(msg => msg.taskId === taskId && msg.role !== 'system')
        .map(msg => ({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        }));
      const conversationTranscript = buildConversationTranscript(taskMessages);

      const populatedTemplate = USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE
        .replace('{conversationTranscript}', conversationTranscript);

      const generationMessages: OpenAIMessage[] = [
        { role: 'system', content: populatedTemplate },
        { role: 'user', content: 'Generate the process activities, user journeys, activity steps, and user journey links JSON now.' },
      ];

      let generationResponse = await getLlmClient().sendChatRequest(
        generationMessages,
        requestId,
        threadKeyStr,
        { jsonMode: true, temperature: 0.2, maxTokens: 16000 }
      );

      let parsedJson: Record<string, unknown> | null = null;

      // First attempt
      try {
        const firstParsed = JSON.parse(generationResponse.content || '');
        if (!firstParsed || typeof firstParsed !== 'object') {
          throw new Error('Expected a JSON object at top level');
        }
        parsedJson = firstParsed as Record<string, unknown>;
      } catch (firstError) {
        logger.warn('User journeys JSON first validation failed, attempting corrective retry', {
          requestId,
          threadKey: threadKeyStr,
          error: firstError instanceof Error ? firstError.message : 'Unknown error',
        });

        generationMessages.push({ role: 'assistant', content: generationResponse.content || '' });
        generationMessages.push({ role: 'user', content: 'The previous response was not valid JSON. Please return ONLY a valid JSON object with process_activities, user_journeys, activity_steps, and user_journey_links arrays. No markdown, no prose.' });

        generationResponse = await getLlmClient().sendChatRequest(
          generationMessages,
          requestId,
          threadKeyStr,
          { jsonMode: true, temperature: 0.2, maxTokens: 16000 }
        );

        // Second attempt
        try {
          const secondParsed = JSON.parse(generationResponse.content || '');
          if (!secondParsed || typeof secondParsed !== 'object') {
            throw new Error('Expected a JSON object at top level');
          }
          parsedJson = secondParsed as Record<string, unknown>;
        } catch (secondError) {
          logger.error('User journeys JSON validation failed after corrective retry', {
            requestId,
            threadKey: threadKeyStr,
            error: secondError instanceof Error ? secondError.message : 'Unknown validation error',
          });

          res.json({
            success: false,
            error: 'User journeys generation failed after validation retry',
          });
          return;
        }
      }

      // Deterministic injection: read extracted process activities from
      // thread metadata (stored at XLSX intercept time in Step 1b).
      if (thread.metadata?.extractedProcessActivities && parsedJson) {
        const extractedPAs = thread.metadata.extractedProcessActivities as unknown[];
        if (Array.isArray(extractedPAs) && extractedPAs.length > 0) {
          (parsedJson as any).process_activities = extractedPAs;
          logger.info('Injected deterministic process_activities from thread metadata', {
            requestId,
            count: extractedPAs.length,
          });
        }
      }

      logger.info('Generate user journeys artifact succeeded', {
        requestId,
        threadKey: threadKeyStr,
      });

      res.json({
        success: true,
        artifactContent: JSON.stringify(parsedJson),
      });
      return;
    }

    // ---- Backlog path: extract proposedFeatures + selectedEpic from thread (no LLM call) ----
    if (artifactType === 'backlog') {
      let proposedFeatures: unknown[] | undefined;
      let selectedEpic: unknown | undefined;
      let epicPriorityUpdates: unknown[] | undefined;
      let deletedWorkItemIds: unknown[] | undefined;

      for (let i = thread.messages.length - 1; i >= 0; i--) {
        const msg = thread.messages[i];
        if (msg.role === 'assistant') {
          try {
            const parsedMsg = JSON.parse(typeof msg.content === 'string' ? msg.content : '');
            if (parsedMsg && typeof parsedMsg === 'object') {
              if (parsedMsg.proposedFeatures) {
                proposedFeatures = parsedMsg.proposedFeatures;
              }
              if (parsedMsg.selectedEpic) {
                selectedEpic = parsedMsg.selectedEpic;
              }
              if (parsedMsg.epicPriorityUpdates) {
                epicPriorityUpdates = parsedMsg.epicPriorityUpdates;
              }
              if (parsedMsg.deletedWorkItemIds && Array.isArray(parsedMsg.deletedWorkItemIds)) {
                deletedWorkItemIds = parsedMsg.deletedWorkItemIds;
              }
            }
          } catch {
            // Not valid JSON -- skip
          }
          break;
        }
      }

      if (!proposedFeatures || proposedFeatures.length === 0) {
        res.json({
          success: false,
          error: 'No proposed features found in conversation history. Please continue the discovery conversation.',
        });
        return;
      }

      if (!selectedEpic) {
        res.json({
          success: false,
          error: 'No selected epic found in conversation history. Please confirm an epic before generating.',
        });
        return;
      }

      const selectedEpicObj = selectedEpic as Record<string, unknown>;
      const artifactContent = JSON.stringify({
        epicId: selectedEpicObj.id || '',
        epicTitle: selectedEpicObj.title || '',
        features: proposedFeatures,
        deletedWorkItemIds: deletedWorkItemIds || [],
        epicPriorityUpdates: epicPriorityUpdates || [],
      });

      logger.info('Generate backlog artifact succeeded (thread extraction)', {
        requestId,
        threadKey: threadKeyStr,
        featureCount: proposedFeatures.length,
        epicId: selectedEpicObj.id,
      });

      res.json({ success: true, artifactContent });
      return;
    }

    // ---- Phase 0 Completion: Discovery framing deterministic extraction ----
    if (artifactType === 'discovery-framing') {
      let structuredData: Record<string, unknown> | undefined;

      for (let i = thread.messages.length - 1; i >= 0; i--) {
        const msg = thread.messages[i];
        if (msg.role === 'assistant') {
          try {
            // Check structuredResponse first, then parse content
            const parsed = msg.structuredResponse && typeof msg.structuredResponse === 'object'
              ? msg.structuredResponse as Record<string, unknown>
              : JSON.parse(typeof msg.content === 'string' ? msg.content : '');

            if (parsed && parsed.phase === 'ready') {
              structuredData = {
                summary: parsed.summary,
                applications: parsed.applications || [],
                appComponents: parsed.appComponents || [],
                repos: parsed.repos || [],
                repoApplicationMappings: parsed.repoApplicationMappings || [],
                techHints: parsed.techHints || [],
                exclusions: parsed.exclusions || [],
                notes: parsed.notes || [],
              };
              break;
            }
          } catch {
            // Not valid JSON -- skip
          }
        }
      }

      if (!structuredData) {
        res.json({
          success: false,
          error: 'No completed discovery framing found in conversation history. Please complete the final review first.',
        });
        return;
      }

      const markdownBrief = convertDiscoveryBriefToMarkdown(structuredData);
      const artifactContent = JSON.stringify({ structuredData, markdownBrief });

      logger.info('Generate discovery-framing artifact succeeded (thread extraction)', {
        requestId,
        threadKey: threadKeyStr,
        applicationCount: ((structuredData.applications || []) as unknown[]).length,
      });

      res.json({ success: true, artifactContent });
      return;
    }


    // ---- OAS spec path: extract spec from conversation (no LLM call) ----
    if (artifactType === 'oas-spec') {
      let oasContent: string | undefined;
      let interfaceName = 'interface';
      let preferredFormat = 'yaml';

      // Scan messages in reverse to find the phase="ready" response with the spec
      for (let i = thread.messages.length - 1; i >= 0; i--) {
        const msg = thread.messages[i];
        if (msg.role === 'assistant') {
          try {
            const parsed = msg.structuredResponse && typeof msg.structuredResponse === 'object'
              ? msg.structuredResponse as Record<string, unknown>
              : JSON.parse(typeof msg.content === 'string' ? msg.content : '');

            if (parsed && parsed.phase === 'ready' && typeof parsed.summary === 'string') {
              oasContent = parsed.summary as string;
              if (typeof parsed.interfaceName === 'string') {
                interfaceName = (parsed.interfaceName as string).replace(/[^a-zA-Z0-9_-]/g, '-');
              }
              if (typeof parsed.preferredFormat === 'string') {
                preferredFormat = parsed.preferredFormat as string;
              }
              break;
            }
          } catch {
            // Not valid JSON -- skip
          }
        }
      }

      if (!oasContent) {
        res.json({
          success: false,
          error: 'No completed OAS spec found in conversation history. Please complete the final review first.',
        });
        return;
      }

      // Return the spec content with metadata for the save adapter
      const artifactContent = JSON.stringify({ oasContent, interfaceName, preferredFormat });

      logger.info('Generate oas-spec artifact succeeded (thread extraction)', {
        requestId,
        threadKey: threadKeyStr,
        interfaceName,
        preferredFormat,
        oasContentLength: oasContent.length,
      });

      res.json({ success: true, artifactContent });
      return;
    }

    // ---- Mission path (existing): LLM-based generation ----

    // ---- Build transcript messages ----
    // Filter to messages for this task, skip system messages, map to OpenAI format
    const transcriptMessages: OpenAIMessage[] = thread.messages
      .filter(msg => msg.taskId === taskId && msg.role !== 'system')
      .map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }));

    // ---- Build generation messages array ----
    const generationMessages: OpenAIMessage[] = [
      { role: 'system', content: MISSION_GENERATION_PROMPT_TEMPLATE },
      ...transcriptMessages,
      { role: 'user', content: 'Generate the MISSION.MD now.' },
    ];

    // ---- Restrict tools to only save_product_artifacts ----
    const saveProductArtifactsTool = (TOOL_DEFINITIONS as ToolDefinition[]).filter(
      t => t.function.name === 'save_product_artifacts'
    );

    // ---- Call sendChatRequest with forced tool call ----
    const generationResponse = await getLlmClient().sendChatRequest(
      generationMessages,
      requestId,
      threadKeyStr,
      {
        tools: saveProductArtifactsTool,
        toolChoice: { type: 'function', function: { name: 'save_product_artifacts' } },
      }
    );

    // ---- Extract missionMarkdown from tool call ----
    const toolCalls = generationResponse.toolCalls || [];
    if (toolCalls.length === 0) {
      logger.warn('Generate: LLM did not return a tool call', {
        requestId,
        threadKey: threadKeyStr,
        hasContent: !!generationResponse.content,
      });

      res.json({
        success: false,
        error: 'LLM did not return a tool call with mission content. Please try again.',
      });
      return;
    }

    const toolCall = toolCalls[0];
    const missionMarkdown = toolCall.arguments?.missionMarkdown as string | undefined;

    if (!missionMarkdown || typeof missionMarkdown !== 'string') {
      logger.warn('Generate: tool call missing missionMarkdown argument', {
        requestId,
        threadKey: threadKeyStr,
        toolName: toolCall.name,
        argKeys: Object.keys(toolCall.arguments || {}),
      });

      res.json({
        success: false,
        error: 'LLM tool call did not include missionMarkdown content. Please try again.',
      });
      return;
    }

    logger.info('Generate artifact succeeded', {
      requestId,
      threadKey: threadKeyStr,
      missionMarkdownLength: missionMarkdown.length,
    });

    // ---- Return success with generated content ----
    // Hub Bootstrap 2: return artifactContent alongside missionMarkdown for backward compat
    res.json({
      success: true,
      missionMarkdown,
      artifactContent: missionMarkdown,
    });
  } catch (error) {
    logger.error('POST /generate failed', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    res.status(500).json({
      error: 'Internal server error',
    });
  }
});

// ============================================================================
// POST /save-artifact Handler (Hub Bootstrap 1, Task Group 2)
// + Hub Bootstrap 2, Task 2.7: Adapter pattern for roadmap vs mission
// + Hub Bootstrap 3, Task 2.5: Architecture baseline adapter with defense-in-depth
// + Hub Bootstrap 4, Task 3.8-3.9: Tech stack + test strategy adapters with JSON-to-markdown
// + Unify Panel: allowedPersonaIds validation
// ============================================================================

/**
 * POST /save-artifact handler for persisting a generated artifact.
 * Mounted at /api/chat/v2/save-artifact in server.ts (via chatV2Router).
 *
 * Uses adapter pattern to route to the correct MCP tool based on artifactType:
 * - Mission: save_product_artifacts with { projectParentFolder, projectId, productName, missionMarkdown, overwrite }
 * - Roadmap: save_roadmap_structure with { projectId, roadmapJson }
 * - Architecture baseline: save_architecture_baseline with { projectId, architectureBaselineJson }
 * - Tech stack: save_markdown_artifact with { projectId, artifactFilename: 'TECH-STACK.MD', markdown }
 * - Test strategy: save_markdown_artifact with { projectId, artifactFilename: 'TEST-STRATEGY.MD', markdown }
 *
 * Request body: { threadKey: ThreadKey, taskId: string, artifactId: string, content: string }
 * Returns: { success: true } on success
 * Returns: { success: false, error: string } on failure
 * Returns 400 if required fields are missing
 */
chatV2Router.post('/save-artifact', async (req: Request, res: Response) => {
  const requestId = req.requestId || uuidv4();

  try {
    const { threadKey, taskId, artifactId, content } = req.body;

    // ---- Validate required fields ----
    if (
      !threadKey ||
      typeof threadKey !== 'object' ||
      typeof threadKey.type !== 'string' ||
      typeof threadKey.projectId !== 'string'
    ) {
      res.status(400).json({
        error: 'Missing or invalid threadKey: must be an object with type and projectId',
      });
      return;
    }

    if (!taskId || typeof taskId !== 'string') {
      res.status(400).json({
        error: 'Missing or invalid taskId: must be a non-empty string',
      });
      return;
    }

    if (!artifactId || typeof artifactId !== 'string') {
      res.status(400).json({
        error: 'Missing or invalid artifactId: must be a non-empty string',
      });
      return;
    }

    if (!content || typeof content !== 'string' || content.trim() === '') {
      res.status(400).json({
        error: 'Missing or invalid content: must be a non-empty string',
      });
      return;
    }

    const tk: ThreadKey = threadKey as ThreadKey;
    const threadKeyStr = threadKeyToString(tk);

    logger.info('Save artifact request received', {
      requestId,
      threadKey: threadKeyStr,
      taskId,
      artifactId,
      contentLength: content.length,
    });

    // ---- Hub Bootstrap 2, Task 2.7: Derive artifactType from task registry ----
    const taskRegistry = getTaskRegistry();
    const taskDef = taskRegistry.get(taskId);
    const artifactType = (taskDef?.artifacts?.[0] as Record<string, unknown>)?.artifactId as string || 'mission-md';

    // ---- Validate allowedPersonaIds against task's personaId ----
    const { allowedPersonaIds } = req.body;
    if (Array.isArray(allowedPersonaIds) && allowedPersonaIds.length > 0) {
      // Resolve personaId from the task definition
      const taskPersonaId = taskDef?.personaId;
      if (taskPersonaId && !allowedPersonaIds.includes(taskPersonaId)) {
        res.status(400).json({
          error: `Persona not allowed: ${taskPersonaId} is not in allowedPersonaIds`,
        });
        return;
      }
    }

    // ---- Resolve projectId from threadKey ----
    const projectId = tk.projectId;

    // ---- Generate fresh mcpSessionId ----
    const mcpSessionId = uuidv4();

    // ---- Adapter pattern: route to correct MCP tool based on artifactType ----
    let toolResult;
    let completionContent: string;
    let completionArtifactId: string;
    let completionArtifactName: string;

    // Resolve the project's actual filesystem folder for all artifact save operations
    const saveProjectFolder = await fetchProjectFolder(projectId);
    const projectParentFolder = saveProjectFolder || process.cwd();

    if (artifactType === 'roadmap') {
      // Roadmap adapter: call save_roadmap_structure with { projectId, roadmapJson }
      toolResult = await executeToolCall(
        uuidv4(),
        'save_roadmap_structure',
        { projectId, roadmapJson: content },
        mcpSessionId,
        requestId,
        'v2-save-' + threadKeyStr,
      );
      completionContent = 'Roadmap complete.';
      completionArtifactId = 'roadmap';
      completionArtifactName = 'ROADMAP';
    } else if (artifactType === 'architecture-baseline') {
      // ---- Hub Bootstrap 3, Task 2.5: Architecture baseline adapter ----
      // Defense-in-depth: validate content before calling MCP tool
      let parsedContent: Record<string, unknown>;
      try {
        parsedContent = JSON.parse(content);
      } catch (parseErr) {
        res.json({
          success: false,
          error: `Architecture baseline content is not valid JSON: ${parseErr instanceof Error ? parseErr.message : 'parse error'}`,
        });
        return;
      }

      const shapeResult = validateBaselineJsonShape(parsedContent);
      if (!shapeResult.valid) {
        res.json({
          success: false,
          error: `Architecture baseline validation failed: ${shapeResult.error}`,
        });
        return;
      }

      ensureMinimumServices(parsedContent);

      // Call save_architecture_baseline MCP tool
      toolResult = await executeToolCall(
        uuidv4(),
        'save_architecture_baseline',
        { projectId, architectureBaselineJson: content },
        mcpSessionId,
        requestId,
        'v2-save-' + threadKeyStr,
      );
      completionContent = 'Architecture Baseline complete.';
      completionArtifactId = 'architecture-baseline';
      completionArtifactName = 'ARCHITECTURE_BASELINE';
    } else if (artifactType === 'data-model') {
      // ---- Spec 2026-03-14: Data model adapter ----
      // Parse JSON, validate shape, call save_architecture_baseline
      let parsedContent: Record<string, unknown>;
      try {
        parsedContent = JSON.parse(content);
      } catch (parseErr) {
        res.json({
          success: false,
          error: `Data model content is not valid JSON: ${parseErr instanceof Error ? parseErr.message : 'parse error'}`,
        });
        return;
      }

      const shapeResult = validateDataModelJsonShape(parsedContent);
      if (!shapeResult.valid) {
        res.json({
          success: false,
          error: `Data model validation failed: ${shapeResult.error}`,
        });
        return;
      }

      // Call save_architecture_baseline MCP tool
      toolResult = await executeToolCall(
        uuidv4(),
        'save_architecture_baseline',
        { projectId, architectureBaselineJson: content },
        mcpSessionId,
        requestId,
        'v2-save-' + threadKeyStr,
      );
      completionContent = 'Data Model complete.';
      completionArtifactId = 'data-model';
      completionArtifactName = 'DATA_MODEL';
    } else if (artifactType === 'tech-stack') {
      // ---- Hub Bootstrap 4, Task 3.8: Tech stack adapter ----
      // Parse JSON, convert to markdown, call save_markdown_artifact
      let parsedContent: Record<string, unknown>;
      try {
        parsedContent = JSON.parse(content);
      } catch (parseErr) {
        res.json({
          success: false,
          error: `Tech stack content is not valid JSON: ${parseErr instanceof Error ? parseErr.message : 'parse error'}`,
        });
        return;
      }

      const markdown = convertTechStackToMarkdown(parsedContent);

      toolResult = await executeToolCall(
        uuidv4(),
        'save_markdown_artifact',
        { projectId, projectParentFolder, artifactFilename: 'TECH-STACK.MD', markdown },
        mcpSessionId,
        requestId,
        'v2-save-' + threadKeyStr,
      );
      completionContent = 'Tech Stack complete.';
      completionArtifactId = 'tech-stack';
      completionArtifactName = 'TECH-STACK.MD';
    } else if (artifactType === 'test-strategy') {
      // ---- Hub Bootstrap 4, Task 3.9: Test strategy adapter ----
      // Parse JSON, convert to markdown, call save_markdown_artifact
      let parsedContent: Record<string, unknown>;
      try {
        parsedContent = JSON.parse(content);
      } catch (parseErr) {
        res.json({
          success: false,
          error: `Test strategy content is not valid JSON: ${parseErr instanceof Error ? parseErr.message : 'parse error'}`,
        });
        return;
      }

      const markdown = convertTestStrategyToMarkdown(parsedContent);

      toolResult = await executeToolCall(
        uuidv4(),
        'save_markdown_artifact',
        { projectId, projectParentFolder, artifactFilename: 'TEST-STRATEGY.MD', markdown },
        mcpSessionId,
        requestId,
        'v2-save-' + threadKeyStr,
      );
      completionContent = 'Test Strategy complete.';
      completionArtifactId = 'test-strategy';
      completionArtifactName = 'TEST-STRATEGY.MD';
    } else if (artifactType === 'users-interactions') {
      // ---- Users & Interactions adapter ----
      // Call save_users_interactions MCP tool
      toolResult = await executeToolCall(
        uuidv4(),
        'save_users_interactions',
        { projectId, usersInteractionsJson: content },
        mcpSessionId,
        requestId,
        'v2-save-' + threadKeyStr,
      );
      completionContent = 'Users & Interactions saved to architecture.';
      completionArtifactId = 'users-interactions';
      completionArtifactName = 'USERS_INTERACTIONS';
    } else if (artifactType === 'user-journeys') {
      // ---- User Journeys adapter ----
      // Call save_user_journeys MCP tool
      toolResult = await executeToolCall(
        uuidv4(),
        'save_user_journeys',
        { projectId, userJourneysJson: content },
        mcpSessionId,
        requestId,
        'v2-save-' + threadKeyStr,
      );
      completionContent = 'User journeys and activity steps saved to architecture.';
      completionArtifactId = 'user-journeys';
      completionArtifactName = 'USER_JOURNEYS';
    } else if (artifactType === 'backlog') {
      // ---- Backlog adapter ----
      // Parse and validate, then call save_backlog_items MCP tool
      let parsedContent: Record<string, unknown>;
      try {
        parsedContent = JSON.parse(content);
      } catch (parseErr) {
        res.json({
          success: false,
          error: `Backlog content is not valid JSON: ${parseErr instanceof Error ? parseErr.message : 'parse error'}`,
        });
        return;
      }

      // Call save_backlog_items MCP tool
      toolResult = await executeToolCall(
        uuidv4(),
        'save_backlog_items',
        { projectId, backlogJson: content },
        mcpSessionId,
        requestId,
        'v2-save-' + threadKeyStr,
      );
      completionContent = 'Backlog complete.';
      completionArtifactId = 'backlog';
      completionArtifactName = 'BACKLOG';
    } else if (artifactType === 'discovery-framing') {
      // ---- Phase 0 Completion: Discovery framing adapter ----
      // Three sequential saves: anchor entities, discovery config, discovery brief artifact
      let parsedPayload: { structuredData: Record<string, unknown>; markdownBrief: string };
      try {
        parsedPayload = JSON.parse(content);
      } catch (parseErr) {
        res.json({
          success: false,
          error: `Discovery framing content is not valid JSON: ${parseErr instanceof Error ? parseErr.message : 'parse error'}`,
        });
        return;
      }

      const { structuredData, markdownBrief } = parsedPayload;

      // Save 1: Anchor entities (applications + app_components)
      const toolResult1 = await executeToolCall(
        uuidv4(),
        'save_project_anchor_entities',
        {
          projectId,
          applications: (structuredData.applications as unknown[]) || [],
          appComponents: (structuredData.appComponents as unknown[]) || [],
        },
        mcpSessionId,
        requestId,
        'v2-save-' + threadKeyStr,
      );

      if (toolResult1.error) {
        logger.warn('Save artifact: anchor entities save failed', {
          requestId,
          threadKey: threadKeyStr,
          error: toolResult1.error,
        });
        res.json({
          success: false,
          error: 'Save failed (anchor entities): ' + toolResult1.error,
        });
        return;
      }

      // Save 2: Discovery config with status="COMPLETE"
      const toolResult2 = await executeToolCall(
        uuidv4(),
        'save_discovery_config',
        {
          projectId,
          discoveryConfigJson: JSON.stringify({ ...structuredData, status: 'COMPLETE' }),
        },
        mcpSessionId,
        requestId,
        'v2-save-' + threadKeyStr,
      );

      if (toolResult2.error) {
        logger.warn('Save artifact: discovery config save failed', {
          requestId,
          threadKey: threadKeyStr,
          error: toolResult2.error,
        });
        res.json({
          success: false,
          error: 'Save failed (discovery config): ' + toolResult2.error,
        });
        return;
      }

      // Save 3: Discovery brief artifact
      const toolResult3 = await executeToolCall(
        uuidv4(),
        'create_project_artifact',
        {
          projectId,
          artifactType: 'DISCOVERY_BRIEF_MD',
          content: markdownBrief,
          source: 'TOOL',
        },
        mcpSessionId,
        requestId,
        'v2-save-' + threadKeyStr,
      );

      if (toolResult3.error) {
        logger.warn('Save artifact: discovery brief artifact save failed', {
          requestId,
          threadKey: threadKeyStr,
          error: toolResult3.error,
        });
        res.json({
          success: false,
          error: 'Save failed (discovery brief artifact): ' + toolResult3.error,
        });
        return;
      }

      // All three saves succeeded -- set completion variables
      toolResult = toolResult3;
      completionContent = 'Discovery Framing complete.';
      completionArtifactId = 'discovery-framing';
      completionArtifactName = 'DISCOVERY_BRIEF';

    } else if (artifactType === 'oas-spec') {
      // ---- OAS spec adapter: save spec file to project directory ----
      let parsedPayload: { oasContent: string; interfaceName: string; preferredFormat: string };
      try {
        parsedPayload = JSON.parse(content);
      } catch (parseErr) {
        res.json({
          success: false,
          error: `OAS spec content is not valid JSON: ${parseErr instanceof Error ? parseErr.message : 'parse error'}`,
        });
        return;
      }

      const { oasContent, interfaceName, preferredFormat } = parsedPayload;
      const extension = preferredFormat === 'json' ? 'json' : 'yaml';
      const artifactFilename = `OAS-SPEC-${interfaceName}.${extension}`;

      toolResult = await executeToolCall(
        uuidv4(),
        'save_markdown_artifact',
        { projectId, projectParentFolder, artifactFilename, markdown: oasContent },
        mcpSessionId,
        requestId,
        'v2-save-' + threadKeyStr,
      );
      completionContent = `OAS Spec saved as ${artifactFilename}.`;
      completionArtifactId = 'oas-spec';
      completionArtifactName = artifactFilename;

    } else {
      // Mission adapter (existing): call save_product_artifacts
      // ---- Resolve productName ----
      let productName: string = projectId;
      try {
        const fetchedName = await fetchProductName(projectId);
        if (fetchedName) {
          productName = fetchedName;
        }
      } catch (err) {
        logger.warn('Save artifact: fetchProductName failed (non-fatal, using projectId as fallback)', {
          requestId,
          projectId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }

      toolResult = await executeToolCall(
        uuidv4(),
        'save_product_artifacts',
        {
          projectParentFolder,
          projectId,
          productName,
          missionMarkdown: content,
          overwrite: true,
        },
        mcpSessionId,
        requestId,
        'v2-save-' + threadKeyStr,
      );
      completionContent = 'Product Definition complete.';
      completionArtifactId = 'mission-md';
      completionArtifactName = 'MISSION.MD';
    }

    // ---- Check result ----
    if (toolResult.error) {
      logger.warn('Save artifact: executeToolCall returned error', {
        requestId,
        threadKey: threadKeyStr,
        error: toolResult.error,
        status: toolResult.status,
      });

      // Do NOT insert completion chip on failure
      res.json({
        success: false,
        error: toolResult.error,
      });
      return;
    }

    // ---- Success: build and persist completion chip ----
    // Resolve personaId from the thread (find the last assistant message's personaId)
    const thread = await getThread(tk);
    let resolvedPersonaId = 'product-manager';
    if (thread) {
      for (let i = thread.messages.length - 1; i >= 0; i--) {
        if (thread.messages[i].role === 'assistant' && thread.messages[i].personaId) {
          resolvedPersonaId = thread.messages[i].personaId!;
          break;
        }
      }
    }

    const completionChip: ThreadMessage = {
      id: uuidv4(),
      role: 'assistant',
      personaId: resolvedPersonaId,
      taskId: taskId,
      content: completionContent,
      structuredResponse: {
        type: 'completion-chip',
        artifactId: completionArtifactId,
        artifactName: completionArtifactName,
        taskId: taskId,
        personaId: resolvedPersonaId,
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    };

    await appendMessage(tk, completionChip);

    logger.info('Save artifact succeeded, completion chip persisted', {
      requestId,
      threadKey: threadKeyStr,
      artifactId: completionArtifactId,
      taskId,
    });

    // ---- Discovery Insights: extract Q&A pairs and save to insights file ----
    // Non-blocking: errors here should not fail the save-artifact response
    try {
      const updatedThread = await getThread(tk);
      if (updatedThread) {
        await extractAndSaveInsights(projectId, taskId, updatedThread);
      }
    } catch (insightErr) {
      logger.warn('Discovery insight extraction failed (non-fatal)', {
        requestId,
        taskId,
        error: insightErr instanceof Error ? insightErr.message : 'Unknown error',
      });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('POST /save-artifact failed', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    res.status(500).json({
      error: 'Internal server error',
    });
  }
});

// ============================================================================
// POST / Handler (Task 7.2)
// + Hub Bootstrap 2, Tasks 2.4-2.5: Inline context assembly + first-turn short-circuit
// + Hub Bootstrap 3, Task 2.3: Inline context assembly for architecture task
// + Hub Bootstrap 4, Tasks 3.2-3.3: Inline context assembly for tech stack + test strategy tasks
// + Unify Panel: allowedPersonaIds validation
// ============================================================================

/**
 * POST / handler for the v2 chat endpoint.
 * Mounted at /api/chat/v2 in server.ts.
 *
 * Flow:
 * 1. Validate request body
 * 1a. Validate allowedPersonaIds
 * 2. Resolve/create thread
 * 3. Look up persona and task from registries
 * 4. Handle taskId 'unknown' (menu response)
 * 5. Resolve context via live/stub resolvers
 * 5a. (Increment 9) Screen-specific system context injection for panel threadKeys
 * 5b. (Hub Bootstrap 2) Inline context assembly for roadmap task
 * 5c. (Hub Bootstrap 2) Deterministic first-turn short-circuit for roadmap task
 * 5d. (Hub Bootstrap 3) Inline context assembly for architecture task
 * 5e. (Hub Bootstrap 4) Inline context assembly for tech stack task
 * 5f. (Hub Bootstrap 4) Inline context assembly for test strategy task
 * 6. Compose system prompt
 * 7. Build messages array
 * 8. Call sendChatRequest
 * 9. Validate response against task's responseFormat
 * 10. Append user + assistant messages to thread
 * 11. Return ChatV2Response
 */
chatV2Router.post('/', async (req: Request, res: Response) => {
  const requestId = req.requestId || uuidv4();

  try {
    // ---- Step 1: Validate request ----
    const body = req.body;
    if (!isChatV2Request(body)) {
      res.status(400).json({
        error: 'Invalid ChatV2Request: missing or invalid required fields (threadKey, personaId, taskId, message)',
      });
      return;
    }

    const request = body as ChatV2Request;

    // ---- Step 1a: Validate allowedPersonaIds ----
    if (Array.isArray(request.allowedPersonaIds) && request.allowedPersonaIds.length > 0) {
      if (!request.allowedPersonaIds.includes(request.personaId)) {
        res.status(400).json({
          error: `Persona not allowed: ${request.personaId} is not in allowedPersonaIds`,
        });
        return;
      }
    }

    logger.info('ChatV2 request received', {
      requestId,
      personaId: request.personaId,
      taskId: request.taskId,
      threadKeyType: request.threadKey.type,
    });


    // Local variable to hold deterministically extracted process activities
    // from XLSX intercept (Step 1b) until thread is available (Step 2).
    let pendingExtractedPAs: import('../services/xlsxUserJourneyParser').ExtractedProcessActivity[] | null = null;

    // ---- Step 1b: XLSX intercept for UX Designer User Journeys ----
    // Spec 2026-04-03: UX Designer XLSX Ingestion for User Journeys
    // When taskId is 'ux-designer--users-interactions' and files contain .xlsx/.xlsm,
    // parse the workbook into delimited CSV-text and replace the binary attachment.
    if (
      request.taskId === 'ux-designer--users-interactions' &&
      request.files &&
      request.files.some(f => /\.xlsx$/i.test(f.filename) || /\.xlsm$/i.test(f.filename))
    ) {
      const updatedFiles: Array<{ filename: string; mimeType: string; base64: string }> = [];

      for (const file of request.files) {
        if (/\.xlsx$/i.test(file.filename) || /\.xlsm$/i.test(file.filename)) {
          const parseResult = parseUserJourneyWorkbook(file.base64);

          if (!parseResult.success) {
            logger.warn('XLSX validation failed', { requestId, error: parseResult.error, filename: file.filename });
            res.status(400).json({ error: parseResult.error });
            return;
          }

          // Replace binary XLSX with text/plain CSV-text
          updatedFiles.push({
            filename: file.filename,
            mimeType: 'text/plain',
            base64: Buffer.from(parseResult.csvText, 'utf-8').toString('base64'),
          });

          // Deterministically extract process activities from the CSV.
          // Stored in a local variable and persisted to thread.metadata
          // after thread creation (Step 2), so it does NOT pollute the
          // user message that the conversation LLM sees.
          const xlsxExtractedPAs = extractProcessActivitiesFromTranscript(parseResult.csvText);
          if (xlsxExtractedPAs.length > 0) {
            pendingExtractedPAs = xlsxExtractedPAs;
          }
        } else {
          // Non-XLSX files pass through unchanged
          updatedFiles.push(file);
        }
      }

      request.files = updatedFiles;
    }

    // ---- Step 2: Parse threadKey and resolve/create thread ----
    const threadKey: ThreadKey = request.threadKey as ThreadKey;
    const threadKeyStr = threadKeyToString(threadKey);

    let thread = await getThread(threadKey);
    if (!thread) {
      thread = await createThread(threadKey);
    }

    // Persist deterministically extracted PAs to thread metadata (from Step 1b)
    if (pendingExtractedPAs) {
      thread.metadata = thread.metadata || {};
      thread.metadata.extractedProcessActivities = pendingExtractedPAs;
      await saveThread(threadKey, thread);
      logger.info('Stored extracted process activities in thread metadata', {
        requestId,
        count: pendingExtractedPAs.length,
      });
    }

    // ---- Step 3: Look up persona and task from registries ----
    const personaRegistry = getPersonaRegistry();
    const taskRegistry = getTaskRegistry();

    const persona = personaRegistry.get(request.personaId);
    if (!persona) {
      res.status(400).json({
        error: `Unknown personaId: ${request.personaId}`,
      });
      return;
    }

    // ---- Step 4: Handle taskId 'unknown' (menu response) ----
    // + Increment 8, Task 1.10: availableFrom-based task filtering
    if (request.taskId === 'unknown') {
      // Derive entry point from threadKey type for availableFrom filtering
      const entryPointMap: Record<string, string> = { hub: 'hub', panel: 'panel', feature: 'embedded' };
      const entryPoint = entryPointMap[threadKey.type] || 'hub';

      // Build menu listing the persona's available tasks, filtered by availableFrom
      const taskList = persona.tasks
        .filter(taskId => {
          const taskDef = taskRegistry.get(taskId);
          // Defensive fallback: include task if not found in registry or has no availableFrom
          if (!taskDef || !taskDef.availableFrom || taskDef.availableFrom.length === 0) {
            return true;
          }
          return taskDef.availableFrom.includes(entryPoint);
        })
        .map(taskId => {
          const taskDef = taskRegistry.get(taskId);
          return taskDef
            ? { taskId: taskDef.id, menuLabel: taskDef.menuLabel, description: taskDef.description }
            : { taskId, menuLabel: taskId, description: '' };
        });

      const response: ChatV2Response = {
        threadKey: threadKeyStr,
        personaId: request.personaId,
        taskId: 'unknown',
        assistant: {
          message: persona.menuLabel,
        },
        structuredResponse: {
          type: 'task-menu',
          tasks: taskList,
        },
      };

      res.json(response);
      return;
    }

    // Validate taskId is in registry
    const task = taskRegistry.get(request.taskId);
    if (!task) {
      res.status(400).json({
        error: `Unknown taskId: ${request.taskId}`,
      });
      return;
    }


    // ---- Step 4a: Deterministic short-circuit for work-item picker ----
    // Spec 2026-03-04: What's Next v1-C -- Work Item Picker
    // Bypasses the LLM entirely and handles the multi-turn work item search flow.
    if (request.pickerAction) {
      // INITIATE flow
      if (request.pickerAction === 'initiate') {
        pickerStateMap.set(threadKeyStr, { mode: 'awaiting-query', actionId: request.pickerPayload?.actionId || 'unknown' });

        // Persist user message
        const userMessage: ThreadMessage = {
          id: uuidv4(),
          role: 'user',
          personaId: null,
          taskId: request.taskId,
          content: request.message,
          structuredResponse: null,
          timestamp: new Date().toISOString(),
        };
        await appendMessage(threadKey, userMessage);

        // Build assistant message
        const assistantContent = 'For which work item? Type a search term (feature or story title).';
        const assistantMessage: ThreadMessage = {
          id: uuidv4(),
          role: 'assistant',
          personaId: request.personaId,
          taskId: request.taskId,
          content: assistantContent,
          structuredResponse: null,
          timestamp: new Date().toISOString(),
        };
        await appendMessage(threadKey, assistantMessage);

        res.json({
          threadKey: threadKeyStr,
          personaId: request.personaId,
          taskId: request.taskId,
          assistant: { message: assistantContent },
          structuredResponse: null,
        });
        return;
      }

      // SEARCH flow
      if (request.pickerAction === 'search') {
        const query = request.pickerPayload?.query || request.message;
        const scopeType = request.pickerPayload?.scopeType;
        const scopeValue = request.pickerPayload?.scopeValue;
        const results = await searchWorkItems(threadKey.projectId, query, scopeType, scopeValue);

        // Persist user message
        const userMessage: ThreadMessage = {
          id: uuidv4(),
          role: 'user',
          personaId: null,
          taskId: request.taskId,
          content: request.message,
          structuredResponse: null,
          timestamp: new Date().toISOString(),
        };
        await appendMessage(threadKey, userMessage);

        if (results.length > 0) {
          // Results found: update state to awaiting-selection
          const currentState = pickerStateMap.get(threadKeyStr);
          pickerStateMap.set(threadKeyStr, { ...(currentState || { mode: 'awaiting-query', actionId: 'unknown' }), mode: 'awaiting-selection' });

          const searchResponse = { type: 'work-item-search-results', query, results };
          const assistantContent = 'Here are the matching work items:';
          const assistantMessage: ThreadMessage = {
            id: uuidv4(),
            role: 'assistant',
            personaId: request.personaId,
            taskId: request.taskId,
            content: assistantContent,
            structuredResponse: searchResponse,
            timestamp: new Date().toISOString(),
          };
          await appendMessage(threadKey, assistantMessage);

          res.json({
            threadKey: threadKeyStr,
            personaId: request.personaId,
            taskId: request.taskId,
            assistant: { message: assistantContent },
            structuredResponse: searchResponse,
          });
          return;
        } else {
          // No results: keep state as awaiting-query
          const assistantContent = `No work items found matching '${query}'. Try a different search term.`;
          const assistantMessage: ThreadMessage = {
            id: uuidv4(),
            role: 'assistant',
            personaId: request.personaId,
            taskId: request.taskId,
            content: assistantContent,
            structuredResponse: null,
            timestamp: new Date().toISOString(),
          };
          await appendMessage(threadKey, assistantMessage);

          res.json({
            threadKey: threadKeyStr,
            personaId: request.personaId,
            taskId: request.taskId,
            assistant: { message: assistantContent },
            structuredResponse: null,
          });
          return;
        }
      }

      // SELECT flow
      if (request.pickerAction === 'select') {
        const workItemId = request.pickerPayload?.workItemId;
        const workItemTitle = request.pickerPayload?.workItemTitle;
        pickerStateMap.delete(threadKeyStr);

        // Persist user message
        const userMessage: ThreadMessage = {
          id: uuidv4(),
          role: 'user',
          personaId: null,
          taskId: request.taskId,
          content: request.message,
          structuredResponse: null,
          timestamp: new Date().toISOString(),
        };
        await appendMessage(threadKey, userMessage);

        const assistantContent = `Navigating to Implement for '${workItemTitle}'...`;
        const selectResponse = { type: 'work-item-selected', workItemId, workItemTitle };
        const assistantMessage: ThreadMessage = {
          id: uuidv4(),
          role: 'assistant',
          personaId: request.personaId,
          taskId: request.taskId,
          content: assistantContent,
          structuredResponse: selectResponse,
          timestamp: new Date().toISOString(),
        };
        await appendMessage(threadKey, assistantMessage);

        res.json({
          threadKey: threadKeyStr,
          personaId: request.personaId,
          taskId: request.taskId,
          assistant: { message: assistantContent },
          structuredResponse: selectResponse,
        });
        return;
      }

      // CANCEL flow
      if (request.pickerAction === 'cancel') {
        pickerStateMap.delete(threadKeyStr);

        // Persist user message
        const userMessage: ThreadMessage = {
          id: uuidv4(),
          role: 'user',
          personaId: null,
          taskId: request.taskId,
          content: request.message,
          structuredResponse: null,
          timestamp: new Date().toISOString(),
        };
        await appendMessage(threadKey, userMessage);

        const assistantContent = 'Work item selection cancelled.';
        const assistantMessage: ThreadMessage = {
          id: uuidv4(),
          role: 'assistant',
          personaId: request.personaId,
          taskId: request.taskId,
          content: assistantContent,
          structuredResponse: null,
          timestamp: new Date().toISOString(),
        };
        await appendMessage(threadKey, assistantMessage);

        res.json({
          threadKey: threadKeyStr,
          personaId: request.personaId,
          taskId: request.taskId,
          assistant: { message: assistantContent },
          structuredResponse: null,
        });
        return;
      }
    }

    // ---- Step 4b: Deterministic short-circuit for assistant--whats-next ----
    // Spec 2026-03-04: Assistant "What's Next" v1
    // Bypasses the LLM entirely and returns a computed structured response.
    if (task.id === 'assistant--whats-next') {
      // 1. Build project signals
      const signals = await buildProjectSignals(threadKey.projectId);

      // 2. Evaluate deterministic next actions
      const result = evaluateNextActions(signals);

      // 3. Build structured response
      const whatsNextResponse = {
        type: 'whats-next-actions' as const,
        explanation: result.explanation,
        actions: result.actions,
      };

      // 4. Persist user message
      const userMessage: ThreadMessage = {
        id: uuidv4(),
        role: 'user',
        personaId: null,
        taskId: request.taskId,
        content: request.message,
        structuredResponse: null,
        timestamp: new Date().toISOString(),
      };
      await appendMessage(threadKey, userMessage);

      // 5. Persist assistant message
      const assistantContent = result.explanation;
      const assistantMessage: ThreadMessage = {
        id: uuidv4(),
        role: 'assistant',
        personaId: request.personaId,
        taskId: request.taskId,
        content: assistantContent,
        structuredResponse: whatsNextResponse,
        timestamp: new Date().toISOString(),
      };
      await appendMessage(threadKey, assistantMessage);

      // 6. Return response, skip LLM
      res.json({
        threadKey: threadKeyStr,
        personaId: request.personaId,
        taskId: request.taskId,
        assistant: { message: assistantContent },
        structuredResponse: whatsNextResponse,
      });
      return;
    }

    // ---- Step 5: Resolve context ----
    const contextResolverRegistry = getContextResolverRegistry();
    const resolvedContext: Record<string, string> = {};

    for (const contextKey of task.contextNeeds) {
      const resolver = contextResolverRegistry.get(contextKey);
      if (resolver) {
        const content = await resolver.resolve(threadKey.projectId, threadKeyStr);
        if (content) {
          // Map context key to section name format (uppercase with spaces)
          const sectionName = contextKey.toUpperCase().replace(/-/g, ' ');
          resolvedContext[sectionName] = content;
        }
      }
    }

    // ---- Step 5a: Screen-specific system context injection ----
    // Increment 9, Task Group 1 (Task 1.9): Inject SCREEN CONTEXT for panel threadKeys
    if (threadKey.type === 'panel') {
      const panelKey = threadKey as PanelThreadKey;
      const screenDescriptions: Record<string, string> = {
        'product': 'The user is currently on the Product Definition tab, viewing their product definition and mission summary.',
        'roadmap': 'The user is currently on the Roadmap tab, viewing their roadmap tree of initiatives and epics.',
        'metamodel': 'The user is currently on the Architecture MetaModel tab, viewing entity grids and relationship tables.',
      };
      const screenDescription = screenDescriptions[panelKey.screen];
      if (screenDescription) {
        resolvedContext['SCREEN CONTEXT'] = screenDescription;
      }
    }

    // Resolve project folder once for all inline context assembly blocks
    const inlineCtxFolder = await fetchProjectFolder(threadKey.projectId);
    const inlineCtxBasePath = inlineCtxFolder || process.cwd();

    // ---- Step 5b: Inline context assembly for roadmap task ----
    // Hub Bootstrap 2, Task 2.4: Deferred to real resolvers in Inc 8-9
    if (task.id === 'product-manager--roadmap') {
      // Load MISSION.MD from disk (replicating v1 pattern at chat.ts lines 1158-1167)
      const basePath = inlineCtxBasePath;
      try {
        const missionPath = path.join(basePath, 'agent-os', 'product', 'MISSION.MD');
        const missionContent = await fs.readFile(missionPath, 'utf-8');
        resolvedContext['MISSION'] = missionContent;
      } catch {
        // Try fallback lowercase filename
        try {
          const missionPathLower = path.join(basePath, 'agent-os', 'product', 'mission.md');
          const missionContent = await fs.readFile(missionPathLower, 'utf-8');
          resolvedContext['MISSION'] = missionContent;
        } catch {
          logger.debug('MISSION.MD not found for roadmap context injection', { requestId });
        }
      }

      // Fetch existing roadmap summary
      try {
        const productSummary = await fetchProductSummary(threadKey.projectId);
        if (productSummary && hasExistingRoadmap(productSummary)) {
          resolvedContext['EXISTING ROADMAP'] = buildRoadmapSummary(productSummary);
          resolvedContext['EXISTING ROADMAP GUIDANCE'] = ROADMAP_EXISTS_INSTRUCTION_BLOCK;
        }
      } catch (err) {
        logger.warn('Roadmap context injection: fetchProductSummary failed', {
          requestId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }

      // Fetch architecture baseline from meta-model summary.
      // Spec 2026-05-01 Multi-Architecture Plumbing - Task Group 3:
      // resolve project's Default architecture before the Bucket A call.
      try {
        const archIdForRoadmap = await resolveDefaultArchitectureId(threadKey.projectId);
        if (archIdForRoadmap) {
          const metaModel = await fetchMetaModelSummary(threadKey.projectId, archIdForRoadmap);
          if (metaModel) {
            resolvedContext['ARCHITECTURE BASELINE'] = JSON.stringify(metaModel);
          } else {
            logger.debug('fetchMetaModelSummary returned null for roadmap context injection', { requestId });
          }
        } else {
          logger.debug('No default architecture for project; skipping ARCHITECTURE BASELINE', { requestId });
        }
      } catch (err) {
        logger.debug('fetchMetaModelSummary failed for roadmap context injection', {
          requestId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    // ---- Step 5c: Deterministic first-turn short-circuit for roadmap task ----
    // Hub Bootstrap 2, Task 2.5: Replicates v1 pattern at chat.ts lines 1181-1289
    if (task.id === 'product-manager--roadmap') {
      const roadmapMessagesCount = thread.messages.filter(
        m => m.taskId === 'product-manager--roadmap'
      ).length;

      if (roadmapMessagesCount === 0) {
        // First turn: build canned response without LLM call
        let cannedResponse;
        try {
          const productSummary = await fetchProductSummary(threadKey.projectId);
          if (productSummary && hasExistingRoadmap(productSummary)) {
            const { initiativeCount, epicCount } = countRoadmapItems(productSummary);
            cannedResponse = {
              phase: 'questions',
              section: 'outcome_alignment',
              summary: `I found an existing roadmap with ${initiativeCount} initiative${initiativeCount !== 1 ? 's' : ''} and ${epicCount} epic${epicCount !== 1 ? 's' : ''}. Let's review and refine it.`,
              questions: [
                'Are these initiatives still aligned with your current business goals, or have priorities shifted?',
                'Are there any new initiatives or epics that should be added to the roadmap?',
                'Would you like to adjust the sequencing or dependencies between any existing items?',
              ],
              proposedInitiatives: [],
              assumptions: [],
              openItems: [],
            };
          }
        } catch {
          // Degrade to no-roadmap branch
        }

        if (!cannedResponse) {
          cannedResponse = {
            phase: 'questions',
            section: 'outcome_alignment',
            summary: "No internal roadmap found for this project. Let's define your roadmap from your product goals.",
            questions: [
              'What are the top 2-3 business outcomes you want this product to achieve in the next quarter or two?',
              'Do you have an existing roadmap in an external tool (Jira, spreadsheet) we should reference, or are we starting fresh?',
            ],
            proposedInitiatives: [],
            assumptions: [],
            openItems: [],
          };
        }

        // Persist user + assistant messages
        const userMessage: ThreadMessage = {
          id: uuidv4(),
          role: 'user',
          personaId: null,
          taskId: request.taskId,
          content: request.message,
          structuredResponse: null,
          timestamp: new Date().toISOString(),
        };
        await appendMessage(threadKey, userMessage);

        const assistantMessage: ThreadMessage = {
          id: uuidv4(),
          role: 'assistant',
          personaId: request.personaId,
          taskId: request.taskId,
          content: JSON.stringify(cannedResponse),
          structuredResponse: cannedResponse,
          timestamp: new Date().toISOString(),
        };
        await appendMessage(threadKey, assistantMessage);

        // Return ChatV2Response -- skip LLM call entirely
        res.json({
          threadKey: threadKeyStr,
          personaId: request.personaId,
          taskId: request.taskId,
          assistant: { message: JSON.stringify(cannedResponse) },
          structuredResponse: cannedResponse,
        });
        return;
      }
    }

    // ---- Step 5d: Inline context assembly for architecture task ----
    // Hub Bootstrap 3, Task 2.3: Load MISSION.MD + optional TECH-STACK.MD
    if (task.id === 'architect--define-architecture') {
      const basePath = inlineCtxBasePath;

      // Load MISSION.MD (same two-path fallback as roadmap block)
      try {
        const missionPath = path.join(basePath, 'agent-os', 'product', 'MISSION.MD');
        const missionContent = await fs.readFile(missionPath, 'utf-8');
        resolvedContext['MISSION'] = missionContent;
      } catch {
        try {
          const missionPathLower = path.join(basePath, 'agent-os', 'product', 'mission.md');
          const missionContent = await fs.readFile(missionPathLower, 'utf-8');
          resolvedContext['MISSION'] = missionContent;
        } catch {
          logger.debug('MISSION.MD not found for architecture context injection', { requestId });
        }
      }

      // Load TECH-STACK.MD (OPTIONAL: if not found, proceed without it)
      try {
        const techStackPath = path.join(basePath, 'agent-os', 'product', 'TECH-STACK.MD');
        const techStackContent = await fs.readFile(techStackPath, 'utf-8');
        resolvedContext['TECH STACK'] = techStackContent;
      } catch {
        try {
          const techStackPathLower = path.join(basePath, 'agent-os', 'product', 'tech-stack.md');
          const techStackContent = await fs.readFile(techStackPathLower, 'utf-8');
          resolvedContext['TECH STACK'] = techStackContent;
        } catch {
          logger.debug('TECH-STACK.MD not found for architecture context injection (optional, proceeding)', { requestId });
        }
      }

      // No deterministic first-turn short-circuit: the LLM handles the first turn naturally
    }

    // ---- Step 5d-2: Inline context assembly for detailed data model task ----
    // Spec 2026-03-14: Detailed Data Model Task -- inject architecture context + MISSION + TECH STACK
    if (task.id === 'architect--detailed-data-model') {
      const basePath = inlineCtxBasePath;

      // Load full architecture context (entities + explainer)
      try {
        const archContext = await buildArchitectureContextSection(threadKey.projectId);
        if (archContext) {
          resolvedContext['ARCHITECTURE CONTEXT'] = archContext;
        }
      } catch (err) {
        logger.warn('buildArchitectureContextSection failed for detailed data model context injection', {
          requestId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }

      // Load MISSION.MD (same two-path fallback as architecture block)
      try {
        const missionPath = path.join(basePath, 'agent-os', 'product', 'MISSION.MD');
        const missionContent = await fs.readFile(missionPath, 'utf-8');
        resolvedContext['MISSION'] = missionContent;
      } catch {
        try {
          const missionPathLower = path.join(basePath, 'agent-os', 'product', 'mission.md');
          const missionContent = await fs.readFile(missionPathLower, 'utf-8');
          resolvedContext['MISSION'] = missionContent;
        } catch {
          logger.debug('MISSION.MD not found for detailed data model context injection', { requestId });
        }
      }

      // Load TECH-STACK.MD (OPTIONAL: if not found, proceed without it)
      try {
        const techStackPath = path.join(basePath, 'agent-os', 'product', 'TECH-STACK.MD');
        const techStackContent = await fs.readFile(techStackPath, 'utf-8');
        resolvedContext['TECH STACK'] = techStackContent;
      } catch {
        try {
          const techStackPathLower = path.join(basePath, 'agent-os', 'product', 'tech-stack.md');
          const techStackContent = await fs.readFile(techStackPathLower, 'utf-8');
          resolvedContext['TECH STACK'] = techStackContent;
        } catch {
          logger.debug('TECH-STACK.MD not found for detailed data model context injection (optional, proceeding)', { requestId });
        }
      }

      // No deterministic first-turn short-circuit
    }

    // ---- Step 5d-3: Inject full architecture context for tasks that previously used meta-model-summary ----
    const fullArchContextTasks = new Set([
      'architect--service-breakdown',
      'architect--tech-standards',
      'architect--oas-spec',
      'test-engineer--feature-tests',
      'test-engineer--verify-implementation',
      'ux-designer--ui-domain',
      'ux-designer--users-interactions',
    ]);
    if (fullArchContextTasks.has(task.id)) {
      try {
        const archContext = await buildArchitectureContextSection(threadKey.projectId);
        if (archContext) {
          resolvedContext['ARCHITECTURE CONTEXT'] = archContext;
        }
      } catch (err) {
        logger.warn('buildArchitectureContextSection failed for architecture context injection', {
          requestId,
          taskId: task.id,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    // ---- Step 5d-4: Inline context assembly for architecture diagram generation task ----
    // Spec 2026-03-26: Architecture Diagram Generation Task Framework -- Task Group 4
    if (task.id === 'architect--generate-architecture-diagram') {
      // Inject filtered data model context (logical/physical entities, attributes, relationships)
      try {
        const dataModelContext = await buildDataModelContextSection(threadKey.projectId);
        if (dataModelContext) {
          resolvedContext['DATA MODEL CONTEXT'] = dataModelContext;
        }
      } catch (err) {
        logger.warn('buildDataModelContextSection failed for architecture diagram generation context injection', {
          requestId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }

      // Inject condensed TemporaryArchitectureDiagram contract summary
      try {
        const contractPath = path.join(__dirname, '..', 'config', 'prompts', 'shared', 'temporary-diagram-contract.md');
        const contractContent = await fs.readFile(contractPath, 'utf-8');
        if (contractContent) {
          resolvedContext['TEMPORARY DIAGRAM CONTRACT'] = contractContent;
        }
      } catch (err) {
        logger.warn('Failed to load temporary diagram contract summary for architecture diagram generation', {
          requestId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    // ---- Step 5e: Inline context assembly for tech stack task ----
    // Hub Bootstrap 4, Task 3.2: Load MISSION.MD + architecture baseline + optional TECH-STACK.MD
    if (task.id === 'architect--define-tech-stack') {
      const basePath = inlineCtxBasePath;

      // Load MISSION.MD (two-path fallback)
      try {
        const missionPath = path.join(basePath, 'agent-os', 'product', 'MISSION.MD');
        const missionContent = await fs.readFile(missionPath, 'utf-8');
        resolvedContext['MISSION'] = missionContent;
      } catch {
        try {
          const missionPathLower = path.join(basePath, 'agent-os', 'product', 'mission.md');
          const missionContent = await fs.readFile(missionPathLower, 'utf-8');
          resolvedContext['MISSION'] = missionContent;
        } catch {
          logger.debug('MISSION.MD not found for tech stack context injection', { requestId });
        }
      }

      // Fetch architecture baseline from meta-model summary.
      // Spec 2026-05-01 Multi-Architecture Plumbing - Task Group 3:
      // resolve project's Default architecture before the Bucket A call.
      try {
        const archIdForTechStack = await resolveDefaultArchitectureId(threadKey.projectId);
        if (archIdForTechStack) {
          const metaModel = await fetchMetaModelSummary(threadKey.projectId, archIdForTechStack);
          if (metaModel) {
            resolvedContext['ARCHITECTURE BASELINE'] = JSON.stringify(metaModel);
          } else {
            logger.debug('fetchMetaModelSummary returned null for tech stack context injection', { requestId });
          }
        } else {
          logger.debug('No default architecture for project; skipping ARCHITECTURE BASELINE', { requestId });
        }
      } catch (err) {
        logger.debug('fetchMetaModelSummary failed for tech stack context injection', {
          requestId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }

      // Load TECH-STACK.MD (OPTIONAL: if found, inject with update hint)
      try {
        const techStackPath = path.join(basePath, 'agent-os', 'product', 'TECH-STACK.MD');
        const techStackContent = await fs.readFile(techStackPath, 'utf-8');
        resolvedContext['TECH STACK'] = techStackContent;
        resolvedContext['TECH STACK UPDATE HINT'] = 'An existing Tech Stack (TECH-STACK.MD) was found. The user may be refining or updating it.';
      } catch {
        try {
          const techStackPathLower = path.join(basePath, 'agent-os', 'product', 'tech-stack.md');
          const techStackContent = await fs.readFile(techStackPathLower, 'utf-8');
          resolvedContext['TECH STACK'] = techStackContent;
          resolvedContext['TECH STACK UPDATE HINT'] = 'An existing Tech Stack (TECH-STACK.MD) was found. The user may be refining or updating it.';
        } catch {
          logger.debug('TECH-STACK.MD not found for tech stack context injection (optional, proceeding)', { requestId });
        }
      }

      // No deterministic first-turn short-circuit
    }

    // ---- Step 5f: Inline context assembly for test strategy task ----
    // Hub Bootstrap 4, Task 3.3: Load MISSION.MD + roadmap + optional TECH-STACK.MD + optional TEST-STRATEGY.MD
    if (task.id === 'test-engineer--test-strategy') {
      const basePath = inlineCtxBasePath;

      // Load MISSION.MD (two-path fallback)
      try {
        const missionPath = path.join(basePath, 'agent-os', 'product', 'MISSION.MD');
        const missionContent = await fs.readFile(missionPath, 'utf-8');
        resolvedContext['MISSION'] = missionContent;
      } catch {
        try {
          const missionPathLower = path.join(basePath, 'agent-os', 'product', 'mission.md');
          const missionContent = await fs.readFile(missionPathLower, 'utf-8');
          resolvedContext['MISSION'] = missionContent;
        } catch {
          logger.debug('MISSION.MD not found for test strategy context injection', { requestId });
        }
      }

      // Fetch roadmap summary
      try {
        const productSummary = await fetchProductSummary(threadKey.projectId);
        if (productSummary) {
          resolvedContext['ROADMAP'] = buildRoadmapSummary(productSummary);
        } else {
          logger.debug('fetchProductSummary returned null for test strategy context injection', { requestId });
        }
      } catch (err) {
        logger.debug('fetchProductSummary failed for test strategy context injection', {
          requestId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }

      // Load TECH-STACK.MD (OPTIONAL)
      try {
        const techStackPath = path.join(basePath, 'agent-os', 'product', 'TECH-STACK.MD');
        const techStackContent = await fs.readFile(techStackPath, 'utf-8');
        resolvedContext['TECH STACK'] = techStackContent;
      } catch {
        try {
          const techStackPathLower = path.join(basePath, 'agent-os', 'product', 'tech-stack.md');
          const techStackContent = await fs.readFile(techStackPathLower, 'utf-8');
          resolvedContext['TECH STACK'] = techStackContent;
        } catch {
          logger.debug('TECH-STACK.MD not found for test strategy context injection (optional, proceeding)', { requestId });
        }
      }

      // Load TEST-STRATEGY.MD (OPTIONAL: if found, inject update hint)
      try {
        const testStrategyPath = path.join(basePath, 'agent-os', 'product', 'TEST-STRATEGY.MD');
        const testStrategyContent = await fs.readFile(testStrategyPath, 'utf-8');
        resolvedContext['TEST STRATEGY'] = testStrategyContent;
        resolvedContext['TEST STRATEGY UPDATE HINT'] = 'An existing Test Strategy (TEST-STRATEGY.MD) was found. The user may be refining or updating it.';
      } catch {
        try {
          const testStrategyPathLower = path.join(basePath, 'agent-os', 'product', 'test-strategy.md');
          const testStrategyContent = await fs.readFile(testStrategyPathLower, 'utf-8');
          resolvedContext['TEST STRATEGY'] = testStrategyContent;
          resolvedContext['TEST STRATEGY UPDATE HINT'] = 'An existing Test Strategy (TEST-STRATEGY.MD) was found. The user may be refining or updating it.';
        } catch {
          logger.debug('TEST-STRATEGY.MD not found for test strategy context injection (optional, proceeding)', { requestId });
        }
      }

      // No deterministic first-turn short-circuit
    }

    // ---- Step 5f-2: Inline context assembly for backlog task ----
    if (task.id === 'product-manager--backlog') {
      const basePath = inlineCtxBasePath;

      // Load MISSION.MD (two-path fallback)
      try {
        const missionPath = path.join(basePath, 'agent-os', 'product', 'MISSION.MD');
        const missionContent = await fs.readFile(missionPath, 'utf-8');
        resolvedContext['MISSION'] = missionContent;
      } catch {
        try {
          const missionPathLower = path.join(basePath, 'agent-os', 'product', 'mission.md');
          const missionContent = await fs.readFile(missionPathLower, 'utf-8');
          resolvedContext['MISSION'] = missionContent;
        } catch {
          logger.debug('MISSION.MD not found for backlog context injection', { requestId });
        }
      }

      // Build epic list for backlog context
      try {
        const epicList = await buildEpicListForBacklog(threadKey.projectId);
        if (epicList) {
          resolvedContext['EPIC LIST'] = epicList;
        }
      } catch (err) {
        logger.warn('Epic list context injection failed for backlog', {
          requestId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }

      // Load full architecture context (entities + explainer)
      try {
        const archContext = await buildArchitectureContextSection(threadKey.projectId);
        if (archContext) {
          resolvedContext['ARCHITECTURE CONTEXT'] = archContext;
        }
      } catch (err) {
        logger.warn('buildArchitectureContextSection failed for backlog context injection', {
          requestId,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    // ---- Step 5f-3: Deterministic first-turn short-circuit for backlog task ----
    if (task.id === 'product-manager--backlog') {
      const backlogMessagesCount = thread.messages.filter(
        m => m.taskId === 'product-manager--backlog'
      ).length;

      if (backlogMessagesCount === 0) {
        // First turn: build canned response without LLM call
        let cannedResponse;
        try {
          const epicList = await buildEpicListForBacklog(threadKey.projectId);
          if (epicList) {
            // Path A: Epics exist -- present them for selection
            cannedResponse = {
              phase: 'questions',
              section: 'epic_selection',
              summary: 'I found existing epics in your roadmap. Please select one to break down into features and stories.',
              questions: [
                'Which epic would you like to work on? You can pick one from the list above, or we can discuss epic priorities first.',
              ],
              selectedEpic: null,
              proposedFeatures: [],
              deletedWorkItemIds: [],
              epicPriorityUpdates: [],
              assumptions: [],
              openItems: [],
            };
          }
        } catch {
          // Degrade to no-epics branch
        }

        if (!cannedResponse) {
          // Path B: No epics -- suggest building roadmap first
          cannedResponse = {
            phase: 'questions',
            section: 'epic_selection',
            summary: 'No epics found in your roadmap. You need to define initiatives and epics before breaking them into features and stories.',
            questions: [
              'It looks like you do not have any epics defined yet. Would you like to run the Build Roadmap task first to create initiatives and epics?',
            ],
            selectedEpic: null,
            proposedFeatures: [],
            deletedWorkItemIds: [],
            epicPriorityUpdates: [],
            assumptions: [],
            openItems: [],
          };
        }

        // Persist user + assistant messages
        const userMessage: ThreadMessage = {
          id: uuidv4(),
          role: 'user',
          personaId: null,
          taskId: request.taskId,
          content: request.message,
          structuredResponse: null,
          timestamp: new Date().toISOString(),
        };
        await appendMessage(threadKey, userMessage);

        const assistantMessage: ThreadMessage = {
          id: uuidv4(),
          role: 'assistant',
          personaId: request.personaId,
          taskId: request.taskId,
          content: JSON.stringify(cannedResponse),
          structuredResponse: cannedResponse,
          timestamp: new Date().toISOString(),
        };
        await appendMessage(threadKey, assistantMessage);

        // Return ChatV2Response -- skip LLM call entirely
        res.json({
          threadKey: threadKeyStr,
          personaId: request.personaId,
          taskId: request.taskId,
          assistant: { message: JSON.stringify(cannedResponse) },
          structuredResponse: cannedResponse,
        });
        return;
      }
    }

    // ---- Step 5g: Discovery Insights injection ----
    // Loads Q&A insights from previous discovery conversations and injects them
    // as context. Excludes the current task's own insights to avoid self-reference.
    try {
      const formattedInsights = await loadFormattedInsights(threadKey.projectId, task.id);
      if (formattedInsights) {
        resolvedContext['PREVIOUS DISCOVERY INSIGHTS'] = formattedInsights;
      }
    } catch (err) {
      logger.warn('Discovery insights injection failed (non-fatal)', {
        requestId,
        taskId: task.id,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }

    // ---- Step 5h: Resolve architecture binding for bound-by-system-prompt and derived-from-context tasks ----
    // Spec 2026-05-01 Multi-Architecture Discovery Integration (Spec #4) -- Task Group 5
    // (bound-by-system-prompt path).
    // Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 6
    // (derived-from-context path: synthesise binding from previously-persisted
    // `Thread.metadata.boundArchitectureId` so already-bound conversations get
    // the same Architecture: <name> (id: <id>) line on every subsequent turn).
    //
    // Forward-only: existing thread JSON files on disk are never touched --
    // system prompts are rebuilt fresh each turn from current code, so old
    // threads simply continue without the line.
    let architectureBinding: { id: string; name: string } | null = null;
    const effectiveSaveTargetResolution =
      task.saveTargetResolution ?? persona.saveTargetResolution;
    if (
      effectiveSaveTargetResolution === 'bound-by-system-prompt' &&
      typeof request.architectureId === 'string' &&
      request.architectureId.length > 0
    ) {
      try {
        const architectures = await listArchitectures(threadKey.projectId);
        const match = architectures?.find(a => a.id === request.architectureId);
        if (match) {
          architectureBinding = { id: match.id, name: match.name };

          // Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5)
          // Task Group 7: persist the resolved bound architecture on
          // Thread.metadata so the frontend invalidation banner (Group 9) can
          // compare it against useActiveArchitectureId() to detect a
          // mid-conversation architecture switch. Idempotent on every turn:
          // re-writing the same id is harmless; if a future request arrives
          // with a different architectureId, the metadata is updated to the
          // new resolved binding and the banner picks up the divergence on
          // the next thread load.
          const existingBoundId =
            typeof thread.metadata?.boundArchitectureId === 'string'
              ? thread.metadata.boundArchitectureId
              : undefined;
          if (existingBoundId !== match.id || thread.metadata?.boundArchitectureName !== match.name) {
            thread.metadata = thread.metadata || {};
            thread.metadata.boundArchitectureId = match.id;
            thread.metadata.boundArchitectureName = match.name;
            try {
              await saveThread(threadKey, thread);
              logger.info('ChatV2 bound-by-system-prompt: persisted boundArchitectureId on Thread.metadata', {
                requestId,
                taskId: task.id,
                boundArchitectureId: match.id,
                boundArchitectureName: match.name,
              });
            } catch (saveErr) {
              // Non-fatal: the system prompt injection still happens this
              // turn; the banner just will not detect a switch until the
              // metadata sticks on a future successful save.
              logger.warn('ChatV2 bound-by-system-prompt: failed to persist boundArchitectureId (non-fatal)', {
                requestId,
                taskId: task.id,
                error: saveErr instanceof Error ? saveErr.message : 'Unknown error',
              });
            }
          }
        } else {
          logger.warn('Architecture binding requested but architectureId not found in project', {
            requestId,
            projectId: threadKey.projectId,
            architectureId: request.architectureId,
            taskId: task.id,
          });
        }
      } catch (err) {
        logger.warn('Architecture binding resolution failed (non-fatal)', {
          requestId,
          taskId: task.id,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    } else if (
      effectiveSaveTargetResolution === 'derived-from-context' &&
      thread.metadata &&
      typeof thread.metadata.boundArchitectureId === 'string' &&
      thread.metadata.boundArchitectureId.length > 0 &&
      typeof thread.metadata.boundArchitectureName === 'string' &&
      thread.metadata.boundArchitectureName.length > 0
    ) {
      // Already-bound `derived-from-context` thread: synthesise the binding
      // from persisted thread metadata (set by the Step 9c contextBinding
      // intercept on a previous turn) so composeSystemPrompt injects the
      // Architecture: <name> (id: <id>) line for every subsequent turn.
      // First-turn (unbound) `derived-from-context` deliberately falls
      // through with `architectureBinding = null`; composeSystemPrompt
      // (Group 4) omits the line so the LLM operates in
      // "I need to identify the entity first" mode.
      architectureBinding = {
        id: thread.metadata.boundArchitectureId,
        name: thread.metadata.boundArchitectureName,
      };
    }

    // ---- Step 6: Compose system prompt ----
    const systemPrompt = await composeSystemPrompt(
      request.personaId,
      request.taskId,
      null,
      resolvedContext,
      architectureBinding
    );

    // ---- Step 7: Build messages array ----
    const messages: OpenAIMessage[] = [];

    // System message
    messages.push({ role: 'system', content: systemPrompt });

    // Summary injection: if thread has a rolling summary, inject it and trim old messages
    if (thread.summary) {
      messages.push({
        role: 'system',
        content: `=== CONVERSATION SUMMARY ===
${thread.summary}`,
      });
    }

    // Thread history (mapped to OpenAIMessage format)
    const startIndex = thread.summary ? thread.summarisedUpToIndex : 0;
    for (let i = startIndex; i < thread.messages.length; i++) {
      const msg = thread.messages[i];
      if (msg.role === 'system') {
        // Skip system messages from history -- we compose a fresh one each turn
        continue;
      }
      messages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      });
    }

    // New user message (with optional file attachments)
    if (request.files && request.files.length > 0) {
      const contentParts = buildContentPartsV2(request.message, request.files);
      messages.push({
        role: 'user',
        content: contentParts,
      });
    } else {
      messages.push({
        role: 'user',
        content: request.message,
      });
    }

    // ---- Step 8: Call sendChatRequest ----
    // Phase-switching for ER diagram generation: once ANY assistant message in the thread
    // has phase === 'ready' (confirmation), all subsequent turns must use free-text mode
    // so the LLM can output the diagram code block. This handles both the initial generation
    // and any retries after a failed generation attempt.
    let jsonMode = task.responseFormat !== null;
    if (jsonMode && task.id === 'architect--generate-architecture-diagram' && thread.messages.length > 0) {
      const hasReadyPhase = thread.messages.some(m => {
        if (m.role !== 'assistant' || !m.structuredResponse) return false;
        const sr = m.structuredResponse as Record<string, unknown>;
        return sr.phase === 'ready';
      });
      if (hasReadyPhase) {
        jsonMode = false;
        logger.info('ER diagram generation: switching to free-text mode for diagram output', { requestId });
      }
    }
    const llmResponse = await getLlmClient().sendChatRequest(messages, requestId, threadKeyStr, {
      jsonMode,
      tools: [],
    });

    const assistantContent = llmResponse.content || '';

    logger.info('ChatV2 LLM response debug', {
      requestId,
      taskId: task.id,
      contentLength: assistantContent.length,
      contentPreview: assistantContent.substring(0, 200),
      hasToolCalls: !!llmResponse.toolCalls,
      isFinal: llmResponse.isFinal,
    });

    // ---- Step 9: Validate response ----
    let structuredResponse: unknown = null;
    let validationError: string | undefined;

    if (task.responseFormat) {
      const validation = validateStructuredResponse(assistantContent, task.responseFormat);
      if (validation.valid) {
        structuredResponse = validation.parsed;
      } else {
        logger.warn('Structured response validation failed', {
          requestId,
          taskId: request.taskId,
          error: validation.error,
        });
        validationError = validation.error;
        // Pass through parsed data if available, even with errors
        structuredResponse = validation.parsed || null;
      }
    }


    // ---- Step 9b: Server-side payload extraction for architecture diagram generation ----
    // Spec 2026-03-26: Architecture Diagram Generation Task Framework -- Task Group 4
    if (task.id === 'architect--generate-architecture-diagram') {
      const diagramBlockRegex = /```json:temporaryArchitectureDiagram\s*\n([\s\S]*?)\n```/;
      const diagramMatch = assistantContent.match(diagramBlockRegex);

      if (diagramMatch && diagramMatch[1]) {
        try {
          const parsedPayload = JSON.parse(diagramMatch[1]);

          // Validate required top-level fields
          const requiredFields = ['id', 'name', 'diagram_kind', 'nodes', 'edges', 'version'];
          const missingFields = requiredFields.filter(f => !(f in parsedPayload));

          if (missingFields.length > 0) {
            logger.warn('Architecture diagram payload missing required fields -- skipping save', {
              requestId,
              missingFields,
            });
          } else {
            // Call executeToolCall to save the temporary diagram.
            //
            // Hotfix 2026-05-13: thread the architectureId of the bound
            // architecture (or, failing that, the URL-active one from the
            // request body) so the MCP server PUTs to the architecture-
            // scoped AMS route and the saved diagram is reachable from the
            // frontend preview's GET. Without this, the MCP fallback to the
            // project's default architecture diverges from the user's
            // current URL on multi-architecture projects and the preview
            // 404s.
            const mcpSessionId = uuidv4();
            const resolvedArchitectureId =
              architectureBinding?.id ??
              (typeof request.architectureId === 'string' && request.architectureId.length > 0
                ? request.architectureId
                : undefined);
            const toolResult = await executeToolCall(
              uuidv4(),
              'saveTemporaryArchitectureDiagram',
              {
                projectId: threadKey.projectId,
                diagramJson: JSON.stringify(parsedPayload),
                ...(resolvedArchitectureId ? { architectureId: resolvedArchitectureId } : {}),
              },
              mcpSessionId,
              requestId,
              'v2-diagram-' + threadKeyStr,
            );

            if (toolResult.status >= 400 || toolResult.error) {
              logger.error('saveTemporaryArchitectureDiagram tool call failed', {
                requestId,
                diagramId: parsedPayload.id,
                status: toolResult.status,
                error: toolResult.error,
              });
            } else {
              logger.info('Architecture diagram payload extracted and saved successfully', {
                requestId,
                diagramId: parsedPayload.id,
                diagramName: parsedPayload.name,
              });
            }
            // Turn is treated as complete: fall through to message persistence and response (Steps 10-11).
            // No further LLM turn is initiated.
          }
        } catch (parseErr) {
          logger.warn('Architecture diagram payload extraction failed -- returning message as-is', {
            requestId,
            error: parseErr instanceof Error ? parseErr.message : 'Unknown error',
          });
        }
      }
      // If no block found, the response is returned as-is (normal Q&A turn during the 4-question flow)
    }
    // ---- Step 9c: Intercept LLM `contextBinding` block for `derived-from-context` mode ----
    // Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) -- Task Group 6.
    //
    // The LLM in `derived-from-context` mode (V1: only `architect--oas-spec`)
    // emits a structured response of shape
    //   { contextBinding: { entityType: "interface", entityId: "<uuid>" }, ... }
    // once it has identified the target entity. The handler:
    //   1. Skips the intercept for any other mode (bound / clarify / undefined)
    //      so non-derived tasks pay zero overhead.
    //   2. If the thread is already bound (re-binding NOT allowed in V1),
    //      logs a warning and ignores the new contextBinding block. The
    //      original binding is preserved; the user must start a new
    //      conversation to switch entity.
    //   3. Otherwise calls `derivedBindingResolver.resolve(...)` and:
    //        - on success: spreads {boundArchitectureId, boundArchitectureName,
    //          boundEntityType, boundEntityId} onto `thread.metadata` and
    //          persists the thread so subsequent turns get the
    //          `Architecture: <name> (id: <id>)` line via Step 5h.
    //        - on `DerivedBindingError`: surfaces a 422-coded
    //          `bindingError` payload on the response so the frontend can
    //          render the refusal inline; the thread is NOT bound, allowing
    //          the user to retry with a different contextBinding block on
    //          the next turn.
    //
    // The HTTP response itself is still 200 -- the chat turn completed and
    // the user-facing assistant message is included. Only the binding side
    // effect failed.
    let bindingError: ChatV2BindingError | undefined;
    if (
      effectiveSaveTargetResolution === 'derived-from-context' &&
      structuredResponse !== null &&
      typeof structuredResponse === 'object'
    ) {
      const sr = structuredResponse as Record<string, unknown>;
      const cb = sr.contextBinding;
      if (
        cb &&
        typeof cb === 'object' &&
        typeof (cb as Record<string, unknown>).entityType === 'string' &&
        typeof (cb as Record<string, unknown>).entityId === 'string'
      ) {
        const cbObj = cb as { entityType: string; entityId: string };

        // Re-binding NOT allowed in V1: ignore second contextBinding when
        // a binding is already established on `Thread.metadata`.
        if (
          thread.metadata &&
          typeof thread.metadata.boundArchitectureId === 'string' &&
          thread.metadata.boundArchitectureId.length > 0
        ) {
          logger.warn(
            'ChatV2 derived-from-context: ignoring re-binding attempt (V1 does not allow re-binding within a single thread)',
            {
              requestId,
              taskId: task.id,
              existingBoundArchitectureId: thread.metadata.boundArchitectureId,
              existingBoundEntityType: thread.metadata.boundEntityType,
              existingBoundEntityId: thread.metadata.boundEntityId,
              attemptedEntityType: cbObj.entityType,
              attemptedEntityId: cbObj.entityId,
            }
          );
        } else {
          try {
            const resolved = await resolveDerivedBinding(
              threadKey.projectId,
              cbObj.entityType,
              cbObj.entityId
            );

            // Persist binding on Thread.metadata (spread directly per
            // ThreadArchitectureBindingMetadata sub-shape -- no nested wrapper).
            thread.metadata = thread.metadata || {};
            thread.metadata.boundArchitectureId = resolved.architectureId;
            thread.metadata.boundArchitectureName = resolved.architectureName;
            thread.metadata.boundEntityType = cbObj.entityType;
            thread.metadata.boundEntityId = cbObj.entityId;
            await saveThread(threadKey, thread);

            logger.info('ChatV2 derived-from-context: bound conversation to architecture', {
              requestId,
              taskId: task.id,
              boundArchitectureId: resolved.architectureId,
              boundArchitectureName: resolved.architectureName,
              boundEntityType: cbObj.entityType,
              boundEntityId: cbObj.entityId,
            });
          } catch (err) {
            if (err instanceof DerivedBindingError) {
              bindingError = {
                status: 422,
                code: err.code,
                message: err.message,
              };
              logger.warn('ChatV2 derived-from-context: resolver refused contextBinding', {
                requestId,
                taskId: task.id,
                code: err.code,
                message: err.message,
                attemptedEntityType: cbObj.entityType,
                attemptedEntityId: cbObj.entityId,
              });
            } else {
              // Unexpected error -- log and surface as lookup_failed so the
              // frontend / next LLM turn can inform the user.
              logger.error('ChatV2 derived-from-context: unexpected resolver failure', {
                requestId,
                taskId: task.id,
                error: err instanceof Error ? err.message : 'Unknown error',
              });
              bindingError = {
                status: 422,
                code: 'lookup_failed',
                message:
                  err instanceof Error ? err.message : 'Unknown lookup failure',
              };
            }
          }
        }
      }
    }

    // ---- Step 10: Append user + assistant messages to thread ----
    const userMessage: ThreadMessage = {
      id: uuidv4(),
      role: 'user',
      personaId: null,
      taskId: request.taskId,
      content: request.message,
      structuredResponse: null,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, userMessage);

    const assistantMessage: ThreadMessage = {
      id: uuidv4(),
      role: 'assistant',
      personaId: request.personaId,
      taskId: request.taskId,
      content: assistantContent,
      structuredResponse: structuredResponse,
      timestamp: new Date().toISOString(),
    };
    await appendMessage(threadKey, assistantMessage);

    // ---- Step 10b: Summarisation check (hub and panel threads only) ----
    if (threadKey.type === 'hub' || threadKey.type === 'panel') {
      try {
        // Re-read thread to include the just-appended messages
        const updatedThread = await getThread(threadKey);
        if (updatedThread) {
          await maybeSummariseThread(updatedThread, threadKey, requestId);
        }
      } catch (summarisationError) {
        logger.error('Summarisation failed (non-blocking)', {
          requestId,
          threadKey: threadKeyStr,
          error: summarisationError instanceof Error ? summarisationError.message : 'Unknown error',
        });
        // Summarisation failure must not block the user's conversation
      }
    }

    // ---- Step 11: Return ChatV2Response ----
    const response: ChatV2Response = {
      threadKey: threadKeyStr,
      personaId: request.personaId,
      taskId: request.taskId,
      assistant: {
        message: assistantContent,
      },
      structuredResponse,
      ...(validationError ? { error: validationError } : {}),
      // Spec 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5)
      // Group 6: surface DerivedBindingError refusals from Step 9c so the
      // frontend can render the inline failure (HTTP status remains 200 --
      // the chat turn itself succeeded; only the binding side effect failed).
      ...(bindingError ? { bindingError } : {}),
    };

    res.json(response);
  } catch (error) {
    logger.error('ChatV2 request failed', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });

    res.status(500).json({
      error: 'Internal server error',
    });
  }
});
