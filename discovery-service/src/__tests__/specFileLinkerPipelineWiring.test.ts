/**
 * Integration tests for Phase 3 Task Group 4 -- wiring `runSpecFileLinker`
 * into the pack-finding-scanner pipeline orchestrator
 * (`runPackFindingScanners`).
 *
 * Spec: agent-os/specs/2026-05-17-spec-file-auto-linking-phase-3/spec.md
 *
 * Three focused integration tests:
 *
 *   1. Mixed-content repo (REST candidate + SOAP candidate produced by the
 *      Phase 1 SOAP pass + a standalone OpenAPI YAML on disk) ->
 *        - REST interface candidate's `data.spec_link` is set to the YAML
 *          file's repo-relative path by the spec-file linker stage.
 *        - SOAP interface candidate's `data.spec_link` is set to the WSDL's
 *          repo-relative path by Workstream B's emitter promotion (separate
 *          stage, not invoked through `runPackFindingScanners` but tested
 *          alongside to prove no cross-contamination).
 *        - No `oas_spec_orphan` / `oas_spec_ambiguous_match` findings.
 *   2. REST-only repo with NO spec files on disk ->
 *        - Spec-file linker stage runs cleanly (zero candidate mutations,
 *          zero findings). Existing REST scanner output is unaffected.
 *   3. SOAP-only repo with a single WSDL on disk ->
 *        - The WSDL `spec_link` promotion path (Workstream B) sets the
 *          interface candidate's `data.spec_link` to the WSDL's
 *          repo-relative path. Exercises Group 5's pipeline plumbing via
 *          the freshly-extended `springClassicSoap/index.ts`.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { DiscoveryCandidate } from '../types/candidate';
import type { SourceFileIR } from '../services/extensionPacks';
import type { FindingEmitRunContext } from '../services/findings/FindingEmitter';
import { runPackFindingScanners } from '../services/findings/packFindingScanners';
import { runSpringClassicSoapPass } from '../services/findings/packFindingScanners/springClassicSoap';

// ----------------------------------------------------------------------------
// Fixtures + helpers
// ----------------------------------------------------------------------------

const RUN_CONTEXT: FindingEmitRunContext = {
  runId: 'run-pipeline-wiring-001',
  projectId: 'proj-pipeline-wiring-001',
  architectureId: 'arch-pipeline-wiring-001',
};

const PHASE3_VISUALS = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'agent-os',
  'specs',
  '2026-05-17-spec-file-auto-linking-phase-3',
  'planning',
  'visuals',
);

const YAML_FIXTURE = path.join(
  PHASE3_VISUALS,
  'reference-springdoc-petstore.yaml',
);

// Minimal WSDL with a single portType + a targetNamespace. Used by Test 3
// (and Test 1's SOAP arm) to drive the WSDL `spec_link` promotion path
// inside `runSpringClassicSoapPass`.
const COUNTRIES_WSDL = `<?xml version="1.0" encoding="UTF-8"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
                  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
                  xmlns:tns="https://spring.io/guides/gs-producing-web-service"
                  targetNamespace="https://spring.io/guides/gs-producing-web-service">
  <wsdl:types>
    <xsd:schema targetNamespace="https://spring.io/guides/gs-producing-web-service" elementFormDefault="qualified">
      <xsd:element name="getCountryRequest">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="name" type="xsd:string"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>
      <xsd:element name="getCountryResponse">
        <xsd:complexType>
          <xsd:sequence>
            <xsd:element name="country" type="xsd:string"/>
          </xsd:sequence>
        </xsd:complexType>
      </xsd:element>
    </xsd:schema>
  </wsdl:types>
  <wsdl:portType name="CountriesPortType">
    <wsdl:operation name="getCountry">
      <wsdl:input message="tns:getCountryRequest"/>
      <wsdl:output message="tns:getCountryResponse"/>
    </wsdl:operation>
  </wsdl:portType>
  <wsdl:binding name="CountriesBinding" type="tns:CountriesPortType">
    <wsdl:operation name="getCountry">
      <wsdl:input/>
      <wsdl:output/>
    </wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="CountriesService">
    <wsdl:port name="CountriesPort" binding="tns:CountriesBinding"/>
  </wsdl:service>
</wsdl:definitions>
`;

function makeTempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spec-pipeline-wiring-'));
}

function cleanupRepo(repo: string): void {
  try {
    fs.rmSync(repo, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function copyFixtureInto(
  repo: string,
  fixtureAbs: string,
  repoRelTarget: string,
): void {
  const dest = path.join(repo, repoRelTarget);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(fixtureAbs, dest);
}

function makeRestInterfaceCandidate(
  id: string,
  name: string,
  basePath: string,
): DiscoveryCandidate {
  return {
    id,
    runId: RUN_CONTEXT.runId,
    candidateType: 'interfaces',
    name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    data: {
      interface_type: 'REST_API',
      basePath,
    },
    synthesizedAt: new Date().toISOString(),
  };
}

function makeWsdlIr(filePath: string, rawContent: string): SourceFileIR {
  return {
    filePath,
    language: 'xml',
    packageOrNamespace: null,
    imports: [],
    classes: [],
    functions: [],
    rawContent,
  };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('Phase 3 Task Group 4 -- spec-file linker pipeline wiring', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  // ===========================================================================
  // Test 1: mixed-content repo (REST candidate + SOAP candidate + OAS YAML)
  // ===========================================================================
  it('Test 1: mixed-content repo -- REST + SOAP candidates both pick up their spec_link with no cross-contamination', () => {
    const repo = makeTempRepo();
    try {
      // Put the OAS YAML fixture (info.title=PetStoreApi, basePath /api/v1/pets,
      // tag=pets) under `src/main/resources/openapi.yaml`.
      expect(fs.existsSync(YAML_FIXTURE)).toBe(true);
      copyFixtureInto(repo, YAML_FIXTURE, 'src/main/resources/openapi.yaml');

      // Pre-built interface candidates: one REST candidate matching the YAML
      // by basePath, plus one already-emitted SOAP candidate carrying the
      // WSDL's targetNamespace so Workstream B can promote the WSDL path
      // onto it.
      const restIface = makeRestInterfaceCandidate(
        'cand-rest-iface-1',
        'PetController',
        '/api/v1/pets',
      );
      const packCandidates: DiscoveryCandidate[] = [restIface];

      // ---- Spec-file linker stage (Workstream A): run via the production
      //      pack-scanner pipeline so we exercise Group 4's wiring path. ----
      const findings = runPackFindingScanners({
        runId: RUN_CONTEXT.runId,
        irFiles: new Map<string, SourceFileIR>(),
        packCandidates,
        repoRoot: repo,
        serviceRootPath: null,
        runContext: RUN_CONTEXT,
      });

      // The REST candidate's `data.spec_link` was set by the spec-file linker
      // via the title heuristic (info.title='PetStoreApi') / base-path heuristic
      // (paths under /api/v1/pets); either heuristic wins for this fixture.
      // The linker mutates `packCandidates` in place, so the same `restIface`
      // reference now carries the link.
      expect(restIface.data.spec_link).toBe('src/main/resources/openapi.yaml');

      // No ambiguous / orphan findings on the REST side (single OAS file,
      // single matching candidate).
      const restGapFindings = findings.filter((f) => {
        const d = f.detailJson as Record<string, unknown> | undefined;
        return (
          d?.gapType === 'oas_spec_ambiguous_match' ||
          d?.gapType === 'oas_spec_orphan'
        );
      });
      expect(restGapFindings).toHaveLength(0);

      // ---- SOAP arm: drive `runSpringClassicSoapPass` over the WSDL so the
      //      WSDL `spec_link` promotion (Workstream B / Group 5) fires. The
      //      SOAP pass is invoked separately from the pack-scanner shim
      //      today (its candidates flow on a different track), but Group 4
      //      verifies BOTH arms produce non-overlapping spec_link values
      //      without cross-contaminating the REST candidate above. ----
      const wsdlRepoRel = 'src/main/resources/wsdl/countries.wsdl';
      const wsdlIr = makeWsdlIr(wsdlRepoRel, COUNTRIES_WSDL);
      const soapResult = runSpringClassicSoapPass({
        runId: RUN_CONTEXT.runId,
        irFiles: new Map<string, SourceFileIR>([[wsdlRepoRel, wsdlIr]]),
        packCandidates: [],
      });

      // The WSDL produced exactly one SOAP interface candidate with the
      // WSDL's targetNamespace recorded on `data.wsdlTargetNamespace`.
      expect(soapResult.interfaceCandidates).toHaveLength(1);
      const soapIface = soapResult.interfaceCandidates[0];
      expect(soapIface.data.wsdlTargetNamespace).toBe(
        'https://spring.io/guides/gs-producing-web-service',
      );

      // Workstream B's promotion set `data.spec_link` to the WSDL path.
      expect(soapIface.data.spec_link).toBe(wsdlRepoRel);

      // No SOAP-side ambiguity / orphan findings (single WSDL, unique
      // namespace match against its own emitted interface candidate).
      const soapGapFindings = soapResult.findings.filter((f) => {
        const d = f.detailJson as Record<string, unknown> | undefined;
        return (
          d?.gapType === 'oas_spec_ambiguous_match' ||
          d?.gapType === 'oas_spec_orphan'
        );
      });
      expect(soapGapFindings).toHaveLength(0);

      // ---- Cross-contamination guard: the REST candidate's spec_link
      //      points at the YAML; the SOAP candidate's spec_link points at
      //      the WSDL; neither carries the other's path. ----
      expect(restIface.data.spec_link).not.toBe(wsdlRepoRel);
      expect(soapIface.data.spec_link).not.toBe(
        'src/main/resources/openapi.yaml',
      );
    } finally {
      cleanupRepo(repo);
    }
  });

  // ===========================================================================
  // Test 2: REST-only repo with no spec files on disk
  // ===========================================================================
  it('Test 2: REST-only repo with NO spec files -- linker runs cleanly with zero mutations and zero findings (no regression on REST flow)', () => {
    const repo = makeTempRepo();
    try {
      // No spec files placed in the repo. The linker should walk the three
      // documented scopes, find nothing, and exit cleanly.
      const restIface = makeRestInterfaceCandidate(
        'cand-rest-iface-1',
        'UserController',
        '/api/users',
      );
      const packCandidates: DiscoveryCandidate[] = [restIface];

      const findings = runPackFindingScanners({
        runId: RUN_CONTEXT.runId,
        irFiles: new Map<string, SourceFileIR>(),
        packCandidates,
        repoRoot: repo,
        serviceRootPath: null,
        runContext: RUN_CONTEXT,
      });

      // The REST candidate's `data.spec_link` was NOT set (no spec files to
      // match against).
      expect(restIface.data.spec_link).toBeUndefined();

      // No `oas_spec_*` findings -- orphan is "spec exists but doesn't match",
      // NOT "no spec exists". Absence of spec files is a no-op.
      const oasGapFindings = findings.filter((f) => {
        const d = f.detailJson as Record<string, unknown> | undefined;
        return (
          d?.gapType === 'oas_spec_ambiguous_match' ||
          d?.gapType === 'oas_spec_orphan'
        );
      });
      expect(oasGapFindings).toHaveLength(0);

      // The linker DID run -- its start/done diagnostic lines should be
      // present in the captured console output. This proves the stage was
      // invoked (rather than silently skipped when repoRoot is supplied).
      const linkerLogs = logSpy.mock.calls
        .map((c) => String(c[0] ?? ''))
        .filter((s) => s.includes('scanner=spec_file_linker'));
      expect(linkerLogs.some((l) => l.includes('start files=0'))).toBe(true);
      expect(
        linkerLogs.some((l) =>
          /done matched=0 ambiguous=0 orphan=0 skipped=0/.test(l),
        ),
      ).toBe(true);
    } finally {
      cleanupRepo(repo);
    }
  });

  // ===========================================================================
  // Test 3: SOAP-only repo with a WSDL -- Workstream B spec_link promotion
  // ===========================================================================
  it('Test 3: SOAP-only repo with a WSDL -- WSDL spec_link promotion sets data.spec_link on the SOAP interface candidate (exercises G5 plumbing via index.ts)', () => {
    const wsdlRepoRel = 'src/main/resources/wsdl/countries.wsdl';
    const wsdlIr = makeWsdlIr(wsdlRepoRel, COUNTRIES_WSDL);

    // Driven directly through `runSpringClassicSoapPass` because the SOAP
    // pass is not part of `runPackFindingScanners` -- this is the Group 5
    // plumbing path. The pass now forwards the emitter's `findings` array
    // (post Group 4b) so we can inspect ambiguity / orphan emissions
    // through the public return.
    const result = runSpringClassicSoapPass({
      runId: RUN_CONTEXT.runId,
      irFiles: new Map<string, SourceFileIR>([[wsdlRepoRel, wsdlIr]]),
      packCandidates: [],
    });

    expect(result.interfaceCandidates).toHaveLength(1);
    const iface = result.interfaceCandidates[0];

    // Workstream B set `data.spec_link` to the WSDL's repo-relative path
    // via exact-byte namespace match between the WSDL's targetNamespace and
    // the interface's `data.wsdlTargetNamespace`.
    expect(iface.data.spec_link).toBe(wsdlRepoRel);

    // No ambiguity / orphan findings (single WSDL, unique match against
    // its own emitted interface candidate).
    const oasGapFindings = result.findings.filter((f) => {
      const d = f.detailJson as Record<string, unknown> | undefined;
      return (
        d?.gapType === 'oas_spec_ambiguous_match' ||
        d?.gapType === 'oas_spec_orphan'
      );
    });
    expect(oasGapFindings).toHaveLength(0);

    // The `findings` field is the new G5 plumbing handoff -- it MUST be
    // present (even if empty) so the production caller can fold it into
    // the existing FindingEmitter batch.
    expect(Array.isArray(result.findings)).toBe(true);
  });
});
