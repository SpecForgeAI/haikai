/**
 * Tests for the operational-artifact relevance predicate + file-count cap.
 *
 * Spec: 2026-06-14 Generic Operational-Artifact Discovery (D1), Task Group 2.
 *
 * The module under test is PURE (no I/O, no LLM, no findings, no gatewayClient),
 * so these tests are plain deterministic unit tests -- no mocks needed.
 *
 * Covers:
 *  (a) INCLUDES a shell script (shebang, no extension), a `.jil`, and a
 *      monitoring/connection `.xml`;
 *  (b) EXCLUDES a vendored/`node_modules` file, a lock/`.json` file, and a
 *      `.java`/`.ts` file already CLAIMED by a deterministic parser;
 *  (c) the relevance-signal returned is the right kind (extension vs shebang vs
 *      priority-dir vs referenced-by-atom);
 *  (d) the file-count cap selects the first N (deterministic order) and reports
 *      the overflow set.
 */

import {
  evaluateOperationalArtifactRelevance,
  applyFileCountCap,
  type SelectedOperationalArtifact,
  type RelevanceSignal,
} from '../services/operationalArtifactRelevance';

function head(text: string): Buffer {
  return Buffer.from(text, 'utf-8');
}

describe('operationalArtifactRelevance — predicate INCLUDES', () => {
  it('includes an extensionless shell script via the shebang signal', () => {
    const r = evaluateOperationalArtifactRelevance({
      filePath: 'bin/run-eod',
      headBytes: head('#!/bin/bash\nset -euo pipefail\necho hi\n'),
      sizeBytes: 64,
    });
    expect(r.included).toBe(true);
    // bin/ is also a priority dir, but the extensionless file's FIRST matching
    // signal in stable priority is the shebang (extension check fails first).
    expect(r.outcome).toBe('shebang');
  });

  it('includes a .jil scheduler file via the operational-extension signal', () => {
    const r = evaluateOperationalArtifactRelevance({
      filePath: 'jobs/reconcile.jil',
      headBytes: head('insert_job: RECON_EOD\njob_type: c\ncommand: reconcile.sh\n'),
      sizeBytes: 120,
    });
    expect(r.included).toBe(true);
    expect(r.outcome).toBe('operational_extension');
  });

  it('includes a plain monitoring/connection .xml by default (unclaimed)', () => {
    const r = evaluateOperationalArtifactRelevance({
      filePath: 'monitoring/geneos.xml',
      headBytes: head('<?xml version="1.0"?>\n<gateway><probe host="risk01"/></gateway>\n'),
      sizeBytes: 200,
      claimedPaths: new Set<string>(), // nothing claimed
    });
    expect(r.included).toBe(true);
    expect(r.outcome).toBe('operational_extension');
  });

  it('includes a file referenced by a known atom even with no other signal', () => {
    const r = evaluateOperationalArtifactRelevance({
      filePath: 'lib/helper.dat',
      headBytes: head('opaque proprietary config payload\nkey=value\n'),
      sizeBytes: 80,
      atomPaths: new Set<string>(['lib/helper.dat']),
    });
    expect(r.included).toBe(true);
    expect(r.outcome).toBe('referenced_by_atom');
  });
});

describe('operationalArtifactRelevance — predicate EXCLUDES', () => {
  it('excludes a vendored node_modules file', () => {
    const r = evaluateOperationalArtifactRelevance({
      filePath: 'node_modules/leftpad/index.sh',
      headBytes: head('#!/bin/sh\necho vendored\n'),
      sizeBytes: 40,
    });
    expect(r.included).toBe(false);
    expect(r.outcome).toBe('excluded');
  });

  it('excludes a lock/.json file', () => {
    const r = evaluateOperationalArtifactRelevance({
      filePath: 'config/settings.json',
      headBytes: head('{ "a": 1 }\n'),
      sizeBytes: 12,
    });
    expect(r.included).toBe(false);
    expect(r.outcome).toBe('excluded');
  });

  it('excludes a .java/.ts file already claimed by a deterministic parser', () => {
    const claimed = new Set<string>(['src/main/java/Risk.java']);
    const r = evaluateOperationalArtifactRelevance({
      filePath: 'src/main/java/Risk.java',
      headBytes: head('public class Risk {}\n'),
      sizeBytes: 60,
      claimedPaths: claimed,
    });
    expect(r.included).toBe(false);
    expect(r.outcome).toBe('claimed');
  });

  it('excludes a binary (null-byte) file even with an operational extension', () => {
    const r = evaluateOperationalArtifactRelevance({
      filePath: 'bin/tool.sh',
      headBytes: Buffer.from([0x23, 0x21, 0x00, 0x01, 0x02]), // "#!" then NUL
      sizeBytes: 5,
    });
    expect(r.included).toBe(false);
    expect(r.outcome).toBe('binary');
  });

  it('excludes a file at/above the 1MB ceiling', () => {
    const r = evaluateOperationalArtifactRelevance({
      filePath: 'scripts/huge.sh',
      headBytes: head('#!/bin/bash\n'),
      sizeBytes: 1024 * 1024, // exactly 1MB -> rejected
    });
    expect(r.included).toBe(false);
    expect(r.outcome).toBe('too_large');
  });

  it('excludes a plain .xml already CONSUMED by a pack (deduped)', () => {
    const r = evaluateOperationalArtifactRelevance({
      filePath: 'src/main/resources/spring-beans.xml',
      headBytes: head('<?xml version="1.0"?>\n<beans/>\n'),
      sizeBytes: 90,
      claimedPaths: new Set<string>(['src/main/resources/spring-beans.xml']),
    });
    expect(r.included).toBe(false);
    expect(r.outcome).toBe('claimed');
  });
});

describe('operationalArtifactRelevance — signal kinds + priority-dir', () => {
  it('selects priority_dir for a generic config under scripts/ with no ext/shebang', () => {
    const r = evaluateOperationalArtifactRelevance({
      filePath: 'scripts/runbook',
      headBytes: head('step 1: start service\nstep 2: verify\n'),
      sizeBytes: 50,
    });
    expect(r.included).toBe(true);
    expect(r.outcome).toBe('priority_dir');
  });

  it('returns no_signal for an unremarkable text file with no relevance signal', () => {
    const r = evaluateOperationalArtifactRelevance({
      filePath: 'docs/notes.txt',
      headBytes: head('just some notes, nothing operational here\n'),
      sizeBytes: 45,
    });
    expect(r.included).toBe(false);
    expect(r.outcome).toBe('no_signal');
  });
});

describe('operationalArtifactRelevance — file-count cap', () => {
  function sel(filePath: string): SelectedOperationalArtifact<string> {
    return { filePath, relevanceSignal: 'operational_extension' as RelevanceSignal, carrier: filePath };
  }

  it('selects the first N in deterministic path order and reports the overflow set', () => {
    // Intentionally unsorted input; the cap must sort then take the first N.
    const selected = [
      sel('z/last.sh'),
      sel('a/first.sh'),
      sel('m/middle.sh'),
      sel('b/second.sh'),
    ];
    const result = applyFileCountCap(selected, 2);

    expect(result.cap).toBe(2);
    expect(result.selected.map((s) => s.filePath)).toEqual(['a/first.sh', 'b/second.sh']);
    expect(result.overflowCount).toBe(2);
    expect(result.overflowSample).toEqual(['m/middle.sh', 'z/last.sh']);
  });

  it('keeps everything and reports zero overflow when under the cap', () => {
    const selected = [sel('a.sh'), sel('b.sh')];
    const result = applyFileCountCap(selected, 10);
    expect(result.selected).toHaveLength(2);
    expect(result.overflowCount).toBe(0);
    expect(result.overflowSample).toEqual([]);
  });
});
