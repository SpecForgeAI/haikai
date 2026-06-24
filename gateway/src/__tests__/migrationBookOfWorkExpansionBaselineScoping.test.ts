/**
 * Bug-1 regression: the expansion prompt must NOT surface the API-only
 * `baselineId` concept on database-table inventory items.
 *
 * Spec: Migration Delivery Plan expansion — db_table baseline scoping
 * (2026-06-24 fix). Previously `describeInventoryItem` emitted
 * `baselineId=MISSING` for EVERY item regardless of kind, and the batch prompt
 * told the LLM to treat a "MISSING baseline" as an exceptional trigger — so the
 * LLM applied a bogus "No baselineId" readiness reason to schema (db_table)
 * stories. These assertions pin the scoping at the prompt boundary.
 */

import { buildExpansionBatchPrompt, InventoryWorkItem } from '../services/migrationBookOfWorkExpansionHandler';
import { MigrationBookOfWorkItem } from '../services/generatedMigrationBookOfWorkSchema';

const STREAM = 'target_database_schema_implementation';

function epic(): MigrationBookOfWorkItem {
  return {
    id: `${STREAM}:E1`,
    type: 'epic',
    parentId: null,
    title: 'Target schema foundation',
    description: 'desc',
    acceptanceCriteria: [],
    workstream: STREAM,
    sequenceOrder: 1,
    tags: [`stream:${STREAM}`],
    confidence: 'high',
    readiness: 'ready_for_spec',
    readinessReasons: [],
    missingInputs: [],
    recommendedNextAction: 'next',
    traceabilitySummary: 'trace',
  } as MigrationBookOfWorkItem;
}

function feature(): MigrationBookOfWorkItem {
  return { ...epic(), id: `${STREAM}:F1`, type: 'feature', parentId: `${STREAM}:E1` } as MigrationBookOfWorkItem;
}

const dbTableItem: InventoryWorkItem = {
  id: 'tbl-1',
  name: 'ValidationConfig',
  kind: 'db_table',
  baselineId: null,
};

const apiEndpointItem: InventoryWorkItem = {
  id: 'ep-1',
  name: 'GET /views/{viewId}',
  kind: 'api_endpoint',
  method: 'GET',
  path: '/views/{viewId}',
  baselineId: null,
};

describe('expansion prompt baseline scoping (bug 1)', () => {
  it('does NOT describe a db_table item with a baselineId line', () => {
    const prompt = buildExpansionBatchPrompt({
      epic: epic(),
      features: [feature()],
      batch: [dbTableItem],
      batchIndex: 0,
      batchCount: 1,
    });
    // The db_table item's description line must not mention baselineId at all.
    const itemLine = prompt.split('\n').find((l) => l.includes('id=tbl-1'));
    expect(itemLine).toBeDefined();
    expect(itemLine).not.toContain('baselineId');
  });

  it('DOES describe an api_endpoint item with a baselineId line', () => {
    const prompt = buildExpansionBatchPrompt({
      epic: { ...epic(), workstream: 'target_service_api_implementation' } as MigrationBookOfWorkItem,
      features: [feature()],
      batch: [apiEndpointItem],
      batchIndex: 0,
      batchCount: 1,
    });
    const itemLine = prompt.split('\n').find((l) => l.includes('id=ep-1'));
    expect(itemLine).toBeDefined();
    expect(itemLine).toContain('baselineId=MISSING');
  });

  it('scopes the "MISSING baseline" exceptional trigger to API endpoints', () => {
    const prompt = buildExpansionBatchPrompt({
      epic: epic(),
      features: [feature()],
      batch: [dbTableItem],
      batchIndex: 0,
      batchCount: 1,
    });
    expect(prompt).toContain('API endpoints ONLY');
    expect(prompt.toLowerCase()).toContain('database tables have no baseline');
  });
});
