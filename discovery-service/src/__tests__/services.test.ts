import {
  initializeAnalyzerRegistry,
  getAnalyzerRegistry,
  registerAnalyzerPack,
} from '../services/analyzerRegistry';
import { stubAnalyzerPack } from '../services/stubAnalyzerPack';
import { AnalyzerPack, AnalyzerInput } from '../types';

describe('Analyzer Registry and Stub Analyzer', () => {
  beforeEach(() => {
    // Re-initialize the registry before each test for isolation
    initializeAnalyzerRegistry();
  });

  test('initializeAnalyzerRegistry() populates the registry with the stub-noop analyzer', () => {
    const registry = getAnalyzerRegistry();
    // Registry now contains both stub-noop and phase-1a-universal-extraction
    expect(registry.size).toBe(2);
    expect(registry.has('stub-noop')).toBe(true);
    expect(registry.has('phase-1a-universal-extraction')).toBe(true);
  });

  test('getAnalyzerRegistry() returns a Map containing the registered stub analyzer', () => {
    const registry = getAnalyzerRegistry();
    expect(registry).toBeInstanceOf(Map);
    const stub = registry.get('stub-noop');
    expect(stub).toBeDefined();
    expect(stub!.id).toBe('stub-noop');
  });

  test('registerAnalyzerPack() adds a new analyzer to the registry', () => {
    const customPack: AnalyzerPack = {
      id: 'custom-test',
      name: 'Custom Test Analyzer',
      description: 'A test analyzer',
      supportedPhases: ['phase0'],
      analyze: async (input: AnalyzerInput) => ({
        analyzerId: 'custom-test',
        phase: input.phase,
        step: input.step,
        findings: [],
        metadata: {},
      }),
    };

    registerAnalyzerPack(customPack);

    const registry = getAnalyzerRegistry();
    // 2 built-in (stub + phase1a) + 1 custom = 3
    expect(registry.size).toBe(3);
    expect(registry.has('custom-test')).toBe(true);
    expect(registry.get('custom-test')!.name).toBe('Custom Test Analyzer');
  });

  test('Stub analyzer analyze() returns an AnalyzerResult with empty findings and metadata: { stub: true }', async () => {
    const input: AnalyzerInput = {
      projectId: 'test-project',
      phase: 'phase0',
      step: 'frame',
      context: {},
    };

    const result = await stubAnalyzerPack.analyze(input);

    expect(result.analyzerId).toBe('stub-noop');
    expect(result.phase).toBe('phase0');
    expect(result.step).toBe('frame');
    expect(result.findings).toEqual([]);
    expect(result.metadata).toEqual({ stub: true });
  });

  test('Stub analyzer has correct metadata', () => {
    expect(stubAnalyzerPack.id).toBe('stub-noop');
    expect(stubAnalyzerPack.name).toBe('Stub No-Op Analyzer');
    expect(stubAnalyzerPack.supportedPhases).toEqual(['phase0', 'phase1']);
  });
});
