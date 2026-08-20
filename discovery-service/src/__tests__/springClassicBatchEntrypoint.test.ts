/**
 * Tests for plain-Java `main()` batch-entrypoint emission (D2, Task Group 3).
 *
 * Decision D3: a `public static void main(String[])` class on a run carrying
 * batch signals, with a batch package/name signal (or shell-invocation, refined
 * in Group 4), is emitted as candidate type `class` (NOT `app_component`) with a
 * `batch_entrypoint` marker in `data`; its `main` / `execute` methods become
 * child `method` candidates and the `-o UPDATE` / `-o ARCHIVE` operation-flag
 * pattern is captured. The rule is gated to batch-signal runs and MUST NOT
 * regress existing Spring emission (the NEGATIVE test).
 *
 * Reuses the EXISTING Java tree-sitter IR (no new parse, no bare
 * `require('tree-sitter')`).
 */
import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import { runSpringClassicAdapter } from '../services/extensionPacks/frameworkAdapters/springClassic';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';

// A plain-Java batch entrypoint in a `batch` package, invoking an `-o ARCHIVE`
// operation flag through its `execute` method, plus a literal `-o UPDATE` arg.
const BATCH_MAIN_SRC = `
package com.acme.risk.batch;

public class RiskTreeRecordLoader {
  public static void main(String[] args) {
    RiskTreeRecordLoader app = new RiskTreeRecordLoader();
    app.execute("-o", "ARCHIVE");
    if ("-o UPDATE".equals(args[0])) {
      app.execute("-o", "UPDATE");
    }
  }

  public void execute(String flag, String operation) {
    // ... loads the risk hierarchy ...
  }

  private void helper() { }
}
`;

// A normal classic-Spring @Service — the NEGATIVE / no-regression fixture.
const SERVICE_SRC = `
package com.acme.risk.service;
import org.springframework.stereotype.Service;

@Service
public class RiskScoringService {
  public Integer score(Integer id) { return 0; }
  public void recompute(Integer id) { }
}
`;

// A JIL file in the IR set makes the run "carry batch signals". JIL files are
// represented as plain non-Java SourceFileIR entries (no classes); only their
// presence is needed to flip the run-level gate.
function jilFileIR(filePath: string): SourceFileIR {
  return {
    filePath,
    language: 'autosys-jil',
    packageOrNamespace: null,
    imports: [],
    classes: [],
    functions: [],
  };
}

describe('plain-Java main() batch-entrypoint emission', () => {
  it('POSITIVE: emits the batch class as `class` with a batch_entrypoint marker, child method candidates, and the captured -o flags', () => {
    const files = [
      extractJavaIR('batch/RiskTreeRecordLoader.java', BATCH_MAIN_SRC)!,
      jilFileIR('autosys/risk_hier.jil'),
    ];
    const c = runSpringClassicAdapter(files, 'sc-batch');

    // The class is emitted as candidate type `class` (NOT app_component).
    const classCands = c.filter((x) => x.candidateType === 'class');
    expect(classCands.map((x) => x.name)).toEqual(['RiskTreeRecordLoader']);
    expect(c.some((x) => x.candidateType === 'app_component')).toBe(false);

    const cls = classCands[0];
    const data = cls.data as Record<string, unknown>;
    // The batch_entrypoint marker is present and truthy.
    expect(data.batch_entrypoint).toBe(true);
    // Operation flags captured from the invocation / arg parsing.
    expect(data.operations).toEqual(expect.arrayContaining(['ARCHIVE', 'UPDATE']));

    // main + execute emitted as child `method` candidates parented to the class.
    const methods = c
      .filter((x) => x.candidateType === 'method' && x.parentCandidateId === cls.id)
      .map((x) => x.name)
      .sort();
    expect(methods).toEqual(['execute', 'main']);

    // The private helper is NOT emitted (only main + execute are entrypoint methods).
    expect(c.some((x) => x.candidateType === 'method' && x.name === 'helper')).toBe(false);
  });

  it('NEGATIVE: a normal @Service is unchanged — no class/method candidates, business_logics intact', () => {
    const files = [
      extractJavaIR('service/RiskScoringService.java', SERVICE_SRC)!,
      jilFileIR('autosys/risk_hier.jil'), // batch signals present in the run
    ];
    const c = runSpringClassicAdapter(files, 'sc-batch-neg');

    // No batch-entrypoint emission for a @Service (no main()): no `class`,
    // no `method`, no batch_entrypoint marker anywhere.
    expect(c.some((x) => x.candidateType === 'class')).toBe(false);
    expect(c.some((x) => x.candidateType === 'method')).toBe(false);
    expect(
      c.some((x) => (x.data as Record<string, unknown>)?.batch_entrypoint),
    ).toBe(false);

    // Existing Spring business_logics emission is intact (no regression).
    const bl = c.filter((x) => x.candidateType === 'business_logics').map((x) => x.name).sort();
    expect(bl).toEqual(['recompute', 'score']);
  });

  it('does NOT emit a main() class when the run carries NO batch signals (gate closed)', () => {
    // Same batch class, but NO .jil / .sh in the IR set and the recognition
    // gate is run-scoped: with no batch signals the class must NOT be emitted
    // as a batch entrypoint (avoids promoting every CLI tool on a web run).
    const files = [extractJavaIR('batch/RiskTreeRecordLoader.java', BATCH_MAIN_SRC)!];
    // RiskTreeRecordLoader's package + name ARE a batch signal, so the run-level
    // gate is satisfied by the class itself. Use a non-batch-named main() to
    // prove the closed-gate path.
    const PLAIN_MAIN_SRC = `
package com.acme.tools;
public class HelloWorld {
  public static void main(String[] args) { System.out.println("hi"); }
}
`;
    const plainFiles = [extractJavaIR('tools/HelloWorld.java', PLAIN_MAIN_SRC)!];
    const c = runSpringClassicAdapter(plainFiles, 'sc-no-batch');
    // No batch signal (package/name not batch-flavoured, no .jil/.sh) -> no emission.
    expect(c.some((x) => x.candidateType === 'class')).toBe(false);
    expect(c.some((x) => x.candidateType === 'method')).toBe(false);

    // Sanity: the batch-named class DOES still emit (self-satisfying gate),
    // proving the negative above is about the gate, not a broken emitter.
    const batchOnly = runSpringClassicAdapter(files, 'sc-batch-self');
    expect(batchOnly.some((x) => x.candidateType === 'class' && x.name === 'RiskTreeRecordLoader')).toBe(true);
  });
});
