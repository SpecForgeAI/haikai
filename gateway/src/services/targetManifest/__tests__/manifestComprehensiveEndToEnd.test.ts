/**
 * Task Group 11 strategic gap-fill: ONE comprehensive end-to-end manifest-upload
 * workflow across ALL FOUR provenance lanes.
 *
 * Spec: 2026-06-26-target-dependency-manifest-auto-answer-comprehensive (Spec 2),
 * task 11.3 (the single integration the per-group unit suites leave uncovered).
 *
 * Every lane is individually proven elsewhere (resolution / registry / extractors
 * / inference / gap-fill / precedence / persist). The gap THIS test fills is the
 * INTEGRATION seam: a single comprehensive pom flowing through the real route
 * (`buildTargetManifestUploadResponseWithAutoAnswer` -> `processManifestUpload`)
 * must surface, in ONE response, all four lanes with the CORRECT precedence and
 * badges:
 *
 *   - DETERMINISTIC-DIRECT (wire `manifest`): service.framework (Spring Boot),
 *     db.driver (pgjdbc), service.language (Java from <java.version>), build.tool.
 *   - INFERRED (wire `inferred`, version-unknown): db.engine (from the Postgres
 *     driver) and service.runtime (from the Java language), each carrying its
 *     source dependency.
 *   - LLM-SUGGESTED (wire `llm`): a versioned answer-to-the-51 (validation.
 *     framework) the deterministic registry missed, badged and carrying its
 *     source dependency, and NEVER overriding a deterministic / inferred hit.
 *   - TIER-2 FREE FACTS (`autoAnswer.freeFacts`): manifest tech OUTSIDE the 51
 *     (MCP SDK) surfaced as an informational "<friendly> (sep) <coordinate>" label.
 *
 * A FAKE single-shot `ArchitectLlmClient` is injected through the orchestrator
 * deps (no HTTP, no live LLM). The POST + read seams are stubbed like the sibling
 * route suites.
 */

import { buildTargetManifestUploadResponseWithAutoAnswer } from '../../../routes/targetManifestUpload';
import { ManifestUploadOrchestratorDeps } from '../manifestUploadOrchestrator';
import { ManifestPrecedenceDeps } from '../manifestPrecedence';
import { clearManifestLlmGapFillCache } from '../manifestLlmGapFill';
import type {
  ArchitectLlmClient,
  CallSingleShotResponse,
  SingleShotPrompt,
} from '../../architectConversation/architectLlmClient';
import type { CreateCapturedDecisionRequestBody } from '../../architectConversation/targetStateCapturedDecisionsWriter';
import type { TargetStateCapturedDecision } from '../../targetStateCapturedDecisionsClient';

jest.mock('../../logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// The em-dash (U+2014) the gap-fill label builder uses for the free-fact labels
// (matches the EM_DASH constant in the sibling gap-fill / persist suites).
const EM_DASH = '—';

// A comprehensive pom exercising every lane in one upload:
//   - spring-boot-starter-web       => service.framework  (deterministic)
//   - postgresql                    => db.driver          (deterministic)
//                                   => db.engine          (INFERRED, version-unknown)
//   - <java.version>21              => service.language   (deterministic)
//                                   => service.runtime    (INFERRED, version-unknown)
//   - (the pom itself)              => build.tool Maven    (deterministic)
//   - com.example:custom-validation => UNMATCHED => LLM answer validation.framework
//   - io.modelcontextprotocol:...   => UNMATCHED => LLM Tier-2 free fact (MCP SDK)
const COMPREHENSIVE_POM = `<project>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.4.1</version>
  </parent>
  <properties>
    <java.version>21</java.version>
  </properties>
  <dependencies>
    <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-web</artifactId></dependency>
    <dependency><groupId>org.postgresql</groupId><artifactId>postgresql</artifactId><version>42.7.4</version></dependency>
    <dependency><groupId>com.example</groupId><artifactId>custom-validation</artifactId><version>1.2.0</version></dependency>
    <dependency><groupId>io.modelcontextprotocol</groupId><artifactId>mcp-sdk</artifactId><version>0.5.0</version></dependency>
  </dependencies>
</project>`;

// The fake LLM returns ONE answer-to-the-51 (a versioned code the registry missed)
// AND ONE Tier-2 free fact, both keyed to the unmatched coordinates.
const LLM_BODY = JSON.stringify({
  answers: [
    {
      decisionCode: 'validation.framework',
      value: 'Hibernate Validator',
      sourceDependency: 'com.example:custom-validation',
    },
  ],
  freeFacts: [
    { friendlyName: 'MCP SDK', coordinate: 'io.modelcontextprotocol:mcp-sdk' },
  ],
});

function multerFile(originalname: string, content: string): Express.Multer.File {
  return {
    fieldname: 'files',
    originalname,
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    size: Buffer.byteLength(content),
    buffer: Buffer.from(content, 'utf-8'),
    stream: undefined as never,
    destination: '',
    filename: '',
    path: '',
  };
}

function fakeLlmClient(body: string): ArchitectLlmClient {
  return {
    callLlmToolLoop: async () => {
      throw new Error('callLlmToolLoop is not used by the manifest gap-fill');
    },
    callSingleShot: async (_p: SingleShotPrompt): Promise<CallSingleShotResponse> => ({
      content: body,
    }),
  };
}

/** Orchestrator deps with the fake LLM wired in; no prior manual rows. */
function deps(): ManifestUploadOrchestratorDeps {
  return {
    fetchLatestCapturedDecisions: (async () =>
      []) as ManifestPrecedenceDeps['fetchLatestCapturedDecisions'],
    postCapturedDecision: (async (
      _p: string,
      _t: string,
      body: CreateCapturedDecisionRequestBody,
    ): Promise<TargetStateCapturedDecision> => ({
      decisionId: `new-${body.decisionCode}`,
      projectId: 'p1',
      targetArchitectureId: 't1',
      decisionCode: body.decisionCode,
      scopeKind: body.scopeKind,
      answerValue: body.answerValue,
      answerSummary: body.answerSummary ?? null,
      standardsLookupRef: body.standardsLookupRef ?? null,
      conversationThreadId: body.conversationThreadId ?? null,
      conversationTurnRef: body.conversationTurnRef ?? null,
      createdAt: '2026-06-26T12:00:00Z',
      createdByTask: body.createdByTask,
      supersededById: null,
    })) as ManifestUploadOrchestratorDeps['postCapturedDecision'],
    llmClient: fakeLlmClient(LLM_BODY),
  };
}

const BASE = { projectId: 'p1', targetArchitectureId: 't1' };

beforeEach(() => clearManifestLlmGapFillCache());

test('a comprehensive pom surfaces deterministic + inferred + LLM + Tier-2 in ONE response with correct precedence and badges', async () => {
  const res = await buildTargetManifestUploadResponseWithAutoAnswer({
    files: [multerFile('services/orders/pom.xml', COMPREHENSIVE_POM)],
    body: { tags: 'orders-service' },
    ...BASE,
    deps: deps(),
  });

  expect(res.autoAnswer).not.toBeNull();
  const aa = res.autoAnswer!;
  const byCode = Object.fromEntries(
    aa.resolvedTargetVersions.map((v) => [v.decisionCode, v]),
  );

  // --- DETERMINISTIC-DIRECT (wire `manifest`) ---
  expect(byCode['service.framework']).toMatchObject({
    framework: 'Spring Boot',
    version: '3.4.1',
    provenance: 'manifest',
  });
  expect(byCode['db.driver']).toMatchObject({
    framework: 'pgjdbc',
    version: '42.7.4',
    provenance: 'manifest',
  });
  // <java.version>21 -> service.language Java (deterministic-direct, verbatim).
  expect(byCode['service.language']).toMatchObject({
    framework: 'Java',
    version: '21',
    provenance: 'manifest',
  });
  expect(byCode['build.tool']).toMatchObject({
    framework: 'Maven',
    provenance: 'manifest',
  });

  // --- INFERRED (wire `inferred`, FAMILY-ONLY => version-unknown + source dep) ---
  expect(byCode['db.engine']).toMatchObject({
    framework: 'Postgres',
    versionUnknown: true,
    provenance: 'inferred',
    sourceDependency: 'org.postgresql:postgresql',
  });
  expect(byCode['service.runtime']).toMatchObject({
    provenance: 'inferred',
    versionUnknown: true,
  });
  expect(byCode['service.runtime'].framework).toBe('Eclipse Temurin');

  // --- LLM-SUGGESTED (wire `llm`): the answer-to-the-51 the registry missed,
  //     badged + carrying its source dependency. The LLM NEVER overrode a
  //     deterministic OR inferred hit (service.framework / db.engine above stayed
  //     manifest / inferred), proving precedence det-direct > inferred > llm.
  expect(byCode['validation.framework']).toMatchObject({
    framework: 'Hibernate Validator',
    provenance: 'llm',
    sourceDependency: 'com.example:custom-validation',
  });

  // --- TIER-2 FREE FACTS (informational, never a question) ---
  expect(aa.freeFacts).toEqual([
    `MCP SDK ${EM_DASH} io.modelcontextprotocol:mcp-sdk`,
  ]);

  // All four lanes were written immediately through the existing /capture path.
  expect(aa.aborted).toBe(false);
  expect(aa.writtenCodes).toEqual(
    expect.arrayContaining([
      'service.framework',
      'db.driver',
      'service.language',
      'build.tool',
      'db.engine',
      'service.runtime',
      'validation.framework',
    ]),
  );
});
