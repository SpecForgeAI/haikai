/**
 * W4 -- Scanner-failure visibility (close the silent-incompleteness hole).
 *
 * Quick-win audit fix (2026-05-30), NOT a spec.
 *
 * PROBLEM: a thrown framework adapter / pack scanner / contract pass /
 * runtime-evidence sub-stage used to be caught and only `console.error`'d --
 * that framework's endpoints silently vanished from a run that still reported
 * COMPLETED, with NO Finding.
 *
 * FIX: a new `scanner_failed` `EvidenceGapType` sentinel + the
 * `buildScannerFailedFinding` builder (severity 'high'). At each soft-fail
 * catch site, IN ADDITION to the existing log, the pipeline emits this Finding
 * via the existing FindingEmitInput -> caller-emit path (the soft-fail is
 * preserved -- other scanners still run; run status is NOT changed).
 *
 * These tests cover:
 *   1. The builder shape (findingType/category/severity, the failing scanner
 *      named in the title, the error in detailJson).
 *   2. `runPackFindingScanners`: a scanner that throws produces exactly ONE
 *      `scanner_failed` evidence-gap Finding naming it (with the error in
 *      detail); a clean run produces NONE.
 */
import type { SourceFileIR } from '../services/extensionPacks';
import type { DiscoveryCandidate } from '../types/candidate';
import { buildScannerFailedFinding } from '../services/findings/emissionSources';
import { runPackFindingScanners } from '../services/findings/packFindingScanners';

function isScannerFailed(f: { findingType: string; detailJson?: unknown }): boolean {
  return (
    f.findingType === 'evidence_gap' &&
    !!f.detailJson &&
    (f.detailJson as Record<string, unknown>).gapType === 'scanner_failed'
  );
}

describe('W4 -- buildScannerFailedFinding (builder shape)', () => {
  it('emits an evidence_gap finding, severity high, naming the scanner + carrying the error in detail', () => {
    const f = buildScannerFailedFinding({
      scanner: 'FrameworkPack:spring-classic',
      phase: 'stage2_framework_adapter',
      error: 'boom (synthetic)',
    });
    expect(f.findingType).toBe('evidence_gap');
    expect(f.category).toBe('evidence_gap');
    // A missing framework is serious -> 'high', distinct from the canonical
    // 'medium' gap-on-a-present-candidate severity.
    expect(f.severity).toBe('high');
    // Title names exactly which unit failed.
    expect(f.title).toContain('FrameworkPack:spring-classic');
    // Detail carries the sentinel, the scanner, the phase, and the error.
    expect(f.detailJson).toMatchObject({
      gapType: 'scanner_failed',
      scanner: 'FrameworkPack:spring-classic',
      phase: 'stage2_framework_adapter',
      error: 'boom (synthetic)',
    });
    // The error message also surfaces in the human-readable summary.
    expect(f.summary).toContain('boom (synthetic)');
    // Run-level: no candidate link (the candidates the scanner would have
    // produced do not exist).
    expect(f.links ?? []).toHaveLength(0);
  });
});

describe('W4 -- runPackFindingScanners surfaces a thrown scanner as a Finding', () => {
  function emptyInput(): {
    runId: string;
    irFiles: Map<string, SourceFileIR>;
    packCandidates: DiscoveryCandidate[];
  } {
    return {
      runId: 'w4-run-001',
      irFiles: new Map<string, SourceFileIR>(),
      packCandidates: [],
    };
  }

  it('a scanner that throws produces exactly ONE scanner_failed finding naming it (error in detail)', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    // Mock the Java scanner module so it throws when invoked. The shim imports
    // `runJavaFindingScanner` from this module; spying on the live module
    // exercises the same try/catch boundary the shim ships with (same idiom as
    // packFindingScannersCrossPackIntegration.test.ts).
    const javaModule = require(
      '../services/findings/packFindingScanners/javaFindingScanner',
    ) as { runJavaFindingScanner: (...args: unknown[]) => unknown };
    const javaSpy = jest
      .spyOn(javaModule, 'runJavaFindingScanner')
      .mockImplementation(() => {
        throw new Error('Java scanner boom (synthetic)');
      });
    try {
      const findings = runPackFindingScanners(emptyInput());
      const failed = findings.filter(isScannerFailed);
      // Exactly one scanner-failed finding, and it names the java scanner.
      expect(failed).toHaveLength(1);
      expect(failed[0].title).toContain('javaFindingScanner');
      expect(failed[0].severity).toBe('high');
      expect((failed[0].detailJson as Record<string, unknown>).scanner).toBe(
        'javaFindingScanner',
      );
      expect((failed[0].detailJson as Record<string, unknown>).error).toContain(
        'Java scanner boom (synthetic)',
      );
      // Soft-fail preserved: the shim still logged its existing warning.
      const warned = warnSpy.mock.calls.some((args) =>
        args.some(
          (a) => typeof a === 'string' && a.includes('javaFindingScanner threw'),
        ),
      );
      expect(warned).toBe(true);
    } finally {
      javaSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('a clean run (no scanner throws) produces ZERO scanner_failed findings', () => {
    // No mocks -- the real scanners run over an empty IR set. None throw, so
    // there must be no scanner_failed sentinel in the output.
    const findings = runPackFindingScanners(emptyInput());
    expect(findings.filter(isScannerFailed)).toHaveLength(0);
  });
});
