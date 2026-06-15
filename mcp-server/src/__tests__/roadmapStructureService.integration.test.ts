/**
 * Integration / Gap-Fill Tests for roadmapStructureService
 *
 * Covers gaps identified from reviewing the existing test suites:
 * - archModelClient.workItems.test.ts (5 tests: HTTP methods)
 * - roadmapStructureService.test.ts (10 tests: validation, matching, orchestration)
 * - saveRoadmapStructureRoute.test.ts (5 tests: route validation, success, error)
 * - toolExecutor.saveRoadmapStructure.test.ts (5 tests: gateway registration)
 *
 * These 10 tests fill the following gaps:
 * 1. Mixed create/update scenario
 * 2. ExternalRef match where existing title differs (rename warning)
 * 3. Epic title uniqueness scoped within initiative
 * 4. Update path: status field is NOT in updateWorkItem DTO
 * 5. Update path: sort_order IS overwritten to new position
 * 6. Create path: status is "PLANNED" and delivery_team_id-related fields are null
 * 7. externalRef.id present in input is ignored
 * 8. Service throws 502 when listWorkItems fails
 * 9. Empty epics array: initiative created, zero epics
 * 10. Large roadmap: 10 initiatives with 5 epics each, correct phase order
 */

// Mock dotenv before importing anything else
jest.mock('dotenv', () => ({
  config: jest.fn(),
}));

// Mock archModelClient
jest.mock('../services/archModelClient', () => ({
  archModelClient: {
    listWorkItems: jest.fn(),
    createWorkItem: jest.fn(),
    updateWorkItem: jest.fn(),
  },
}));

import { archModelClient } from '../services/archModelClient';
import { saveRoadmapStructure } from '../services/roadmapStructureService';
import { WorkItemDto } from '../types/saveRoadmapStructure';

const mockListWorkItems = archModelClient.listWorkItems as jest.Mock;
const mockCreateWorkItem = archModelClient.createWorkItem as jest.Mock;
const mockUpdateWorkItem = archModelClient.updateWorkItem as jest.Mock;

// Helper: create a minimal WorkItemDto for test fixtures
function makeWorkItem(overrides: Partial<WorkItemDto>): WorkItemDto {
  return {
    id: 'wi-default',
    project_id: 'proj-int',
    type: 'INITIATIVE',
    parent_id: null,
    title: 'Default Title',
    description: null,
    status: 'PLANNED',
    sort_order: 0,
    priority: null,
    target_window: null,
    tags: null,
    external_system: null,
    external_key: null,
    external_url: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe('roadmapStructureService - integration / gap-fill tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==========================================================================
  // Gap 1: Mixed create/update scenario
  // Some initiatives matched by externalRef, some by title, some new
  // ==========================================================================
  it('handles mixed create/update: externalRef match, title match, and new initiative', async () => {
    const existingItems: WorkItemDto[] = [
      makeWorkItem({
        id: 'wi-ext-match',
        type: 'INITIATIVE',
        title: 'Existing By Ref',
        external_system: 'JIRA',
        external_key: 'INIT-001',
      }),
      makeWorkItem({
        id: 'wi-title-match',
        type: 'INITIATIVE',
        title: 'Existing By Title',
      }),
    ];

    mockListWorkItems.mockResolvedValue(existingItems);

    let createCallCount = 0;
    mockCreateWorkItem.mockImplementation(async (_pid: string, dto: Partial<WorkItemDto>) => {
      createCallCount++;
      return makeWorkItem({ id: `wi-new-${createCallCount}`, ...dto } as any);
    });

    mockUpdateWorkItem.mockImplementation(async (_pid: string, wiId: string, dto: Partial<WorkItemDto>) => {
      const existing = existingItems.find(i => i.id === wiId)!;
      return { ...existing, ...dto } as WorkItemDto;
    });

    const roadmapJson = JSON.stringify({
      initiatives: [
        {
          title: 'Updated By Ref',
          description: 'Updated desc',
          externalRef: { system: 'JIRA', key: 'INIT-001' },
        },
        {
          title: 'Existing By Title',
          description: 'Title-matched update',
        },
        {
          title: 'Brand New Initiative',
          description: 'Completely new',
        },
      ],
    });

    const result = await saveRoadmapStructure('proj-int', roadmapJson);

    expect(result.createdInitiatives).toBe(1);
    expect(result.updatedInitiatives).toBe(2);
    expect(result.createdEpics).toBe(0);
    expect(result.updatedEpics).toBe(0);

    // Should have warnings: externalRef title mismatch + title-fallback match
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);

    // Verify updateWorkItem was called twice (externalRef match + title match)
    expect(mockUpdateWorkItem).toHaveBeenCalledTimes(2);

    // Verify createWorkItem was called once (new initiative)
    expect(mockCreateWorkItem).toHaveBeenCalledTimes(1);
    expect(mockCreateWorkItem.mock.calls[0][1]).toMatchObject({
      title: 'Brand New Initiative',
    });
  });

  // ==========================================================================
  // Gap 2: ExternalRef match where existing title differs -> rename warning
  // ==========================================================================
  it('produces rename warning when externalRef matches but titles differ', async () => {
    const existingItems: WorkItemDto[] = [
      makeWorkItem({
        id: 'wi-renamed',
        type: 'INITIATIVE',
        title: 'Old Name',
        external_system: 'ADO',
        external_key: 'FEAT-99',
      }),
    ];

    mockListWorkItems.mockResolvedValue(existingItems);
    mockUpdateWorkItem.mockImplementation(async (_pid: string, wiId: string, dto: Partial<WorkItemDto>) => {
      return { ...existingItems[0], ...dto } as WorkItemDto;
    });

    const roadmapJson = JSON.stringify({
      initiatives: [
        {
          title: 'New Name After Rename',
          externalRef: { system: 'ADO', key: 'FEAT-99' },
        },
      ],
    });

    const result = await saveRoadmapStructure('proj-int', roadmapJson);

    expect(result.updatedInitiatives).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('ExternalRef match');
    expect(result.warnings[0]).toContain('Old Name');
    expect(result.warnings[0]).toContain('New Name After Rename');
    expect(result.warnings[0]).toContain('possible rename');
  });

  // ==========================================================================
  // Gap 3: Epic title uniqueness scoped within initiative
  // Same title in different initiatives is OK
  // ==========================================================================
  it('allows same epic title under different initiatives (uniqueness scoped per initiative)', async () => {
    mockListWorkItems.mockResolvedValue([]);

    let createCallCount = 0;
    mockCreateWorkItem.mockImplementation(async (_pid: string, dto: Partial<WorkItemDto>) => {
      createCallCount++;
      return makeWorkItem({ id: `wi-c-${createCallCount}`, ...dto } as any);
    });

    const roadmapJson = JSON.stringify({
      initiatives: [
        {
          title: 'Initiative Alpha',
          epics: [
            { title: 'Setup Infrastructure' },
            { title: 'Data Migration' },
          ],
        },
        {
          title: 'Initiative Beta',
          epics: [
            { title: 'Setup Infrastructure' },  // same title, different initiative
            { title: 'Security Hardening' },
          ],
        },
      ],
    });

    const result = await saveRoadmapStructure('proj-int', roadmapJson);

    expect(result.createdInitiatives).toBe(2);
    expect(result.createdEpics).toBe(4);
    // Total create calls: 2 initiatives + 4 epics = 6
    expect(mockCreateWorkItem).toHaveBeenCalledTimes(6);
  });

  // ==========================================================================
  // Gap 4: Update path: verify status field is NOT in the updateWorkItem DTO
  // ==========================================================================
  it('does not include status field in the update DTO', async () => {
    const existingItems: WorkItemDto[] = [
      makeWorkItem({
        id: 'wi-status-check',
        type: 'EPIC',
        title: 'Epic To Update',
        status: 'IN_PROGRESS',
        parent_id: 'parent-init-id',
        external_system: 'JIRA',
        external_key: 'EPIC-50',
      }),
      makeWorkItem({
        id: 'parent-init-id',
        type: 'INITIATIVE',
        title: 'Parent Initiative',
        external_system: 'JIRA',
        external_key: 'INIT-50',
      }),
    ];

    mockListWorkItems.mockResolvedValue(existingItems);
    mockUpdateWorkItem.mockImplementation(async (_pid: string, wiId: string, dto: Partial<WorkItemDto>) => {
      const existing = existingItems.find(i => i.id === wiId)!;
      return { ...existing, ...dto } as WorkItemDto;
    });

    const roadmapJson = JSON.stringify({
      initiatives: [
        {
          title: 'Parent Initiative',
          externalRef: { system: 'JIRA', key: 'INIT-50' },
          epics: [
            {
              title: 'Epic To Update',
              description: 'Updated epic desc',
              externalRef: { system: 'JIRA', key: 'EPIC-50' },
            },
          ],
        },
      ],
    });

    await saveRoadmapStructure('proj-int', roadmapJson);

    // Both the initiative and the epic should be updated
    expect(mockUpdateWorkItem).toHaveBeenCalledTimes(2);

    // Check the epic update DTO (second call)
    const epicUpdateDto = mockUpdateWorkItem.mock.calls[1][2];
    expect(epicUpdateDto).not.toHaveProperty('status');
    expect(epicUpdateDto).not.toHaveProperty('tags');
    expect(epicUpdateDto).not.toHaveProperty('external_url');
  });

  // ==========================================================================
  // Gap 5: Update path: verify sort_order IS overwritten to new position
  // ==========================================================================
  it('overwrites sort_order to reflect new position on update', async () => {
    // Two existing initiatives with sort_order 0 and 1, we will swap their order
    const existingItems: WorkItemDto[] = [
      makeWorkItem({
        id: 'wi-first',
        type: 'INITIATIVE',
        title: 'First Initiative',
        sort_order: 0,
        external_system: 'JIRA',
        external_key: 'INIT-A',
      }),
      makeWorkItem({
        id: 'wi-second',
        type: 'INITIATIVE',
        title: 'Second Initiative',
        sort_order: 1,
        external_system: 'JIRA',
        external_key: 'INIT-B',
      }),
    ];

    mockListWorkItems.mockResolvedValue(existingItems);
    mockUpdateWorkItem.mockImplementation(async (_pid: string, wiId: string, dto: Partial<WorkItemDto>) => {
      const existing = existingItems.find(i => i.id === wiId)!;
      return { ...existing, ...dto } as WorkItemDto;
    });

    // Input has them in reversed order
    const roadmapJson = JSON.stringify({
      initiatives: [
        {
          title: 'Second Initiative',
          externalRef: { system: 'JIRA', key: 'INIT-B' },
        },
        {
          title: 'First Initiative',
          externalRef: { system: 'JIRA', key: 'INIT-A' },
        },
      ],
    });

    await saveRoadmapStructure('proj-int', roadmapJson);

    expect(mockUpdateWorkItem).toHaveBeenCalledTimes(2);

    // First call: "Second Initiative" now at index 0
    const firstUpdateDto = mockUpdateWorkItem.mock.calls[0][2];
    expect(firstUpdateDto.sort_order).toBe(0);
    expect(firstUpdateDto.title).toBe('Second Initiative');

    // Second call: "First Initiative" now at index 1
    const secondUpdateDto = mockUpdateWorkItem.mock.calls[1][2];
    expect(secondUpdateDto.sort_order).toBe(1);
    expect(secondUpdateDto.title).toBe('First Initiative');
  });

  // ==========================================================================
  // Gap 6: Create path: verify status is "PLANNED" and other fields are null
  // ==========================================================================
  it('sets status to PLANNED and nullable fields to null on create', async () => {
    mockListWorkItems.mockResolvedValue([]);

    let createCallCount = 0;
    mockCreateWorkItem.mockImplementation(async (_pid: string, dto: Partial<WorkItemDto>) => {
      createCallCount++;
      return makeWorkItem({ id: `wi-new-${createCallCount}`, ...dto } as any);
    });

    const roadmapJson = JSON.stringify({
      initiatives: [
        {
          title: 'New Initiative',
          description: 'Fresh one',
          epics: [
            { title: 'New Epic' },
          ],
        },
      ],
    });

    await saveRoadmapStructure('proj-int', roadmapJson);

    expect(mockCreateWorkItem).toHaveBeenCalledTimes(2);

    // Check initiative create DTO
    const initDto = mockCreateWorkItem.mock.calls[0][1];
    expect(initDto.status).toBe('PLANNED');
    expect(initDto.priority).toBeNull();
    expect(initDto.target_window).toBeNull();
    expect(initDto.tags).toBeNull();
    expect(initDto.external_url).toBeNull();
    expect(initDto.parent_id).toBeNull();

    // Check epic create DTO
    const epicDto = mockCreateWorkItem.mock.calls[1][1];
    expect(epicDto.status).toBe('PLANNED');
    expect(epicDto.priority).toBeNull();
    expect(epicDto.tags).toBeNull();
    expect(epicDto.external_url).toBeNull();
    expect(epicDto.parent_id).toBe('wi-new-1'); // parent is the initiative
  });

  // ==========================================================================
  // Gap 7: externalRef.id present in input is ignored (not in create/update DTO)
  // ==========================================================================
  it('ignores externalRef.id and does not include it in create or update DTOs', async () => {
    // One existing item to trigger update path
    const existingItems: WorkItemDto[] = [
      makeWorkItem({
        id: 'wi-existing',
        type: 'INITIATIVE',
        title: 'Existing Initiative',
        external_system: 'JIRA',
        external_key: 'INIT-X',
      }),
    ];

    mockListWorkItems.mockResolvedValue(existingItems);

    mockUpdateWorkItem.mockImplementation(async (_pid: string, wiId: string, dto: Partial<WorkItemDto>) => {
      return { ...existingItems[0], ...dto } as WorkItemDto;
    });

    let createCallCount = 0;
    mockCreateWorkItem.mockImplementation(async (_pid: string, dto: Partial<WorkItemDto>) => {
      createCallCount++;
      return makeWorkItem({ id: `wi-new-${createCallCount}`, ...dto } as any);
    });

    const roadmapJson = JSON.stringify({
      initiatives: [
        {
          title: 'Existing Initiative',
          externalRef: { system: 'JIRA', key: 'INIT-X', id: 'SHOULD-BE-IGNORED-1' },
          epics: [
            {
              title: 'New Epic With Ref',
              externalRef: { system: 'ADO', key: 'EPIC-1', id: 'SHOULD-BE-IGNORED-2' },
            },
          ],
        },
      ],
    });

    await saveRoadmapStructure('proj-int', roadmapJson);

    // Update path: externalRef.id should not be in the DTO
    expect(mockUpdateWorkItem).toHaveBeenCalledTimes(1);
    const updateDto = mockUpdateWorkItem.mock.calls[0][2];
    expect(updateDto).not.toHaveProperty('id');
    // The id field should not be overwritten by externalRef.id
    const updateDtoStr = JSON.stringify(updateDto);
    expect(updateDtoStr).not.toContain('SHOULD-BE-IGNORED');

    // Create path: externalRef.id should not be in the DTO
    expect(mockCreateWorkItem).toHaveBeenCalledTimes(1);
    const createDto = mockCreateWorkItem.mock.calls[0][1];
    expect(createDto).not.toHaveProperty('id');
    const createDtoStr = JSON.stringify(createDto);
    expect(createDtoStr).not.toContain('SHOULD-BE-IGNORED');

    // Verify external_system and external_key ARE included
    expect(createDto.external_system).toBe('ADO');
    expect(createDto.external_key).toBe('EPIC-1');
  });

  // ==========================================================================
  // Gap 8: Service throws 502 when listWorkItems fails
  // ==========================================================================
  it('throws 502 error when listWorkItems fails', async () => {
    mockListWorkItems.mockRejectedValue(new Error('ECONNREFUSED'));

    const roadmapJson = JSON.stringify({
      initiatives: [
        { title: 'Will Not Process' },
      ],
    });

    try {
      await saveRoadmapStructure('proj-int', roadmapJson);
      fail('Expected error to be thrown');
    } catch (error: any) {
      expect(error.statusCode).toBe(502);
      expect(error.message).toContain('Failed to fetch existing work items');
      expect(error.message).toContain('ECONNREFUSED');
    }

    // Verify no create/update calls were made
    expect(mockCreateWorkItem).not.toHaveBeenCalled();
    expect(mockUpdateWorkItem).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Gap 9: Empty epics array -> initiative created, zero epics
  // ==========================================================================
  it('creates initiative with zero epics when epics array is empty', async () => {
    mockListWorkItems.mockResolvedValue([]);

    let createCallCount = 0;
    mockCreateWorkItem.mockImplementation(async (_pid: string, dto: Partial<WorkItemDto>) => {
      createCallCount++;
      return makeWorkItem({ id: `wi-new-${createCallCount}`, ...dto } as any);
    });

    const roadmapJson = JSON.stringify({
      initiatives: [
        {
          title: 'Initiative With No Epics',
          description: 'Empty epic list',
          epics: [],
        },
        {
          title: 'Initiative Without Epics Key',
          description: 'No epics property at all',
        },
      ],
    });

    const result = await saveRoadmapStructure('proj-int', roadmapJson);

    expect(result.createdInitiatives).toBe(2);
    expect(result.updatedInitiatives).toBe(0);
    expect(result.createdEpics).toBe(0);
    expect(result.updatedEpics).toBe(0);
    expect(result.warnings).toHaveLength(0);

    // Only 2 create calls (initiatives only)
    expect(mockCreateWorkItem).toHaveBeenCalledTimes(2);
    expect(mockUpdateWorkItem).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Gap 10: Large roadmap: 10 initiatives with 5 epics each
  //         Verifies correct phase order (all initiatives before any epics)
  // ==========================================================================
  it('processes 10 initiatives with 5 epics each in correct phase order', async () => {
    mockListWorkItems.mockResolvedValue([]);

    const createCallOrder: Array<{ type: string; title: string; callIndex: number }> = [];
    let createCallCount = 0;

    mockCreateWorkItem.mockImplementation(async (_pid: string, dto: Partial<WorkItemDto>) => {
      createCallCount++;
      createCallOrder.push({
        type: dto.type!,
        title: dto.title!,
        callIndex: createCallCount,
      });
      return makeWorkItem({ id: `wi-${createCallCount}`, ...dto } as any);
    });

    // Build a large roadmap: 10 initiatives, each with 5 epics
    const initiatives = [];
    for (let i = 0; i < 10; i++) {
      const epics = [];
      for (let j = 0; j < 5; j++) {
        epics.push({ title: `Epic ${i}-${j}`, description: `Epic ${j} of Initiative ${i}` });
      }
      initiatives.push({
        title: `Initiative ${i}`,
        description: `Initiative number ${i}`,
        epics,
      });
    }

    const roadmapJson = JSON.stringify({ initiatives });

    const result = await saveRoadmapStructure('proj-int', roadmapJson);

    // Verify counts
    expect(result.createdInitiatives).toBe(10);
    expect(result.updatedInitiatives).toBe(0);
    expect(result.createdEpics).toBe(50);
    expect(result.updatedEpics).toBe(0);

    // Total calls: 10 initiatives + 50 epics = 60
    expect(mockCreateWorkItem).toHaveBeenCalledTimes(60);

    // Verify phase order: first 10 calls should all be INITIATIVE
    for (let i = 0; i < 10; i++) {
      expect(createCallOrder[i].type).toBe('INITIATIVE');
      expect(createCallOrder[i].title).toBe(`Initiative ${i}`);
    }

    // Remaining 50 calls should all be EPIC
    for (let i = 10; i < 60; i++) {
      expect(createCallOrder[i].type).toBe('EPIC');
    }

    // Verify sort_order for initiatives
    for (let i = 0; i < 10; i++) {
      const initCall = mockCreateWorkItem.mock.calls[i];
      expect(initCall[1].sort_order).toBe(i);
      expect(initCall[1].parent_id).toBeNull();
    }

    // Verify parent_id and sort_order for epics
    // Initiative 0 got id wi-1, Initiative 1 got id wi-2, etc.
    for (let i = 0; i < 10; i++) {
      for (let j = 0; j < 5; j++) {
        const epicCallIndex = 10 + (i * 5) + j;
        const epicCall = mockCreateWorkItem.mock.calls[epicCallIndex];
        expect(epicCall[1].sort_order).toBe(j);
        expect(epicCall[1].parent_id).toBe(`wi-${i + 1}`); // initiative IDs are wi-1 through wi-10
      }
    }
  });
});
