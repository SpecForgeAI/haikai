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
import {
  parseAndValidateRoadmapJson,
  buildMatchingMaps,
  saveRoadmapStructure,
} from '../services/roadmapStructureService';
import { WorkItemDto } from '../types/saveRoadmapStructure';

const mockListWorkItems = archModelClient.listWorkItems as jest.Mock;
const mockCreateWorkItem = archModelClient.createWorkItem as jest.Mock;
const mockUpdateWorkItem = archModelClient.updateWorkItem as jest.Mock;

describe('roadmapStructureService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // Test 1: parseAndValidateRoadmapJson - invalid JSON throws 400
  // ============================================================================
  describe('parseAndValidateRoadmapJson - invalid JSON', () => {
    it('throws 400 error when roadmapJson is not valid JSON', () => {
      try {
        parseAndValidateRoadmapJson('{ not valid json }');
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('Invalid JSON');
      }
    });
  });

  // ============================================================================
  // Test 2: parseAndValidateRoadmapJson - empty initiatives array throws 400
  // ============================================================================
  describe('parseAndValidateRoadmapJson - empty initiatives', () => {
    it('throws 400 error when initiatives array is empty', () => {
      try {
        parseAndValidateRoadmapJson(JSON.stringify({ initiatives: [] }));
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('initiatives array is required and must be non-empty');
      }
    });

    it('throws 400 error when initiatives field is missing', () => {
      try {
        parseAndValidateRoadmapJson(JSON.stringify({ other: 'data' }));
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('initiatives array is required and must be non-empty');
      }
    });
  });

  // ============================================================================
  // Test 3: parseAndValidateRoadmapJson - duplicate initiative titles throws 400
  // ============================================================================
  describe('parseAndValidateRoadmapJson - duplicate initiative titles', () => {
    it('throws 400 error when initiative titles are duplicated case-insensitively', () => {
      const input = {
        initiatives: [
          { title: 'Platform Modernization' },
          { title: 'platform modernization' },
        ],
      };

      try {
        parseAndValidateRoadmapJson(JSON.stringify(input));
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('Duplicate initiative title');
      }
    });
  });

  // ============================================================================
  // Test 4: parseAndValidateRoadmapJson - duplicate epic titles within same initiative
  //         throws 400; epics under different initiatives with same title is ALLOWED
  // ============================================================================
  describe('parseAndValidateRoadmapJson - duplicate epic titles', () => {
    it('throws 400 error when epic titles are duplicated within the same initiative', () => {
      const input = {
        initiatives: [
          {
            title: 'Initiative A',
            epics: [
              { title: 'Shared Epic Name' },
              { title: 'shared epic name' },
            ],
          },
        ],
      };

      try {
        parseAndValidateRoadmapJson(JSON.stringify(input));
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error.statusCode).toBe(400);
        expect(error.message).toContain('Duplicate epic title within initiative');
      }
    });

    it('allows same epic title under different initiatives', () => {
      const input = {
        initiatives: [
          {
            title: 'Initiative A',
            epics: [{ title: 'Common Epic' }],
          },
          {
            title: 'Initiative B',
            epics: [{ title: 'Common Epic' }],
          },
        ],
      };

      const result = parseAndValidateRoadmapJson(JSON.stringify(input));
      expect(result.initiatives).toHaveLength(2);
      expect(result.initiatives[0].epics![0].title).toBe('Common Epic');
      expect(result.initiatives[1].epics![0].title).toBe('Common Epic');
    });
  });

  // ============================================================================
  // Test 5: buildMatchingMaps - builds externalRef map and type-scoped title map
  // ============================================================================
  describe('buildMatchingMaps', () => {
    it('builds externalRef map and type-scoped title map correctly', () => {
      const existingItems: WorkItemDto[] = [
        {
          id: 'wi-001',
          project_id: 'proj-1',
          type: 'INITIATIVE',
          parent_id: null,
          title: 'Platform Modernization',
          description: null,
          status: 'PLANNED',
          sort_order: 0,
          priority: null,
          target_window: null,
          tags: null,
          external_system: 'JIRA',
          external_key: 'INIT-100',
          external_url: null,
          created_at: null,
          updated_at: null,
        },
        {
          id: 'wi-002',
          project_id: 'proj-1',
          type: 'EPIC',
          parent_id: 'wi-001',
          title: 'API Gateway',
          description: null,
          status: 'IN_PROGRESS',
          sort_order: 0,
          priority: null,
          target_window: null,
          tags: null,
          external_system: null,
          external_key: null,
          external_url: null,
          created_at: null,
          updated_at: null,
        },
        {
          id: 'wi-003',
          project_id: 'proj-1',
          type: 'INITIATIVE',
          parent_id: null,
          title: 'Data Migration',
          description: null,
          status: 'PLANNED',
          sort_order: 1,
          priority: null,
          target_window: null,
          tags: null,
          external_system: 'ADO',
          external_key: 'FEAT-200',
          external_url: null,
          created_at: null,
          updated_at: null,
        },
      ];

      const { externalRefMap, typeTitleMap } = buildMatchingMaps(existingItems);

      // Verify externalRefMap: only items with both external_system and external_key
      expect(Object.keys(externalRefMap)).toHaveLength(2);
      expect(externalRefMap['JIRA::INIT-100']).toEqual(existingItems[0]);
      expect(externalRefMap['ADO::FEAT-200']).toEqual(existingItems[2]);

      // Verify typeTitleMap: all items keyed by type::title.toLowerCase()
      expect(Object.keys(typeTitleMap)).toHaveLength(3);
      expect(typeTitleMap['INITIATIVE::platform modernization']).toEqual(existingItems[0]);
      expect(typeTitleMap['EPIC::api gateway']).toEqual(existingItems[1]);
      expect(typeTitleMap['INITIATIVE::data migration']).toEqual(existingItems[2]);
    });
  });

  // ============================================================================
  // Test 6: Full saveRoadmapStructure - create-only scenario
  // ============================================================================
  describe('saveRoadmapStructure - create-only scenario', () => {
    it('creates initiatives with sort_order, then epics with parent_id and sort_order, status="PLANNED"', async () => {
      // No existing work items
      mockListWorkItems.mockResolvedValue([]);

      // Mock createWorkItem to return items with generated IDs
      let createCallIndex = 0;
      mockCreateWorkItem.mockImplementation(async (_projectId: string, dto: Partial<WorkItemDto>) => {
        createCallIndex++;
        return {
          id: `wi-created-${createCallIndex}`,
          project_id: 'proj-123',
          type: dto.type,
          parent_id: dto.parent_id,
          title: dto.title,
          description: dto.description,
          status: dto.status,
          sort_order: dto.sort_order,
          priority: null,
          target_window: null,
          tags: null,
          external_system: dto.external_system || null,
          external_key: dto.external_key || null,
          external_url: null,
          created_at: '2026-02-16T00:00:00Z',
          updated_at: null,
        } as WorkItemDto;
      });

      const roadmapJson = JSON.stringify({
        initiatives: [
          {
            title: 'Platform Modernization',
            description: 'Modernize the platform',
            epics: [
              { title: 'API Gateway', description: 'Build API gateway' },
              { title: 'Auth Service', description: 'Build auth service' },
            ],
          },
          {
            title: 'Data Migration',
            epics: [
              { title: 'Schema Migration' },
            ],
          },
        ],
      });

      const result = await saveRoadmapStructure('proj-123', roadmapJson);

      // Verify counts
      expect(result.createdInitiatives).toBe(2);
      expect(result.updatedInitiatives).toBe(0);
      expect(result.createdEpics).toBe(3);
      expect(result.updatedEpics).toBe(0);
      expect(result.warnings).toHaveLength(0);

      // Verify listWorkItems was called
      expect(mockListWorkItems).toHaveBeenCalledWith('proj-123');

      // Verify createWorkItem calls: 2 initiatives + 3 epics = 5 calls
      expect(mockCreateWorkItem).toHaveBeenCalledTimes(5);

      // First initiative: sort_order=0, parent_id=null, status=PLANNED
      const firstInitCall = mockCreateWorkItem.mock.calls[0];
      expect(firstInitCall[0]).toBe('proj-123');
      expect(firstInitCall[1]).toMatchObject({
        type: 'INITIATIVE',
        title: 'Platform Modernization',
        description: 'Modernize the platform',
        status: 'PLANNED',
        sort_order: 0,
        parent_id: null,
      });

      // Second initiative: sort_order=1
      const secondInitCall = mockCreateWorkItem.mock.calls[1];
      expect(secondInitCall[1]).toMatchObject({
        type: 'INITIATIVE',
        title: 'Data Migration',
        status: 'PLANNED',
        sort_order: 1,
        parent_id: null,
      });

      // First epic under first initiative: parent_id=wi-created-1 (first initiative), sort_order=0
      const firstEpicCall = mockCreateWorkItem.mock.calls[2];
      expect(firstEpicCall[1]).toMatchObject({
        type: 'EPIC',
        title: 'API Gateway',
        description: 'Build API gateway',
        status: 'PLANNED',
        sort_order: 0,
        parent_id: 'wi-created-1', // First initiative's ID
      });

      // Second epic under first initiative: sort_order=1
      const secondEpicCall = mockCreateWorkItem.mock.calls[3];
      expect(secondEpicCall[1]).toMatchObject({
        type: 'EPIC',
        title: 'Auth Service',
        status: 'PLANNED',
        sort_order: 1,
        parent_id: 'wi-created-1',
      });

      // Epic under second initiative: parent_id=wi-created-2, sort_order=0
      const thirdEpicCall = mockCreateWorkItem.mock.calls[4];
      expect(thirdEpicCall[1]).toMatchObject({
        type: 'EPIC',
        title: 'Schema Migration',
        status: 'PLANNED',
        sort_order: 0,
        parent_id: 'wi-created-2', // Second initiative's ID
      });

      // Verify updateWorkItem was NOT called
      expect(mockUpdateWorkItem).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Test 7: Full saveRoadmapStructure - update scenario (externalRef match)
  // ============================================================================
  describe('saveRoadmapStructure - update scenario with externalRef match', () => {
    it('updates title/description/sort_order but does NOT overwrite status', async () => {
      const existingInitiative: WorkItemDto = {
        id: 'wi-existing-init',
        project_id: 'proj-123',
        type: 'INITIATIVE',
        parent_id: null,
        title: 'Old Initiative Title',
        description: 'Old description',
        status: 'IN_PROGRESS',
        sort_order: 5,
        priority: 'HIGH',
        target_window: 'Q1 2026',
        tags: 'legacy',
        external_system: 'JIRA',
        external_key: 'INIT-100',
        external_url: 'https://jira.example.com/INIT-100',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-15T00:00:00Z',
      };

      mockListWorkItems.mockResolvedValue([existingInitiative]);

      // Mock updateWorkItem to return the updated item
      mockUpdateWorkItem.mockImplementation(async (_projectId: string, _workItemId: string, dto: Partial<WorkItemDto>) => {
        return {
          ...existingInitiative,
          ...dto,
          // Backend preserves status since we don't send it
          status: existingInitiative.status,
        } as WorkItemDto;
      });

      const roadmapJson = JSON.stringify({
        initiatives: [
          {
            title: 'New Initiative Title',
            description: 'Updated description',
            externalRef: { system: 'JIRA', key: 'INIT-100' },
          },
        ],
      });

      const result = await saveRoadmapStructure('proj-123', roadmapJson);

      // Verify counts
      expect(result.createdInitiatives).toBe(0);
      expect(result.updatedInitiatives).toBe(1);
      expect(result.createdEpics).toBe(0);
      expect(result.updatedEpics).toBe(0);

      // Verify updateWorkItem was called with correct arguments
      expect(mockUpdateWorkItem).toHaveBeenCalledTimes(1);
      const updateCall = mockUpdateWorkItem.mock.calls[0];
      expect(updateCall[0]).toBe('proj-123');
      expect(updateCall[1]).toBe('wi-existing-init');

      const updateDto = updateCall[2];
      expect(updateDto.title).toBe('New Initiative Title');
      expect(updateDto.description).toBe('Updated description');
      expect(updateDto.sort_order).toBe(0);
      expect(updateDto.parent_id).toBeNull();
      expect(updateDto.external_system).toBe('JIRA');
      expect(updateDto.external_key).toBe('INIT-100');

      // Verify status is NOT in the update DTO
      expect(updateDto).not.toHaveProperty('status');

      // Verify warning about title mismatch
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('ExternalRef match');
      expect(result.warnings[0]).toContain('Old Initiative Title');
      expect(result.warnings[0]).toContain('New Initiative Title');

      // Verify createWorkItem was NOT called
      expect(mockCreateWorkItem).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Test 8: Full saveRoadmapStructure - title-fallback match adds warning
  // ============================================================================
  describe('saveRoadmapStructure - title-fallback match', () => {
    it('matches by title when no externalRef is provided and adds a warning', async () => {
      const existingInitiative: WorkItemDto = {
        id: 'wi-title-match',
        project_id: 'proj-123',
        type: 'INITIATIVE',
        parent_id: null,
        title: 'Platform Modernization',
        description: 'Original description',
        status: 'PLANNED',
        sort_order: 0,
        priority: null,
        target_window: null,
        tags: null,
        external_system: null,
        external_key: null,
        external_url: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: null,
      };

      mockListWorkItems.mockResolvedValue([existingInitiative]);

      mockUpdateWorkItem.mockImplementation(async (_projectId: string, _workItemId: string, dto: Partial<WorkItemDto>) => {
        return {
          ...existingInitiative,
          ...dto,
        } as WorkItemDto;
      });

      const roadmapJson = JSON.stringify({
        initiatives: [
          {
            title: 'Platform Modernization',
            description: 'Updated description',
          },
        ],
      });

      const result = await saveRoadmapStructure('proj-123', roadmapJson);

      // Verify it was an update (matched by title)
      expect(result.createdInitiatives).toBe(0);
      expect(result.updatedInitiatives).toBe(1);

      // Verify warning about title-fallback match
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Title-fallback match');
      expect(result.warnings[0]).toContain('Platform Modernization');
      expect(result.warnings[0]).toContain('wi-title-match');

      // Verify updateWorkItem was called correctly
      expect(mockUpdateWorkItem).toHaveBeenCalledTimes(1);
      expect(mockUpdateWorkItem).toHaveBeenCalledWith(
        'proj-123',
        'wi-title-match',
        expect.objectContaining({
          title: 'Platform Modernization',
          description: 'Updated description',
          sort_order: 0,
          parent_id: null,
        })
      );
    });
  });
});
