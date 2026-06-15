/**
 * Default pipeline invoker for the V3 evaluation harness.
 *
 * Spec: `agent-os/specs/2026-04-19-v3-evaluation-harness` (Task Group 6
 * wiring — the initial runner.ts left this stub throwing for bring-up safety;
 * fixture authoring requires a working default).
 *
 * Per-framework dispatch:
 *
 *   - `spring-classic` — runs the deterministic pack pair directly
 *     (`javaLangPack.extract` -> `springClassicFrameworkPack.adapt`) on the
 *     fixture's single source file. No LLM call, no archModelClient, no
 *     `runDiscoveryV3` orchestration — exactly what the fixture-replay
 *     default mode needs.
 *
 *   - `java-spring-boot` — runs `javaLangPack.extract` +
 *     `springBootFrameworkPack.adapt`. Added in V3 Pack Migration Batch
 *     (Task Group 2). Reuses `javaLangPack` — no new language pack needed.
 *
 *   - `react-typescript` / `nestjs` / `angular` — run
 *     `typescriptLangPack.extract` + the matching `<fw>FrameworkPack.adapt`.
 *     Added in V3 Pack Migration Batch (Task Group 3).
 *
 *   - `django` / `flask` — run `pythonLangPack.extract` + the matching
 *     `<fw>FrameworkPack.adapt`. Added in V3 Pack Migration Batch
 *     (Task Group 4).
 *
 *   - `rails` — runs `rubyLangPack.extract` + `railsFrameworkPack.adapt`.
 *     Added in V3 Pack Migration Batch (Task Group 5).
 *
 *   - `wordpress` / `symfony` / `magento` — run `phpLangPack.extract` +
 *     the matching `<fw>FrameworkPack.adapt`. Added in V3 Pack Migration
 *     Batch (Task Group 6).
 *
 *   - `kratos` — runs `goLangPack.extract` + `kratosFrameworkPack.adapt`.
 *     Added in V3 Pack Migration Batch (Task Group 7).
 *
 *   - `asp-net-core` / `asp-net-framework` — run `csharpLangPack.extract`
 *     + the matching `<fw>FrameworkPack.adapt`. Added in V3 Pack
 *     Migration Batch (Task Group 8).
 *
 *   - `react-javascript` / `jquery` — run `javascriptLangPack.extract`
 *     + the matching `<fw>FrameworkPack.adapt`. Added in V3 Pack
 *     Migration Batch (Task Group 9). `javascriptLangPack` is SEPARATE
 *     from `typescriptLangPack` because the V2 extractors differ.
 *
 *   - `wxwidgets` / `oatpp` — run `cppLangPack.extract` + the matching
 *     `<fw>FrameworkPack.adapt`. Added in V3 Pack Migration Batch
 *     (Task Group 10). `cppLangPack.extract` populates a module-level
 *     raw-source cache that `oatppFrameworkPack.adapt` reads from
 *     (Oatpp's adapter requires raw source for ENDPOINT-macro regex
 *     scanning — tree-sitter-cpp cannot parse the macro bodies). See
 *     `services/extensionPacks/languagePacks/cppLangPack/rawSourceCache.ts`
 *     for the rationale.
 *
 * Why bypass `runDiscoveryV3`:
 *   - `runDiscoveryV3` needs a runId, projectId, and a live archModelClient
 *     (it persists candidates and updates the discovery-run mode). The
 *     evaluation harness cares about raw candidate emission, not persistence.
 *   - Invoking the pack pair directly matches how `scripts/annotate-fixture.ts`
 *     (Group 5) and `scripts/run-spring-classic-local.ts` already measure
 *     pack output, so the baseline metrics the harness records stay aligned
 *     with those existing workflows.
 *
 * Candidate mapping: pack output carries `sourceClusterIds[0]` as the file
 * path. We thread that into `PipelineInvocationCandidate.filePath` so the
 * matching module can feed it into the canonical dedup helpers.
 */

import { javaLangPack } from '../services/extensionPacks/languagePacks/javaLangPack';
import { typescriptLangPack } from '../services/extensionPacks/languagePacks/typescriptLangPack';
import { pythonLangPack } from '../services/extensionPacks/languagePacks/pythonLangPack';
import { rubyLangPack } from '../services/extensionPacks/languagePacks/rubyLangPack';
import { phpLangPack } from '../services/extensionPacks/languagePacks/phpLangPack';
import { goLangPack } from '../services/extensionPacks/languagePacks/goLangPack';
import { csharpLangPack } from '../services/extensionPacks/languagePacks/csharpLangPack';
import { javascriptLangPack } from '../services/extensionPacks/languagePacks/javascriptLangPack';
import { cppLangPack } from '../services/extensionPacks/languagePacks/cppLangPack';
import { springClassicFrameworkPack } from '../services/extensionPacks/frameworkPacks/springClassicFrameworkPack';
import { springBootFrameworkPack } from '../services/extensionPacks/frameworkPacks/springBootFrameworkPack';
import { reactTypescriptFrameworkPack } from '../services/extensionPacks/frameworkPacks/reactTypescriptFrameworkPack';
import { nestjsFrameworkPack } from '../services/extensionPacks/frameworkPacks/nestjsFrameworkPack';
import { angularFrameworkPack } from '../services/extensionPacks/frameworkPacks/angularFrameworkPack';
import { djangoFrameworkPack } from '../services/extensionPacks/frameworkPacks/djangoFrameworkPack';
import { flaskFrameworkPack } from '../services/extensionPacks/frameworkPacks/flaskFrameworkPack';
import { railsFrameworkPack } from '../services/extensionPacks/frameworkPacks/railsFrameworkPack';
import { wordpressFrameworkPack } from '../services/extensionPacks/frameworkPacks/wordpressFrameworkPack';
import { symfonyFrameworkPack } from '../services/extensionPacks/frameworkPacks/symfonyFrameworkPack';
import { magentoFrameworkPack } from '../services/extensionPacks/frameworkPacks/magentoFrameworkPack';
import { kratosFrameworkPack } from '../services/extensionPacks/frameworkPacks/kratosFrameworkPack';
import { aspNetCoreFrameworkPack } from '../services/extensionPacks/frameworkPacks/aspNetCoreFrameworkPack';
import { aspNetFrameworkFrameworkPack } from '../services/extensionPacks/frameworkPacks/aspNetFrameworkFrameworkPack';
import { reactJavascriptFrameworkPack } from '../services/extensionPacks/frameworkPacks/reactJavascriptFrameworkPack';
import { jqueryFrameworkPack } from '../services/extensionPacks/frameworkPacks/jqueryFrameworkPack';
import { wxwidgetsFrameworkPack } from '../services/extensionPacks/frameworkPacks/wxwidgetsFrameworkPack';
import { oatppFrameworkPack } from '../services/extensionPacks/frameworkPacks/oatppFrameworkPack';
import type { FrameworkPack, LanguagePack, TechHints } from '../services/extensionPacks/packTypes';
import type { DiscoveryCandidate } from '../types/candidate';
import type {
  FixtureCase,
  PipelineInvocationCandidate,
  PipelineInvocationResult,
  PipelineInvoker,
} from './types';

/**
 * Per-framework techHints registry — mirrors the `FRAMEWORK_REGISTRY` in
 * `scripts/annotate-fixture.ts`. Kept in sync by convention; divergence would
 * produce different candidates between annotation (scaffolding) and
 * evaluation (baseline scoring) and manifest as a pack-recall regression.
 */
const FRAMEWORK_TECH_HINTS: Record<string, TechHints> = {
  'spring-classic': {
    '0': { language: 'Java' },
    '1': { technology: 'Spring' },
  },
  'java-spring-boot': {
    '0': { language: 'Java' },
    '1': { technology: 'Spring Boot' },
  },
  'react-typescript': {
    '0': { language: 'TypeScript' },
    '1': { technology: 'React' },
  },
  nestjs: {
    '0': { language: 'TypeScript' },
    '1': { technology: 'NestJS' },
  },
  angular: {
    '0': { language: 'TypeScript' },
    '1': { technology: 'Angular' },
  },
  django: {
    '0': { language: 'Python' },
    '1': { technology: 'Django' },
  },
  flask: {
    '0': { language: 'Python' },
    '1': { technology: 'Flask' },
  },
  rails: {
    '0': { language: 'Ruby' },
    '1': { technology: 'Rails' },
  },
  wordpress: {
    '0': { language: 'PHP' },
    '1': { technology: 'WordPress' },
  },
  symfony: {
    '0': { language: 'PHP' },
    '1': { technology: 'Symfony' },
  },
  magento: {
    '0': { language: 'PHP' },
    '1': { technology: 'Magento' },
  },
  kratos: {
    '0': { language: 'Go' },
    '1': { technology: 'Kratos' },
  },
  'asp-net-core': {
    '0': { language: 'C#' },
    '1': { technology: 'ASP.NET Core' },
  },
  'asp-net-framework': {
    '0': { language: 'C#' },
    '1': { technology: 'ASP.NET' },
  },
  'react-javascript': {
    '0': { language: 'JavaScript' },
    '1': { technology: 'React' },
  },
  jquery: {
    '0': { language: 'JavaScript' },
    '1': { technology: 'jQuery' },
  },
  wxwidgets: {
    '0': { language: 'C++' },
    '1': { technology: 'wxWidgets' },
  },
  oatpp: {
    '0': { language: 'C++' },
    '1': { technology: 'Oatpp' },
  },
};

/**
 * Per-framework dispatch — which LanguagePack + FrameworkPack to invoke
 * for a given `fixture.frameworkId` (the directory name under
 * `evaluation/fixtures/`).
 *
 * V3-migrated frameworks keyed here:
 *   - `spring-classic` / `java-spring-boot` — reuse `javaLangPack`.
 *   - `react-typescript` / `nestjs` / `angular` — reuse `typescriptLangPack`.
 *   - `django` / `flask` — reuse `pythonLangPack`.
 *   - `rails` — reuses `rubyLangPack`.
 *   - `wordpress` / `symfony` / `magento` — reuse `phpLangPack`.
 *   - `kratos` — reuses `goLangPack`.
 *   - `asp-net-core` / `asp-net-framework` — reuse `csharpLangPack`.
 *   - `react-javascript` / `jquery` — reuse `javascriptLangPack`.
 *   - `wxwidgets` / `oatpp` — reuse `cppLangPack`.
 *
 * When other stacks migrate (future waves), add their (lang, framework)
 * pair here following the same pattern.
 */
const FRAMEWORK_PACK_PAIRS: Record<
  string,
  { lang: LanguagePack; framework: FrameworkPack }
> = {
  'spring-classic': { lang: javaLangPack, framework: springClassicFrameworkPack },
  'java-spring-boot': { lang: javaLangPack, framework: springBootFrameworkPack },
  'react-typescript': { lang: typescriptLangPack, framework: reactTypescriptFrameworkPack },
  nestjs: { lang: typescriptLangPack, framework: nestjsFrameworkPack },
  angular: { lang: typescriptLangPack, framework: angularFrameworkPack },
  django: { lang: pythonLangPack, framework: djangoFrameworkPack },
  flask: { lang: pythonLangPack, framework: flaskFrameworkPack },
  rails: { lang: rubyLangPack, framework: railsFrameworkPack },
  wordpress: { lang: phpLangPack, framework: wordpressFrameworkPack },
  symfony: { lang: phpLangPack, framework: symfonyFrameworkPack },
  magento: { lang: phpLangPack, framework: magentoFrameworkPack },
  kratos: { lang: goLangPack, framework: kratosFrameworkPack },
  'asp-net-core': { lang: csharpLangPack, framework: aspNetCoreFrameworkPack },
  'asp-net-framework': { lang: csharpLangPack, framework: aspNetFrameworkFrameworkPack },
  'react-javascript': { lang: javascriptLangPack, framework: reactJavascriptFrameworkPack },
  jquery: { lang: javascriptLangPack, framework: jqueryFrameworkPack },
  wxwidgets: { lang: cppLangPack, framework: wxwidgetsFrameworkPack },
  oatpp: { lang: cppLangPack, framework: oatppFrameworkPack },
};

/**
 * Convert a `DiscoveryCandidate` (pack output) into the leaner
 * `PipelineInvocationCandidate` the matching module consumes. Only
 * `type`, `name`, and `filePath` are needed for metric scoring.
 */
function toInvocationCandidate(
  c: DiscoveryCandidate,
): PipelineInvocationCandidate {
  return {
    type: c.candidateType,
    name: c.name,
    filePath: c.sourceClusterIds[0] ?? '',
  };
}

/**
 * Invoke the deterministic pack pair for a fixture's source file.
 *
 * Returns `packCandidates: []` + `llmCandidates: []` when the framework has
 * not yet been V3-migrated.
 */
export const defaultEvaluationPipelineInvoker: PipelineInvoker = async (
  fixture: FixtureCase,
): Promise<PipelineInvocationResult> => {
  const techHints = FRAMEWORK_TECH_HINTS[fixture.frameworkId];
  const packPair = FRAMEWORK_PACK_PAIRS[fixture.frameworkId];

  if (!techHints || !packPair) {
    // Not-yet-V3-migrated frameworks. Emit an empty result so the harness
    // still produces a shaped per-fixture report (pack recall will be
    // 0/<n> or NaN for 0/0, which the CLI renders as `n/a`).
    return { packCandidates: [], llmCandidates: [] };
  }

  const sourceFiles = new Map<string, string>();
  sourceFiles.set(fixture.sourceFileName, fixture.sourceContents);

  const irFiles = packPair.lang.extract(sourceFiles, techHints);
  const candidates = packPair.framework.adapt(
    irFiles,
    `eval-${fixture.frameworkId}-${fixture.caseId}`,
    techHints,
  );

  return {
    packCandidates: candidates.map(toInvocationCandidate),
    // LLM gap-fill stage is not invoked by the harness's default pipeline
    // invoker. LLM candidates are only scored when a recorded fixture exists
    // AND the pipeline reaches the gap-fill stage, which the pack-only
    // default invoker deliberately bypasses. Spec 6 ships pack-recall
    // baselines first; llm-fixture recording is an explicit user action
    // described in the spec's `--live --record` flow.
    llmCandidates: [],
  };
};
