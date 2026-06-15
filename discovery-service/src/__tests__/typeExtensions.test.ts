/**
 * Tests for CandidateType and EvidenceAtomType extensions.
 *
 * Spec: Extension Pack Framework & LLM File-Level Analysis
 * Task Group 1: CandidateType and EvidenceAtomType Extensions
 *
 * 4 focused tests:
 * 1. CandidateType union accepts 'endpoints', 'class', 'method', 'physical_data_attributes'
 * 2. EvidenceAtomType union accepts 'llm_file_analysis'
 * 3. LlmFileAnalysisData interface conforms to expected shape
 * 4. EvidenceAtomData union includes LlmFileAnalysisData
 */

import {
  CandidateType,
  EvidenceAtomType,
  EvidenceAtomData,
  DiscoveryCandidate,
  EvidenceAtom,
  LlmFileAnalysisData,
  LlmFileAnalysisRelationship,
} from '../types';

describe('Task Group 1: CandidateType and EvidenceAtomType Extensions', () => {

  // ==========================================================================
  // Test 1: CandidateType union accepts new values
  // ==========================================================================
  test('CandidateType union accepts endpoint, class, method, physical_attribute', () => {
    const endpoint: CandidateType = 'endpoints';
    const cls: CandidateType = 'class';
    const method: CandidateType = 'method';
    const physicalAttribute: CandidateType = 'physical_data_attributes';

    expect(endpoint).toBe('endpoints');
    expect(cls).toBe('class');
    expect(method).toBe('method');
    expect(physicalAttribute).toBe('physical_data_attributes');

    // Verify all 12 values are valid (8 existing + 4 new)
    const allTypes: CandidateType[] = [
      'application', 'app_component', 'service', 'logical_data_entities',
      'physical_data_entities', 'interfaces', 'business_process', 'data_entity',
      'endpoints', 'class', 'method', 'physical_data_attributes',
    ];
    expect(allTypes).toHaveLength(12);

    const uniqueTypes = new Set(allTypes);
    expect(uniqueTypes.size).toBe(12);

    // Verify new types can be used in a DiscoveryCandidate
    const candidate: DiscoveryCandidate = {
      id: 'cand-001',
      runId: 'run-001',
      candidateType: 'endpoints',
      name: 'GET /api/users',
      confidence: 0.9,
      status: 'proposed',
      sourceClusterIds: ['src/controllers/UserController.java'],
      data: { httpMethod: 'GET', path: '/api/users' },
      synthesizedAt: '2026-04-07T10:00:00Z',
    };
    expect(candidate.candidateType).toBe('endpoints');

    // Verify each new type works in DiscoveryCandidate
    for (const t of ['endpoints', 'class', 'method', 'physical_data_attributes'] as CandidateType[]) {
      const c: DiscoveryCandidate = { ...candidate, candidateType: t };
      expect(c.candidateType).toBe(t);
    }
  });

  // ==========================================================================
  // Test 2: EvidenceAtomType union accepts 'llm_file_analysis'
  // ==========================================================================
  test('EvidenceAtomType union accepts llm_file_analysis', () => {
    const llmType: EvidenceAtomType = 'llm_file_analysis';
    expect(llmType).toBe('llm_file_analysis');

    // Verify all 4 values are valid (3 existing + 1 new)
    const allTypes: EvidenceAtomType[] = [
      'file_structure', 'symbol', 'string_pattern', 'llm_file_analysis',
    ];
    expect(allTypes).toHaveLength(4);

    const uniqueTypes = new Set(allTypes);
    expect(uniqueTypes.size).toBe(4);

    // Verify it can be used in an EvidenceAtom with the correct data type
    const atom: EvidenceAtom = {
      id: 'atom-llm-001',
      runId: 'run-001',
      repoUrl: 'https://github.com/example/repo',
      filePath: 'src/main/java/UserController.java',
      type: 'llm_file_analysis',
      data: {
        filePath: 'src/main/java/UserController.java',
        entities: [],
        relationships: [],
        rawLlmResponse: '{}',
        analyzedAt: '2026-04-07T10:00:00Z',
      } as LlmFileAnalysisData,
      extractedAt: '2026-04-07T10:00:00Z',
    };
    expect(atom.type).toBe('llm_file_analysis');
  });

  // ==========================================================================
  // Test 3: LlmFileAnalysisData interface conforms to expected shape
  // ==========================================================================
  test('LlmFileAnalysisData interface has filePath, entities, relationships, rawLlmResponse, analyzedAt', () => {
    const data: LlmFileAnalysisData = {
      filePath: 'src/main/java/com/example/UserController.java',
      entities: [
        {
          entityType: 'class',
          name: 'UserController',
          confidence: 0.95,
          filePath: 'src/main/java/com/example/UserController.java',
          lineRange: [10, 150],
          parentEntityName: 'UserService',
          metadata: { annotations: ['@RestController'] },
        },
        {
          entityType: 'endpoints',
          name: 'GET /api/users',
          confidence: 0.9,
          filePath: 'src/main/java/com/example/UserController.java',
          metadata: { httpMethod: 'GET', path: '/api/users' },
        },
      ],
      relationships: [
        {
          sourceEntityName: 'GET /api/users',
          targetEntityName: 'UserController',
          relationshipType: 'belongs_to',
          detail: 'Endpoint method defined in UserController class',
        },
      ],
      rawLlmResponse: '{"entities":[...],"relationships":[...]}',
      analyzedAt: '2026-04-07T10:00:00Z',
    };

    // Verify required fields
    expect(data.filePath).toBe('src/main/java/com/example/UserController.java');
    expect(data.entities).toHaveLength(2);
    expect(data.relationships).toHaveLength(1);
    expect(data.rawLlmResponse).toBeTruthy();
    expect(data.analyzedAt).toBe('2026-04-07T10:00:00Z');

    // Verify entity shape
    const entity = data.entities[0];
    expect(entity.entityType).toBe('class');
    expect(entity.name).toBe('UserController');
    expect(entity.confidence).toBe(0.95);
    expect(entity.filePath).toBe('src/main/java/com/example/UserController.java');
    expect(entity.lineRange).toEqual([10, 150]);
    expect(entity.parentEntityName).toBe('UserService');
    expect(entity.metadata).toEqual({ annotations: ['@RestController'] });

    // Verify entity without optional fields
    const minimalEntity = data.entities[1];
    expect(minimalEntity.lineRange).toBeUndefined();
    expect(minimalEntity.parentEntityName).toBeUndefined();

    // Verify relationship shape
    const rel = data.relationships[0];
    expect(rel.sourceEntityName).toBe('GET /api/users');
    expect(rel.targetEntityName).toBe('UserController');
    expect(rel.relationshipType).toBe('belongs_to');
    expect(rel.detail).toBe('Endpoint method defined in UserController class');

    // Verify relationship without optional detail -- use the typed interface
    const minimalRel: LlmFileAnalysisRelationship = {
      sourceEntityName: 'A',
      targetEntityName: 'B',
      relationshipType: 'implements',
    };
    expect(minimalRel.detail).toBeUndefined();
  });

  // ==========================================================================
  // Test 4: EvidenceAtomData union includes LlmFileAnalysisData
  // ==========================================================================
  test('EvidenceAtomData union includes LlmFileAnalysisData', () => {
    // LlmFileAnalysisData should be assignable to EvidenceAtomData
    const llmData: LlmFileAnalysisData = {
      filePath: 'src/index.ts',
      entities: [
        {
          entityType: 'method',
          name: 'handleRequest',
          confidence: 0.85,
          filePath: 'src/index.ts',
          metadata: {},
        },
      ],
      relationships: [],
      rawLlmResponse: '{}',
      analyzedAt: '2026-04-07T10:00:00Z',
    };

    // Assign to EvidenceAtomData union -- this is a compile-time check
    const atomData: EvidenceAtomData = llmData;
    expect(atomData).toBeDefined();

    // Verify existing types still work in the union
    const fileStructureData: EvidenceAtomData = {
      relativePath: 'src/index.ts',
      extension: '.ts',
      sizeBytes: 1024,
      lineCount: 50,
    };
    expect(fileStructureData).toBeDefined();

    const symbolData: EvidenceAtomData = {
      name: 'main',
      kind: 'function',
      line: 1,
      scope: null,
      language: 'TypeScript',
    };
    expect(symbolData).toBeDefined();

    const patternData: EvidenceAtomData = {
      patternName: 'import_statement',
      matchedText: "import express from 'express'",
      line: 1,
      contextSnippet: "import express from 'express';",
    };
    expect(patternData).toBeDefined();
  });
});
