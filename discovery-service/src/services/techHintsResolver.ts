/**
 * Tech Hints Resolver
 *
 * Implements the save-time LLM classification of a service's free-text
 * `core_tech` field against the closed set of registered language and
 * framework packs, with an optional repo snapshot cross-check via
 * `GitCloneRepoAccess`.
 *
 * Spec 2026-04-20: Tech Hints LLM Resolution — Task Group 2
 *
 * Responsibilities:
 *  - `buildSnapshot(tmpPath)` — caps root filename listing (<=30, alpha),
 *    manifests (<=8), per-manifest lines (<=100), total payload (~8KB);
 *    appends `... [truncated]` where caps are hit.
 *  - `buildPrompt(freeText, snapshot, registeredPacks)` — assembles a
 *    system+user prompt listing the closed pack set as
 *    `- <packId> (predicate: language|technology)` bullets, with two
 *    few-shot examples and an explicit "choose only from the given lists"
 *    instruction. Reiterates the JSON output schema at the end.
 *  - `validateResolution(raw, registeredPacks)` — schema guard on the
 *    LLM response: rejects if `languagePack` is not in the registered
 *    set or any `frameworkPacks` element is not in the registered set.
 *  - `resolveTechHints({ freeText, repoLocation?, repoSubfolder? })` —
 *    the top-level entry used by the route.
 *
 * Error taxonomy: the resolver emits a single structured log line with
 * `reason: 'clone_timeout' | 'llm_timeout' | 'llm_malformed' |
 * 'network_error'` at each failure path, and returns a typed result the
 * route translates to HTTP codes:
 *   - 504 `clone_timeout`
 *   - 502 `llm_timeout`, `llm_malformed`, `network_error`
 *   - 200 clone-non-timeout failure (`confidence: 'tech-only'` +
 *     `repoCrossCheck.status: 'partial'`)
 *   - 200 happy path
 *
 * Cleanup: the tmp clone directory is removed in a `finally` block so
 * success and failure paths both release disk.
 */

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { gitCloneRepoAccess, isGitRepoUrl } from './repoAccess';
import { getRegisteredPacks, RegisteredPackMetadata } from './extensionPackRegistry';
import { gatewayClient, TechHintsLlmError } from './gatewayClient';

// ============================================================================
// Types
// ============================================================================

export interface TechHintResolution {
  language: { name: string; version?: string } | null;
  frameworks: { name: string; version?: string }[];
  languagePack: string | null;
  frameworkPacks: string[];
  confirmationSentence: string;
  repoCrossCheck: {
    status: 'confirmed' | 'conflict' | 'partial';
    note: string;
  } | null;
  confidence: 'high' | 'low' | 'none' | 'tech-only';
}

export interface ResolveRequest {
  freeText: string;
  repoLocation?: string;
  repoSubfolder?: string;
}

/**
 * Typed result of `resolveTechHints` covering the three terminal states
 * the route must translate into HTTP responses. Keeps the route thin and
 * keeps error surface logic centralised in the resolver.
 */
export type ResolveOutcome =
  | { kind: 'ok'; resolution: TechHintResolution }
  | {
      kind: 'error';
      httpStatus: number;
      reason: 'clone_timeout' | 'llm_timeout' | 'llm_malformed' | 'network_error';
      message: string;
    };

// ============================================================================
// Snapshot caps (locked by spec)
// ============================================================================

const MAX_FILENAMES = 30;
const MAX_MANIFESTS = 8;
const MAX_MANIFEST_LINES = 100;
const MAX_SNAPSHOT_BYTES = 8 * 1024; // ~8 KB

const RECOGNISED_MANIFESTS = [
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'package.json',
  'tsconfig.json',
  'requirements.txt',
  'pyproject.toml',
  'go.mod',
  'Cargo.toml',
  'Gemfile',
  'composer.json',
  'CMakeLists.txt',
];

const TRUNCATION_MARKER = '... [truncated]';

// ============================================================================
// buildSnapshot
// ============================================================================

interface Snapshot {
  filenames: string[]; // capped, alphabetical
  filenamesTruncated: boolean;
  manifests: {
    name: string;
    content: string; // possibly truncated with marker appended
    truncated: boolean;
  }[];
}

/**
 * Scans the root of a shallow-cloned repo directory and produces a
 * snapshot suitable for the LLM prompt. Caps per spec.
 *
 * Snapshot layout in the prompt is controlled by `renderSnapshotBlock`;
 * this function only gathers + truncates the raw data.
 *
 * Spec caps:
 *  - <=30 filenames in root, alphabetical.
 *  - <=8 manifest files; if more present, drop the largest first.
 *  - <=100 lines per manifest.
 *  - Total payload <=~8 KB; drop additional manifests largest-first on overflow.
 *  - Append `... [truncated]` where truncation occurred.
 */
export async function buildSnapshot(tmpPath: string): Promise<Snapshot> {
  const allEntries = await fs.readdir(tmpPath, { withFileTypes: true });
  const rootFilesOnly = allEntries
    .filter((e) => e.isFile())
    .map((e) => e.name);
  rootFilesOnly.sort();

  // Cap the filename listing — alphabetical first 30.
  const filenamesTruncated = rootFilesOnly.length > MAX_FILENAMES;
  const filenames = rootFilesOnly.slice(0, MAX_FILENAMES);

  // Discover manifests present in the root or via *.csproj glob.
  const csprojFiles = rootFilesOnly.filter((n) => n.toLowerCase().endsWith('.csproj'));
  const manifestCandidatesFound = [
    ...RECOGNISED_MANIFESTS.filter((n) => rootFilesOnly.includes(n)),
    ...csprojFiles,
  ];

  // Load manifest contents with per-manifest line cap.
  const loadedManifests: {
    name: string;
    content: string;
    truncated: boolean;
    rawByteSize: number;
  }[] = [];

  for (const name of manifestCandidatesFound) {
    try {
      const full = path.join(tmpPath, name);
      const raw = await fs.readFile(full, 'utf-8');
      const lines = raw.split(/\r?\n/);
      const truncated = lines.length > MAX_MANIFEST_LINES;
      const kept = truncated ? lines.slice(0, MAX_MANIFEST_LINES) : lines;
      let content = kept.join('\n');
      if (truncated) content += `\n${TRUNCATION_MARKER}`;
      loadedManifests.push({
        name,
        content,
        truncated,
        rawByteSize: Buffer.byteLength(content, 'utf-8'),
      });
    } catch (err) {
      // Silent skip — a manifest that fails to read is not fatal.
    }
  }

  // Cap manifest count: drop largest first if >8.
  loadedManifests.sort((a, b) => a.rawByteSize - b.rawByteSize);
  while (loadedManifests.length > MAX_MANIFESTS) {
    loadedManifests.pop(); // drop the largest
  }

  // Enforce total byte budget by dropping the largest remaining until under.
  const currentTotal = () =>
    loadedManifests.reduce((sum, m) => sum + m.rawByteSize, 0);
  while (loadedManifests.length > 0 && currentTotal() > MAX_SNAPSHOT_BYTES) {
    loadedManifests.pop(); // largest first
  }

  // Restore natural alphabetical order for stable rendering.
  loadedManifests.sort((a, b) => a.name.localeCompare(b.name));

  return {
    filenames,
    filenamesTruncated,
    manifests: loadedManifests.map((m) => ({
      name: m.name,
      content: m.content,
      truncated: m.truncated,
    })),
  };
}

/**
 * Renders a snapshot into the user-prompt block. Empty when snapshot
 * has no files (tech-only path).
 */
function renderSnapshotBlock(snapshot: Snapshot | null): string {
  if (!snapshot) return '';
  const lines: string[] = [];
  lines.push('--- repoSnapshot ---');
  lines.push('filenames (root, alphabetical):');
  for (const name of snapshot.filenames) lines.push(`- ${name}`);
  if (snapshot.filenamesTruncated) lines.push(TRUNCATION_MARKER);
  if (snapshot.manifests.length > 0) {
    lines.push('');
    lines.push('manifests:');
    for (const m of snapshot.manifests) {
      lines.push('');
      lines.push(`--- ${m.name} ---`);
      lines.push(m.content);
    }
  }
  lines.push('--- end repoSnapshot ---');
  return lines.join('\n');
}

// ============================================================================
// Prompt assembly
// ============================================================================

/**
 * Builds the LLM classification prompt. The prompt lists the closed pack
 * set as `- <packId> (predicate: language|technology)` bullets with an
 * explicit "choose only from the given lists" instruction. Two few-shot
 * examples are included (tech-only, repo-enriched) and the output schema
 * is reiterated at the end of the user turn.
 *
 * The returned string is a single user-turn prompt composed of two logical
 * sections (system + user), concatenated because the underlying gateway
 * gap-fill relay accepts a single `prompt` string verbatim.
 */
export function buildPrompt(
  freeText: string,
  snapshot: Snapshot | null,
  registeredPacks: RegisteredPackMetadata[],
): string {
  const langBullets = registeredPacks
    .filter((p) => p.kind === 'language')
    .map((p) => `- ${p.id} (predicate: language)`)
    .join('\n');

  const fwBullets = registeredPacks
    .filter((p) => p.kind === 'framework')
    .map((p) => `- ${p.id} (predicate: language+technology)`)
    .join('\n');

  const outputSchema = `{
  "language": { "name": string, "version"?: string } | null,
  "frameworks": [ { "name": string, "version"?: string } ],
  "languagePack": string | null,
  "frameworkPacks": string[],
  "confirmationSentence": string,
  "repoCrossCheck": { "status": "confirmed" | "conflict" | "partial", "note": string } | null,
  "confidence": "high" | "low" | "none" | "tech-only"
}`;

  const system = `You are a classifier that maps a free-text service "tech hint" (and an optional repo snapshot) onto EXACTLY ONE registered language pack and ZERO OR MORE registered framework packs.

Registered language packs:
${langBullets}

Registered framework packs:
${fwBullets}

Choose only from the given lists; if nothing matches, return languagePack: null and frameworkPacks: [].

Output strictly a single JSON object matching this schema. No markdown, no prose outside the JSON:
${outputSchema}`;

  const fewShotToolOnly = `Example (tech-only, no repo snapshot):
freeText: "Java 21 (Spring Boot 3)"
output:
{
  "language": { "name": "Java", "version": "21" },
  "frameworks": [{ "name": "Spring Boot", "version": "3" }],
  "languagePack": "java-lang",
  "frameworkPacks": ["java-spring-boot"],
  "confirmationSentence": "Detected Java 21 service using Spring Boot 3.",
  "repoCrossCheck": null,
  "confidence": "tech-only"
}`;

  const fewShotRepoEnriched = `Example (repo-enriched):
freeText: "Java w/ springboot"
repoSnapshot:
--- repoSnapshot ---
filenames (root, alphabetical):
- pom.xml
- README.md
- src
manifests:

--- pom.xml ---
<project>
  <dependency><groupId>org.springframework.boot</groupId></dependency>
</project>
--- end repoSnapshot ---
output:
{
  "language": { "name": "Java" },
  "frameworks": [{ "name": "Spring Boot" }],
  "languagePack": "java-lang",
  "frameworkPacks": ["java-spring-boot"],
  "confirmationSentence": "Detected Java service using Spring Boot, confirmed by pom.xml.",
  "repoCrossCheck": { "status": "confirmed", "note": "pom.xml references spring-boot-starter." },
  "confidence": "high"
}`;

  const user = `freeText: ${JSON.stringify(freeText)}
${renderSnapshotBlock(snapshot)}

Respond strictly as a JSON object matching the schema above:
${outputSchema}`;

  return [system, fewShotToolOnly, fewShotRepoEnriched, user].join('\n\n');
}

// ============================================================================
// Schema guard
// ============================================================================

/**
 * Validates the raw LLM response against the TechHintResolution shape
 * AND the closed pack set (languagePack + frameworkPacks must be
 * registered). Returns null on invalid.
 */
export function validateResolution(
  raw: unknown,
  registeredPacks: RegisteredPackMetadata[],
): TechHintResolution | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  // language: null or { name, version? }
  let language: TechHintResolution['language'] = null;
  if (r.language !== null && r.language !== undefined) {
    if (typeof r.language !== 'object' || !(r.language as any).name) return null;
    const lang = r.language as { name: unknown; version?: unknown };
    if (typeof lang.name !== 'string') return null;
    language = {
      name: lang.name,
      ...(typeof lang.version === 'string' ? { version: lang.version } : {}),
    };
  }

  // frameworks: array
  if (!Array.isArray(r.frameworks)) return null;
  const frameworks: TechHintResolution['frameworks'] = [];
  for (const fw of r.frameworks) {
    if (!fw || typeof fw !== 'object') return null;
    const f = fw as { name: unknown; version?: unknown };
    if (typeof f.name !== 'string') return null;
    frameworks.push({
      name: f.name,
      ...(typeof f.version === 'string' ? { version: f.version } : {}),
    });
  }

  // languagePack: null or registered string
  let languagePack: string | null = null;
  const validLangPackIds = new Set(
    registeredPacks.filter((p) => p.kind === 'language').map((p) => p.id),
  );
  const validFwPackIds = new Set(
    registeredPacks.filter((p) => p.kind === 'framework').map((p) => p.id),
  );
  if (r.languagePack === null || r.languagePack === undefined) {
    languagePack = null;
  } else if (typeof r.languagePack === 'string') {
    if (!validLangPackIds.has(r.languagePack)) return null;
    languagePack = r.languagePack;
  } else {
    return null;
  }

  // frameworkPacks: array of registered strings
  if (!Array.isArray(r.frameworkPacks)) return null;
  const frameworkPacks: string[] = [];
  for (const fp of r.frameworkPacks) {
    if (typeof fp !== 'string') return null;
    if (!validFwPackIds.has(fp)) return null;
    frameworkPacks.push(fp);
  }

  // confirmationSentence
  if (typeof r.confirmationSentence !== 'string') return null;

  // repoCrossCheck: null or { status, note }
  let repoCrossCheck: TechHintResolution['repoCrossCheck'] = null;
  if (r.repoCrossCheck !== null && r.repoCrossCheck !== undefined) {
    if (typeof r.repoCrossCheck !== 'object') return null;
    const rc = r.repoCrossCheck as { status: unknown; note: unknown };
    if (
      rc.status !== 'confirmed' &&
      rc.status !== 'conflict' &&
      rc.status !== 'partial'
    ) return null;
    if (typeof rc.note !== 'string') return null;
    repoCrossCheck = { status: rc.status, note: rc.note };
  }

  // confidence
  const okConfidence = ['high', 'low', 'none', 'tech-only'];
  if (typeof r.confidence !== 'string' || !okConfidence.includes(r.confidence)) {
    return null;
  }

  // Auto-infer the language pack when the LLM picked a framework but left
  // languagePack null (text-only inputs like "AngularJS 1.4" frequently
  // produce this shape because the LLM is too literal). Every registered
  // framework pack declares its language requirement in its `when.language`
  // clause — that's a deterministic mapping, no LLM judgment needed.
  //
  // Only fires when a unique language can be inferred. Mixed-stack framework
  // sets (e.g. `java-spring-boot` + `react-typescript`) leave languagePack
  // null deliberately; that flags a multi-stack service for manual review.
  if (languagePack === null && frameworkPacks.length > 0) {
    const impliedLanguageNames = new Set<string>();
    for (const fwId of frameworkPacks) {
      const fwMeta = registeredPacks.find(
        (p) => p.kind === 'framework' && p.id === fwId,
      );
      if (fwMeta && 'language' in fwMeta.when && typeof fwMeta.when.language === 'string') {
        impliedLanguageNames.add(fwMeta.when.language);
      }
    }
    if (impliedLanguageNames.size === 1) {
      const impliedName = [...impliedLanguageNames][0];
      const langMeta = registeredPacks.find(
        (p) =>
          p.kind === 'language' &&
          typeof p.when.language === 'string' &&
          p.when.language.toLowerCase() === impliedName.toLowerCase(),
      );
      if (langMeta) {
        languagePack = langMeta.id;
        // Backfill the human-readable language field too so downstream
        // consumers (UI captions, runtime fallback path in
        // techHintsFromResolvedColumns) see a populated language.name. Only
        // fill if the LLM left language null — never overwrite an explicit
        // value, the user may have said something the LLM should be
        // trusted on (e.g. exact version).
        if (language === null) {
          language = { name: langMeta.when.language };
        }
      }
    }
  }

  return {
    language,
    frameworks,
    languagePack,
    frameworkPacks,
    confirmationSentence: r.confirmationSentence,
    repoCrossCheck,
    confidence: r.confidence as TechHintResolution['confidence'],
  };
}

// ============================================================================
// Error log emitter (single-path structured log line)
// ============================================================================

function logReason(
  reason: 'clone_timeout' | 'llm_timeout' | 'llm_malformed' | 'network_error',
  message: string,
  extra?: Record<string, unknown>,
): void {
  // Emit exactly one structured line so telemetry can grep `reason=...`.
  console.error(
    JSON.stringify({
      where: 'techHintsResolver',
      reason,
      message,
      ...(extra ?? {}),
    }),
  );
}

// ============================================================================
// Top-level resolve
// ============================================================================

/**
 * Resolves a service's tech hints via the LLM, optionally cross-checking
 * a shallow repo snapshot.
 *
 * See file-level docblock for error taxonomy and cleanup semantics.
 */
export async function resolveTechHints(
  req: ResolveRequest,
): Promise<ResolveOutcome> {
  const { freeText, repoLocation, repoSubfolder } = req;

  // Acquire optional snapshot via shallow clone.
  let snapshot: Snapshot | null = null;
  let tmpDir: string | null = null;
  let clonedRoot: string | null = null;
  let cloneFailureNote: string | null = null;
  const hasRepo = typeof repoLocation === 'string' && repoLocation.trim().length > 0;

  try {
    if (hasRepo && isGitRepoUrl(repoLocation as string)) {
      const slug = (repoLocation as string).replace(/[^a-zA-Z0-9]/g, '-');
      tmpDir = path.join(os.tmpdir(), `tech-hints-${Date.now()}-${slug}`);
      // Default branch varies across repositories. Try 'main' first (GitHub's
      // current default), then 'master' (common on older repos, self-hosted
      // Bitbucket, etc.), then 'develop' (trunk-based / gitflow setups).
      // Any timeout error aborts the sequence — we do NOT retry past a
      // timeout because the budget is already spent.
      const branchCandidates = ['main', 'master', 'develop'];
      let lastOtherErr: string | null = null;
      for (const branch of branchCandidates) {
        try {
          clonedRoot = await gitCloneRepoAccess.cloneRepo(
            repoLocation as string,
            branch,
            tmpDir,
          );
          lastOtherErr = null;
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const looksLikeTimeout =
            /timeout/i.test(msg) || (err as any)?.killed === true;
          if (looksLikeTimeout) {
            logReason('clone_timeout', `Shallow clone exceeded timeout budget: ${msg}`, {
              repoLocation,
              branch,
            });
            return {
              kind: 'error',
              httpStatus: 504,
              reason: 'clone_timeout',
              message: 'Shallow clone exceeded timeout budget',
            };
          }
          // Non-timeout failure (often "Remote branch <name> not found in
          // upstream origin"). Record and try the next candidate.
          lastOtherErr = msg;
        }
      }
      if (lastOtherErr && !clonedRoot) {
        // All branch candidates failed — fall back to tech-only mode with
        // a partial repoCrossCheck.
        logReason('network_error', `Shallow clone failed on all branch candidates (tried ${branchCandidates.join(', ')}): ${lastOtherErr}`, {
          repoLocation,
        });
        cloneFailureNote = lastOtherErr;
      }

      if (!cloneFailureNote && clonedRoot) {
        // Respect optional subfolder.
        const effectiveRoot = repoSubfolder && repoSubfolder.trim().length > 0
          ? path.join(clonedRoot, repoSubfolder)
          : clonedRoot;
        try {
          snapshot = await buildSnapshot(effectiveRoot);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logReason('network_error', `Snapshot build failed: ${msg}`, { repoLocation });
          cloneFailureNote = msg;
          snapshot = null;
        }
      }
    } else if (hasRepo) {
      // Local filesystem path — no clone, read directly from disk.
      // Mirror runManager.ts service-scoped flow: `repo_location` holds an
      // OS path (e.g. `C:\myfolder` or `/home/user/myfolder`), optionally
      // joined with `repo_subfolder`. `fs.readdir` will fail loudly if the
      // path is wrong; we treat that as a non-fatal partial cross-check.
      const effectiveRoot = repoSubfolder && repoSubfolder.trim().length > 0
        ? path.join(repoLocation as string, repoSubfolder)
        : (repoLocation as string);
      try {
        snapshot = await buildSnapshot(effectiveRoot);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logReason('network_error', `Local snapshot build failed: ${msg}`, { repoLocation });
        cloneFailureNote = `Local repo path unreadable: ${msg}`;
        snapshot = null;
      }
    }

    // Compose the prompt from registered packs + optional snapshot.
    const registeredPacks = getRegisteredPacks();
    const prompt = buildPrompt(freeText, snapshot, registeredPacks);

    // Call the LLM via the gateway relay.
    let llmContent: string;
    try {
      const resp = await gatewayClient.callTechHintsLlm(prompt);
      llmContent = resp.content || '';
    } catch (err) {
      let reason: 'llm_timeout' | 'network_error' | 'llm_malformed';
      if (err instanceof TechHintsLlmError) {
        reason = err.reason;
      } else {
        // Fallback: inspect error shape for timeout signals so a test or
        // unusual caller that bypasses the gateway client's wrapping still
        // lands in the correct taxonomy bucket.
        const message = err instanceof Error ? err.message : String(err);
        const code = (err as any)?.code;
        if (code === 'ECONNABORTED' || /timeout/i.test(message)) {
          reason = 'llm_timeout';
        } else {
          reason = 'network_error';
        }
      }
      const message = err instanceof Error ? err.message : String(err);
      logReason(reason, `LLM call failed: ${message}`, { freeText });
      return {
        kind: 'error',
        httpStatus: 502,
        reason,
        message,
      };
    }

    // Parse + validate.
    let parsed: unknown;
    try {
      parsed = JSON.parse(llmContent);
    } catch (err) {
      logReason('llm_malformed', `LLM returned non-JSON content`, {
        contentLen: llmContent.length,
      });
      return {
        kind: 'error',
        httpStatus: 502,
        reason: 'llm_malformed',
        message: 'LLM response was not valid JSON',
      };
    }

    const validated = validateResolution(parsed, registeredPacks);
    if (!validated) {
      logReason('llm_malformed', `LLM response failed schema guard`);
      return {
        kind: 'error',
        httpStatus: 502,
        reason: 'llm_malformed',
        message: 'LLM response did not match schema or referenced unregistered packs',
      };
    }

    // If the clone failed non-timeout, override to tech-only partial.
    if (cloneFailureNote) {
      return {
        kind: 'ok',
        resolution: {
          ...validated,
          confidence: 'tech-only',
          repoCrossCheck: {
            status: 'partial',
            note: cloneFailureNote,
          },
        },
      };
    }

    return { kind: 'ok', resolution: validated };
  } finally {
    if (clonedRoot) {
      try {
        await gitCloneRepoAccess.cleanup(clonedRoot);
      } catch {
        // Best-effort cleanup; already logged by GitCloneRepoAccess.
      }
    } else if (tmpDir) {
      try {
        await gitCloneRepoAccess.cleanup(tmpDir);
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}
