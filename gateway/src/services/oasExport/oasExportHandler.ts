/**
 * OAS Export handler — deterministic OpenAPI contract generation for an
 * architecture's interfaces.
 *
 * Direct build 2026-06-11 (oracle weaknesses #5). Read-only: nothing is
 * written to AMS; a download is a regeneration (same model → same bytes).
 *
 * Data flow per interface:
 *   AMS elements-inventory (architecture-scoped interface list)
 *     → mcp `get_interface_oas_context` (full endpoint/entity context)
 *     → mcp `compute_oas_gaps`        (deterministic gaps/defaults/ids/types)
 *     → `assembleOasDocument`          (pure assembly, coverage-asserted)
 *
 * The two mcp tools are the same deterministic engine the chat-driven
 * `architect--oas-spec` task uses, so conversational and exported contracts
 * can never drift apart.
 */

import { randomUUID } from 'crypto';
import { executeTool } from '../toolExecutor';
import { getElementsInventory } from '../architectureModelClient';
import { logger } from '../logger';
import { assembleOasDocument, slugifyFilename } from './assembleOasDocument';
import { InterfaceOasContext, OasExportResult, OasGapReport } from './types';

export class OasExportUpstreamError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'OasExportUpstreamError';
    this.status = status;
  }
}

export interface OasExportInterfaceSummary {
  id: string;
  name: string;
}

/** One entry of a generate-all run: a result or an accounted failure. */
export interface OasExportAllEntry {
  interfaceId: string;
  interfaceName: string;
  result?: OasExportResult;
  error?: string;
}

// ---------------------------------------------------------------------------
// Dependency seams (tests override; production uses the defaults)
// ---------------------------------------------------------------------------

export interface OasExportDeps {
  fetchInventory: typeof getElementsInventory;
  runTool: typeof executeTool;
}

const defaultDeps: OasExportDeps = {
  fetchInventory: getElementsInventory,
  runTool: executeTool,
};

// ---------------------------------------------------------------------------
// Interface listing (architecture-scoped via AMS elements inventory)
// ---------------------------------------------------------------------------

export async function listExportableInterfaces(
  projectId: string,
  architectureId: string,
  deps: OasExportDeps = defaultDeps
): Promise<OasExportInterfaceSummary[]> {
  const inventory = await deps.fetchInventory(projectId, architectureId);
  const interfaces: OasExportInterfaceSummary[] = [];
  for (const domain of inventory?.domains ?? []) {
    for (const type of domain.types ?? []) {
      if (type.entityType !== 'interfaces') continue;
      for (const instance of type.instances ?? []) {
        interfaces.push({ id: instance.id, name: instance.name });
      }
    }
  }
  interfaces.sort((a, b) => a.name.localeCompare(b.name));
  return interfaces;
}

// ---------------------------------------------------------------------------
// Per-interface generation
// ---------------------------------------------------------------------------

/** Unwraps an executeTool result, throwing OasExportUpstreamError on failure. */
function unwrapToolResult<T>(
  toolName: string,
  outcome: { result: unknown; status: number }
): T {
  const { result, status } = outcome;
  const errorMessage =
    result && typeof result === 'object' && 'error' in result
      ? String((result as { error: unknown }).error)
      : null;
  if (status >= 400 || errorMessage) {
    throw new OasExportUpstreamError(
      status >= 400 ? status : 502,
      `${toolName} failed: ${errorMessage ?? `status ${status}`}`
    );
  }
  return result as T;
}

export async function generateOasForInterface(
  interfaceId: string,
  deps: OasExportDeps = defaultDeps,
  mcpSessionId?: string
): Promise<OasExportResult> {
  const sessionId = mcpSessionId ?? `oas-export-${randomUUID()}`;
  const requestId = `oas-export-${interfaceId}`;

  const contextOutcome = await deps.runTool(
    'get_interface_oas_context',
    { interfaceId },
    sessionId,
    requestId,
    sessionId
  );
  const context = unwrapToolResult<InterfaceOasContext>(
    'get_interface_oas_context',
    contextOutcome
  );

  const gapsOutcome = await deps.runTool(
    'compute_oas_gaps',
    { interfaceId },
    sessionId,
    requestId,
    sessionId
  );
  const gapReport = unwrapToolResult<OasGapReport>('compute_oas_gaps', gapsOutcome);

  const { document, summary } = assembleOasDocument(context, gapReport);

  return {
    interfaceId,
    interfaceName: context.interface.name,
    suggestedFilename: `${slugifyFilename(context.interface.name)}.openapi.json`,
    document,
    gapReport,
    summary,
  };
}

// ---------------------------------------------------------------------------
// Generate-all (coverage-guaranteed: every interface yields a result or an
// accounted error — never a silent skip)
// ---------------------------------------------------------------------------

export async function generateAllOas(
  projectId: string,
  architectureId: string,
  deps: OasExportDeps = defaultDeps
): Promise<OasExportAllEntry[]> {
  const interfaces = await listExportableInterfaces(projectId, architectureId, deps);
  const sessionId = `oas-export-${randomUUID()}`;
  const entries: OasExportAllEntry[] = [];

  for (const iface of interfaces) {
    try {
      const result = await generateOasForInterface(iface.id, deps, sessionId);
      entries.push({ interfaceId: iface.id, interfaceName: iface.name, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.warn('oas-export: interface generation failed', {
        projectId,
        architectureId,
        interfaceId: iface.id,
        message,
      });
      entries.push({ interfaceId: iface.id, interfaceName: iface.name, error: message });
    }
  }

  if (entries.length !== interfaces.length) {
    throw new Error(
      `oas-export coverage mismatch: ${interfaces.length} interfaces, ` +
        `${entries.length} accounted.`
    );
  }
  return entries;
}
