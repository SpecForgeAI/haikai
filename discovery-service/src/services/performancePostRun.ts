/**
 * Discovery Performance Scoring — post-run scorer.
 *
 * Spec: Discovery Performance Scoring (2026-04-25), Phase 1+2+3.
 *
 * Public entry: `scoreRun({ projectId, runId })`. Composes a scoring
 * prompt from RUBRIC.md + golden anchor + deterministic heuristic flags
 * + per-type counts + samples; calls the gateway LLM; writes a per-run
 * MD file under `perf/runs/`; updates `perf/scoresheet.md` under a
 * lockfile; auto-promotes the new run to golden if it beats the
 * existing golden for the pack combo.
 *
 * Designed to be invoked **fire-and-forget** from `runManager.ts`
 * (auto-trigger) AND directly via `scripts/score-discovery-run.ts`
 * (manual). Failures never throw; they log + write a `_FAILED.md` per-run
 * file and return.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { archModelClient } from './archModelClient';
import { getRunArchitectureId } from './runArchitectureRegistry';
import { gatewayClient } from './gatewayClient';
import type { DiscoveryCandidate } from '../types/candidate';
import {
  runDeterministicChecks,
  type DeterministicFlag,
  type HeuristicInput,
} from './performanceHeuristics';

const PERF_DIR = path.join(__dirname, '..', '..', 'perf');
const RUBRIC_PATH = path.join(PERF_DIR, 'RUBRIC.md');
const SCORESHEET_PATH = path.join(PERF_DIR, 'scoresheet.md');
const SCORESHEET_LOCK = path.join(PERF_DIR, '.scoresheet.lock');
const KNOWN_ISSUES_PATH = path.join(PERF_DIR, 'KNOWN_ISSUES.md');
const RUNS_DIR = path.join(PERF_DIR, 'runs');
const GOLDEN_DIR = path.join(PERF_DIR, 'golden-runs');

const SAMPLE_SIZE = parseInt(
  process.env.DISCOVERY_PERFORMANCE_SAMPLE_SIZE ?? '10',
  10,
);
// Note: there is no model selector here — the gateway's `sendChatRequest`
// uses its globally-configured `openaiModel` for every call, including
// performance scoring. We deliberately re-use whatever the rest of the
// product uses so scoring quality is consistent with gap-fill and tech-
// hints LLM calls.

const CURRENTLY_ANALYSED_MM_TYPES = [
  'interfaces',
  'endpoints',
  'logical_data_entities',
  'logical_data_attributes',
  'physical_data_entities',
  'physical_data_attributes',
  'logical_data_entity_relationships',
  'interface_logical_entities',
  'logical_data_entity_physical_data_entities',
  'logical_data_attribute_physical_data_attributes',
  'business_logics',
  'ui_screens',
  'ui_components',
] as const;
type CandidateType = typeof CURRENTLY_ANALYSED_MM_TYPES[number];

// ============================================================================
// Types
// ============================================================================

export interface ScoreRunInput {
  projectId: string;
  runId: string;
}

export interface PerTypeScore {
  count: number;
  axes: {
    coverage: number;
    accuracy: number;
    metadataRichness: number;
    provenanceBalance: number;
  };
  score: number;
  reasoning: string;
}

export interface PerformanceScore {
  runId: string;
  scoredAt: string;
  rubricVersion: string;
  packCombo: { language: string; frameworks: string[] };
  weightSet: 'backend-service' | 'frontend-spa' | 'fullstack-monolith';
  goldenAnchor: { runId: string | null; score: number | null };
  deterministicFlags: DeterministicFlag[];
  perType: Record<CandidateType, PerTypeScore>;
  crossCutting: {
    determinism: number;
    hallucinationRate: number;
    coverageOfObviousGaps: number;
    cost: number;
  };
  overall: number;
  confidence: 'baseline-anchored' | 'no-baseline';
  anomalies: string[];
}

// ============================================================================
// Pack-combo + weight-set inference
// ============================================================================

interface PackCombo {
  language: string;
  frameworks: string[];
}

/**
 * Infer the pack combo for scoring.
 *
 * For SERVICE-scoped runs: prefer the service's resolved pack columns
 * (`core_tech_language_pack` + `core_tech_framework_packs`). These are the
 * canonical "what packs ran for this scope" identifiers and give us a
 * narrow, stable key that won't drift when the project framing config
 * adds unrelated tech hints.
 *
 * For PROJECT-scoped runs: fall back to the run's `config_snapshot.techHints`
 * (the framing-time hints), since there's no per-service narrowing.
 *
 * Bug fix (2026-04-25 Scenarios Service): the original implementation read
 * `config_snapshot.techHints` even for service-scoped runs, which on a
 * multi-stack project (Java backend + React frontend in one repo)
 * produced a pack combo containing BOTH stacks. That over-broad combo
 * mis-routed the weight-set selection (a Java/Spring backend service got
 * the `frontend-spa` weight set because "React" appeared in the combined
 * framework list) AND polluted the golden-run filename.
 */
function inferPackCombo(
  service: { core_tech_language_pack?: string | null; core_tech_framework_packs?: string[] | null } | null,
  configSnapshot: unknown,
): PackCombo {
  if (
    service &&
    typeof service.core_tech_language_pack === 'string' &&
    service.core_tech_language_pack.length > 0
  ) {
    const fws = Array.isArray(service.core_tech_framework_packs)
      ? service.core_tech_framework_packs.filter(
          (f): f is string => typeof f === 'string' && f.length > 0,
        )
      : [];
    return {
      language: service.core_tech_language_pack,
      frameworks: [...fws].sort(),
    };
  }
  // Project-scoped fallback: read from the run's snapshot.
  const cs = (configSnapshot as Record<string, unknown> | null | undefined) ?? {};
  const techHints = Array.isArray(cs.techHints) ? cs.techHints : [];
  const langs = new Set<string>();
  const fws = new Set<string>();
  for (const h of techHints as Array<Record<string, unknown>>) {
    if (typeof h.language === 'string') langs.add(h.language);
    if (typeof h.technology === 'string') fws.add(h.technology);
  }
  return {
    language: langs.size > 0 ? Array.from(langs).sort().join(' / ') : 'unknown',
    frameworks: Array.from(fws).sort(),
  };
}

function inferWeightSet(combo: PackCombo): PerformanceScore['weightSet'] {
  // Match against both pack-id forms (`react-typescript`, `angular-modern`,
  // `angularjs-classic`, `nestjs`) AND friendly-name forms (`React`,
  // `Angular`). Spring Boot is decisively backend even when the project
  // framing has React mixed in — so a frontend match alone is no longer
  // enough; we also require the absence of a backend signal.
  const fwLower = combo.frameworks.map((f) => f.toLowerCase());
  const langLower = combo.language.toLowerCase();

  const isFrontend = fwLower.some(
    (f) =>
      f.includes('react') ||
      f.includes('angular') ||
      f === 'angularjs' ||
      f.includes('angularjs') ||
      f.includes('vue') ||
      f === 'jquery' ||
      f === 'jquery-classic',
  );
  const isBackend = fwLower.some(
    (f) =>
      f.includes('spring-boot') ||
      f.includes('spring-classic') ||
      f === 'nestjs' ||
      f === 'flask' ||
      f === 'kratos' ||
      f === 'asp-net-core' ||
      f === 'asp-net-framework' ||
      f === 'oatpp' ||
      f.includes('hibernate') ||
      f === 'symfony' ||
      f === 'kratos',
  );
  const isMonolith = fwLower.some(
    (f) =>
      f === 'wordpress' ||
      f === 'magento' ||
      f === 'rails' ||
      f === 'django',
  );

  // Pack-id-aware language heuristic: backend-only languages override
  // a stray "React" in the combo.
  const isBackendLang =
    langLower === 'java-lang' ||
    langLower === 'java' ||
    langLower === 'csharp' ||
    langLower === 'csharp-modern' ||
    langLower === 'csharp-netfx' ||
    langLower === 'go' ||
    langLower === 'php-modern' ||
    langLower === 'php-legacy' ||
    langLower === 'cpp' ||
    langLower === 'c-classic' ||
    langLower === 'c-modern' ||
    langLower === 'cobol';

  if (isMonolith) return 'fullstack-monolith';
  if (isFrontend && !isBackend && !isBackendLang) return 'frontend-spa';
  return 'backend-service';
}

function packComboKey(combo: PackCombo): string {
  // File-safe key for golden-runs/<key>.md.
  const lang = combo.language.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const fw = combo.frameworks
    .map((f) => f.toLowerCase().replace(/[^a-z0-9]+/g, '-'))
    .sort()
    .join('-');
  return `${lang}${fw ? '-' + fw : ''}`.replace(/^-|-$/g, '');
}

// ============================================================================
// Sampling + summary
// ============================================================================

function samplePerType(
  cands: DiscoveryCandidate[],
  size: number,
): Record<CandidateType, DiscoveryCandidate[]> {
  const out = {} as Record<CandidateType, DiscoveryCandidate[]>;
  for (const t of CURRENTLY_ANALYSED_MM_TYPES) out[t] = [];
  for (const c of cands) {
    const t = c.candidateType as CandidateType;
    if (!out[t]) continue;
    if (out[t].length < size) out[t].push(c);
  }
  return out;
}

interface CountsSummary {
  total: number;
  adapter: number;
  llm: number;
  perType: Record<CandidateType, { total: number; adapter: number; llm: number }>;
}

function summarise(cands: DiscoveryCandidate[]): CountsSummary {
  const perType = {} as CountsSummary['perType'];
  for (const t of CURRENTLY_ANALYSED_MM_TYPES) {
    perType[t] = { total: 0, adapter: 0, llm: 0 };
  }
  let totalAdapter = 0;
  let totalLlm = 0;
  for (const c of cands) {
    const t = c.candidateType as CandidateType;
    if (!perType[t]) continue;
    perType[t].total++;
    const addedBy = String(((c.data as Record<string, unknown>) ?? {})._addedBy ?? '');
    if (addedBy.endsWith('-adapter')) {
      perType[t].adapter++;
      totalAdapter++;
    } else if (addedBy.startsWith('llm-')) {
      perType[t].llm++;
      totalLlm++;
    }
  }
  return { total: cands.length, adapter: totalAdapter, llm: totalLlm, perType };
}

// ============================================================================
// Golden-anchor I/O
// ============================================================================

interface GoldenAnchor {
  runId: string;
  score: number;
  date: string;
  /**
   * Historical per-type COUNT snapshot from the golden run. **Do NOT** send
   * these to the LLM scorer as a benchmark — counts are repo-specific and
   * comparing them across repos is meaningless (a small microservice
   * legitimately has fewer endpoints than a 200-controller monolith). Kept
   * here only for diagnostic auditing of golden runs themselves; runtime
   * scoring uses `score` + `adapterShare` (+ `perTypeAxes` once populated)
   * for calibration only.
   */
  perType: Record<CandidateType, number>;
  adapterShare: number;
  /**
   * Per-type AXIS scores from the golden run. Repo-agnostic — these are
   * useful as calibration ("a 5/5 on metadata richness for this pack
   * looks like X"). Optional because earlier goldens were saved before
   * this field was added; the prompt builder handles `undefined`.
   */
  perTypeAxes?: Record<CandidateType, {
    coverage: number;
    accuracy: number;
    metadataRichness: number;
    provenanceBalance: number;
  }>;
}

async function loadGoldenAnchor(packKey: string): Promise<GoldenAnchor | null> {
  const file = path.join(GOLDEN_DIR, `${packKey}.md`);
  try {
    const md = await fs.readFile(file, 'utf-8');
    // Parse the embedded JSON envelope. Goldens carry a `<!--GOLDEN_DATA: …-->`
    // HTML comment with the structured anchor payload.
    const m = /<!--GOLDEN_DATA:([\s\S]*?)-->/m.exec(md);
    if (!m) return null;
    const parsed = JSON.parse(m[1]);
    return parsed as GoldenAnchor;
  } catch {
    return null;
  }
}

async function writeGoldenAnchor(packKey: string, anchor: GoldenAnchor, body: string): Promise<void> {
  await fs.mkdir(GOLDEN_DIR, { recursive: true });
  const file = path.join(GOLDEN_DIR, `${packKey}.md`);
  const envelope = `\n\n<!--GOLDEN_DATA:${JSON.stringify(anchor)}-->\n`;
  await fs.writeFile(file, body + envelope, 'utf-8');
}

// ============================================================================
// Scoresheet I/O (with lockfile)
// ============================================================================

const LOCK_RETRY_MAX_MS = 30_000;
const LOCK_RETRY_INTERVAL_MS = 500;

async function acquireScoresheetLock(): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < LOCK_RETRY_MAX_MS) {
    try {
      await fs.writeFile(SCORESHEET_LOCK, String(process.pid), { flag: 'wx' });
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EEXIST') throw err;
      // Stale lock check: if lockfile is older than 60s, take it over.
      try {
        const stat = await fs.stat(SCORESHEET_LOCK);
        if (Date.now() - stat.mtime.getTime() > 60_000) {
          await fs.rm(SCORESHEET_LOCK, { force: true });
          continue;
        }
      } catch {
        /* race; loop and retry */
      }
      await new Promise((r) => setTimeout(r, LOCK_RETRY_INTERVAL_MS));
    }
  }
  return false;
}

async function releaseScoresheetLock(): Promise<void> {
  try {
    await fs.rm(SCORESHEET_LOCK, { force: true });
  } catch {
    /* best-effort */
  }
}

interface ScoresheetRow {
  date: string;
  runId: string;
  service: string;
  language: string;
  frameworks: string;
  mode: string;
  tier: string;
  totalCands: number;
  adapterPct: number;
  overall: number;
  confidence: string;
  rubricVersion: string;
  metaModelTypes: number;
  isGolden: boolean;
  perRunPath: string;
}

function rowToMarkdown(r: ScoresheetRow): string {
  const cells = [
    r.date,
    r.runId.slice(0, 8) + '...',
    r.service,
    r.language,
    r.frameworks,
    r.mode,
    r.tier,
    r.totalCands.toLocaleString(),
    `${r.adapterPct}%`,
    r.overall.toFixed(1),
    r.confidence,
    r.rubricVersion,
    String(r.metaModelTypes),
    r.isGolden ? '✓' : '',
    `[link](${r.perRunPath})`,
  ];
  return `| ${cells.join(' | ')} |`;
}

type BandName = 'Excellent' | 'Good' | 'Mixed' | 'Poor' | 'Failed';
const BAND_NAMES: BandName[] = ['Excellent', 'Good', 'Mixed', 'Poor', 'Failed'];

function bandForScore(score: number): BandName {
  if (score >= 4.5) return 'Excellent';
  if (score >= 3.5) return 'Good';
  if (score >= 2.5) return 'Mixed';
  if (score >= 1.5) return 'Poor';
  return 'Failed';
}

interface BestComboUpdate {
  language: string;
  framework: string;
  runId: string;
  score: number;
  dateStr: string;
  metaModelTypes: number;
  perRunPath: string;
  notes: string;
}

const PLACEHOLDER_ROW = '| _no combos in this band yet_ | | | | | | | |';
const PLACEHOLDER_ROW_RE = /\|\s*_no combos in this band yet_\s*\|/;

/**
 * Sort a contiguous range of band-table rows in place by
 * (MM Types DESC, Score DESC). Skips the placeholder row.
 *
 * Band-row layout (cells[0] is empty due to leading `|`):
 *   cells[1]=lang, cells[2]=fw, cells[3]=runId, cells[4]=score,
 *   cells[5]=date, cells[6]=metaModelTypes, cells[7]=link, cells[8]=notes
 */
function sortBandRows(
  lines: string[],
  firstDataIdx: number,
  lastDataIdx: number,
): void {
  if (firstDataIdx < 0 || lastDataIdx < firstDataIdx) return;
  const rows = lines.slice(firstDataIdx, lastDataIdx + 1);
  // If the band still holds the placeholder, nothing to sort.
  if (rows.length <= 1 && PLACEHOLDER_ROW_RE.test(rows[0] ?? '')) return;

  const parseMmTypes = (row: string): number => {
    const cells = row.split('|').map((c) => c.trim());
    const v = parseInt(cells[6] ?? '', 10);
    return Number.isFinite(v) ? v : -1;
  };
  const parseScore = (row: string): number => {
    const cells = row.split('|').map((c) => c.trim());
    const v = parseFloat(cells[4] ?? '');
    return Number.isFinite(v) ? v : -1;
  };

  const sorted = [...rows].sort((a, b) => {
    const tDiff = parseMmTypes(b) - parseMmTypes(a);
    if (tDiff !== 0) return tDiff;
    return parseScore(b) - parseScore(a);
  });
  for (let i = 0; i < sorted.length; i++) {
    lines[firstDataIdx + i] = sorted[i];
  }
}

/**
 * Maintain the per-combo "best run" tables under "## Best per pack combo".
 *
 * The section is split into one H3 sub-section per score band (Excellent →
 * Failed) plus an "Awaiting first run" sub-section. Each (language, framework)
 * combo lives in exactly one place. When a new run beats the recorded best
 * for its combo, the row is moved to the band sub-section that matches the
 * new score; the old band's placeholder is restored if removing the row
 * leaves it empty.
 *
 * No-ops if the combo already has a recorded score >= the new score.
 */
async function updateBestPerCombo(update: BestComboUpdate): Promise<void> {
  const acquired = await acquireScoresheetLock();
  if (!acquired) {
    console.warn('[performancePostRun] Could not acquire scoresheet lock — skipping best-per-combo update');
    return;
  }
  try {
    const md = await fs.readFile(SCORESHEET_PATH, 'utf-8').catch(() => '');
    if (!md.includes('## Best per pack combo')) {
      console.warn('[performancePostRun] scoresheet.md missing "## Best per pack combo" — skipping best-per-combo update');
      return;
    }
    const lines = md.split('\n');

    // Locate each band table's data range and the awaiting table's data range.
    // For each named section, record [headerLineIdx, firstDataIdx, lastDataIdx].
    // First/last data idx may point at the placeholder row when the band is empty.
    const sections: Record<string, { headerIdx: number; firstDataIdx: number; lastDataIdx: number } | null> = {
      Excellent: null, Good: null, Mixed: null, Poor: null, Failed: null,
      Awaiting: null,
    };
    let inBest = false;
    let curName: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t === '## Best per pack combo') { inBest = true; continue; }
      if (inBest && t.startsWith('## ')) break; // next H2
      if (!inBest) continue;
      if (t.startsWith('### ')) {
        const name = t.slice(4).trim();
        if (name.startsWith('Excellent')) curName = 'Excellent';
        else if (name.startsWith('Good')) curName = 'Good';
        else if (name.startsWith('Mixed')) curName = 'Mixed';
        else if (name.startsWith('Poor')) curName = 'Poor';
        else if (name.startsWith('Failed')) curName = 'Failed';
        else if (name.startsWith('Awaiting')) curName = 'Awaiting';
        else curName = null;
        if (curName) sections[curName] = { headerIdx: i, firstDataIdx: -1, lastDataIdx: -1 };
        continue;
      }
      if (curName && /^\|/.test(t)) {
        const sec = sections[curName];
        if (!sec) continue;
        // Skip the table header and separator rows (header has "Language | Framework",
        // separator is all dashes). We only want data rows.
        if (/Language\s*\|\s*Framework/i.test(t)) continue;
        if (/^\|[\s|:-]+\|$/.test(t)) continue;
        if (sec.firstDataIdx === -1) sec.firstDataIdx = i;
        sec.lastDataIdx = i;
      }
    }

    // Helper to extract the (lang, fw) pair from a data row in any band table.
    // Band rows have 6 columns; awaiting rows have 3. Both start with `lang | fw |...
    const parseCombo = (row: string): { lang: string; fw: string } | null => {
      const m = row.match(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/);
      return m ? { lang: m[1], fw: m[2] } : null;
    };
    const parseScore = (row: string): number | null => {
      // Band rows: | `lang` | `fw` | runId | score | date | notes |
      const cells = row.split('|').map((c) => c.trim());
      // cells[0] is empty (leading |), cells[1] = lang, cells[2] = fw, cells[3] = runId, cells[4] = score
      const s = cells[4];
      if (!s || s === '—') return null;
      const n = parseFloat(s);
      return Number.isFinite(n) ? n : null;
    };

    // Find existing entry for (lang, fw).
    let foundIn: BandName | 'Awaiting' | null = null;
    let foundLineIdx = -1;
    let foundScore: number | null = null;
    for (const sec of [...BAND_NAMES, 'Awaiting' as const]) {
      const s = sections[sec];
      if (!s || s.firstDataIdx === -1) continue;
      for (let i = s.firstDataIdx; i <= s.lastDataIdx; i++) {
        const combo = parseCombo(lines[i]);
        if (combo && combo.lang === update.language && combo.fw === update.framework) {
          foundIn = sec;
          foundLineIdx = i;
          if (sec !== 'Awaiting') foundScore = parseScore(lines[i]);
          break;
        }
      }
      if (foundIn) break;
    }

    // Decide whether to update.
    if (foundIn && foundIn !== 'Awaiting' && foundScore !== null && update.score <= foundScore) {
      // Existing best is at least as good — leave bands alone.
      return;
    }

    const newBand = bandForScore(update.score);
    const newRow = `| \`${update.language}\` | \`${update.framework}\` | ${update.runId} | ${update.score.toFixed(1)} | ${update.dateStr} | ${update.metaModelTypes} | [link](${update.perRunPath}) | ${update.notes} |`;

    // 1) Remove the existing row, if any. Restore placeholder if the band
    // becomes empty after removal.
    if (foundIn && foundLineIdx >= 0) {
      const sec = sections[foundIn]!;
      lines.splice(foundLineIdx, 1);
      // Update section indices for other sections whose start/end was after this line.
      for (const k of Object.keys(sections)) {
        const s = sections[k];
        if (!s) continue;
        if (s.headerIdx > foundLineIdx) s.headerIdx -= 1;
        if (s.firstDataIdx > foundLineIdx) s.firstDataIdx -= 1;
        if (s.lastDataIdx >= foundLineIdx) s.lastDataIdx -= 1;
      }
      // If the section is now empty, drop firstDataIdx/lastDataIdx and inject
      // a placeholder row at the table position. Only band tables have
      // placeholders; the awaiting table can be left empty.
      if (sec.firstDataIdx === -1 || sec.lastDataIdx < sec.firstDataIdx) {
        if (foundIn !== 'Awaiting') {
          // Insert placeholder row at the same position the row was at.
          lines.splice(foundLineIdx, 0, PLACEHOLDER_ROW);
          for (const k of Object.keys(sections)) {
            const s2 = sections[k];
            if (!s2) continue;
            if (s2.headerIdx >= foundLineIdx) s2.headerIdx += 1;
            if (s2.firstDataIdx >= foundLineIdx) s2.firstDataIdx += 1;
            if (s2.lastDataIdx >= foundLineIdx - 1) s2.lastDataIdx += 1;
          }
          sec.firstDataIdx = foundLineIdx;
          sec.lastDataIdx = foundLineIdx;
        }
      }
    }

    // 2) Insert the new row into the target band. Replace the placeholder
    // row if present; otherwise append after the band's last data row.
    const target = sections[newBand];
    if (!target) {
      console.warn(`[performancePostRun] target band "${newBand}" not found in scoresheet — skipping band update`);
      return;
    }
    if (target.firstDataIdx >= 0 && PLACEHOLDER_ROW_RE.test(lines[target.firstDataIdx])) {
      lines[target.firstDataIdx] = newRow;
      target.lastDataIdx = target.firstDataIdx;
    } else if (target.lastDataIdx >= 0) {
      lines.splice(target.lastDataIdx + 1, 0, newRow);
      target.lastDataIdx += 1;
    } else {
      // Empty section with no placeholder yet — find the table's separator
      // line (the row of dashes immediately under the header) and insert
      // right after it.
      let sepIdx = -1;
      for (let i = target.headerIdx + 1; i < lines.length && i < target.headerIdx + 6; i++) {
        if (/^\|[\s|:-]+\|$/.test(lines[i].trim())) { sepIdx = i; break; }
      }
      if (sepIdx === -1) {
        console.warn('[performancePostRun] could not locate band table separator — skipping band update');
        return;
      }
      lines.splice(sepIdx + 1, 0, newRow);
      target.firstDataIdx = sepIdx + 1;
      target.lastDataIdx = sepIdx + 1;
    }

    // 3) Sort the target band by (MM Types DESC, Score DESC). Broader
    // meta-model coverage outranks higher score on a smaller type set —
    // so a 4.0 over 13 types ranks above a 4.4 over 11. The 5 score-band
    // sections themselves are NOT re-bucketed; we only re-order rows
    // inside the band that just received the new row.
    sortBandRows(lines, target.firstDataIdx, target.lastDataIdx);

    await fs.writeFile(SCORESHEET_PATH, lines.join('\n'), 'utf-8');
  } finally {
    await releaseScoresheetLock();
  }
}

interface KnownIssuesUpdate {
  language: string;
  framework: string;
  runId: string;
  dateStr: string;
  anomalies: string[];
  flags: DeterministicFlag[];
}

const LEADS_PLACEHOLDER_RE = /\|\s*_no leads yet_\s*\|/;

function parseTableCells(row: string): string[] | null {
  const t = row.trim();
  if (!t.startsWith('|') || !t.endsWith('|')) return null;
  return t.slice(1, -1).split('|').map((c) => c.trim());
}

function isTableHeaderOrSeparator(row: string): boolean {
  const t = row.trim();
  if (/^\|[\s|:-]+\|$/.test(t)) return true; // separator row
  const cells = parseTableCells(row);
  if (!cells || cells.length === 0) return false;
  const c0 = cells[0].toLowerCase();
  return c0 === 'id' || c0 === 'first seen' || c0 === 'date';
}

interface SectionRange {
  headerIdx: number;
  firstDataIdx: number;
  lastDataIdx: number;
}

function findKnownIssuesSection(lines: string[], heading: string): SectionRange | null {
  let headerIdx = -1;
  let firstDataIdx = -1;
  let lastDataIdx = -1;
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === heading) { headerIdx = i; inSection = true; continue; }
    if (inSection && t.startsWith('## ')) break;
    if (!inSection) continue;
    if (!/^\|/.test(t)) continue;
    if (isTableHeaderOrSeparator(lines[i])) continue;
    if (firstDataIdx === -1) firstDataIdx = i;
    lastDataIdx = i;
  }
  return headerIdx === -1 ? null : { headerIdx, firstDataIdx, lastDataIdx };
}

/**
 * Maintain `KNOWN_ISSUES.md` after a scored run lands.
 *
 * Behaviour:
 *   1. For every Open issue tagged with the same (language, framework)
 *      combo as this run, update the row's "Last Seen" cell to the new
 *      run/date. The issue's title, severity, description, and other
 *      cells are never edited.
 *   2. For every entry in `score.anomalies` and every deterministic flag,
 *      append a row to the "Auto-suggested leads" table — or if a row
 *      with the same combo + source + lead text already exists, refresh
 *      its "Last Seen" date. Leads are never auto-pruned; they are
 *      cleared by hand once triaged.
 *
 * Manual issues (Source = `manual`) are not promoted, demoted, or
 * resolved here. The function is best-effort: if the file is missing or
 * malformed, it logs a warning and exits silently.
 */
async function updateKnownIssues(update: KnownIssuesUpdate): Promise<void> {
  if (update.anomalies.length === 0 && update.flags.length === 0) {
    // Still useful to update Last Seen on Open issues even with no leads.
  }
  const acquired = await acquireScoresheetLock();
  if (!acquired) {
    console.warn('[performancePostRun] Could not acquire lock for KNOWN_ISSUES.md update');
    return;
  }
  try {
    const md = await fs.readFile(KNOWN_ISSUES_PATH, 'utf-8').catch(() => '');
    if (!md || !md.includes('## Open') || !md.includes('## Auto-suggested leads')) {
      console.warn('[performancePostRun] KNOWN_ISSUES.md missing or malformed — skipping update');
      return;
    }
    const lines = md.split('\n');
    const lastSeenStr = `${update.dateStr} / \`${update.runId.slice(0, 8)}\``;
    const langCell = '`' + update.language + '`';
    const fwCell = '`' + update.framework + '`';

    // 1) Update "Last Seen" on matching Open issues.
    // Open row layout: | ID | Severity | `lang` | `fw` | First Seen | Last Seen | Title |
    const openSec = findKnownIssuesSection(lines, '## Open');
    if (openSec && openSec.firstDataIdx !== -1) {
      for (let i = openSec.firstDataIdx; i <= openSec.lastDataIdx; i++) {
        const cells = parseTableCells(lines[i]);
        if (!cells || cells.length < 7) continue;
        if (cells[2] === langCell && cells[3] === fwCell) {
          cells[5] = lastSeenStr;
          lines[i] = `| ${cells.join(' | ')} |`;
        }
      }
    }

    // 2) Update / append rows in "Auto-suggested leads".
    // Lead row layout: | First Seen | Last Seen | `lang` | `fw` | Source | Lead |
    const leads: Array<{ source: string; text: string }> = [];
    for (const a of update.anomalies) {
      const trimmed = a.trim();
      if (trimmed.length > 0) leads.push({ source: 'LLM anomaly', text: trimmed });
    }
    for (const f of update.flags) {
      leads.push({ source: `flag:${f.code}`, text: f.message });
    }
    if (leads.length === 0) {
      await fs.writeFile(KNOWN_ISSUES_PATH, lines.join('\n'), 'utf-8');
      return;
    }

    const leadsSec = findKnownIssuesSection(lines, '## Auto-suggested leads');
    if (!leadsSec) {
      console.warn('[performancePostRun] Auto-suggested leads section missing — skipping leads append');
      await fs.writeFile(KNOWN_ISSUES_PATH, lines.join('\n'), 'utf-8');
      return;
    }

    // Track whether the current data row is the placeholder.
    let placeholderIdx = -1;
    if (leadsSec.firstDataIdx !== -1) {
      for (let i = leadsSec.firstDataIdx; i <= leadsSec.lastDataIdx; i++) {
        if (LEADS_PLACEHOLDER_RE.test(lines[i])) { placeholderIdx = i; break; }
      }
    }

    for (const lead of leads) {
      // Search for a matching existing row (same combo + source + lead).
      let matchedIdx = -1;
      if (leadsSec.firstDataIdx !== -1) {
        for (let i = leadsSec.firstDataIdx; i <= leadsSec.lastDataIdx; i++) {
          if (i === placeholderIdx) continue;
          const cells = parseTableCells(lines[i]);
          if (!cells || cells.length < 6) continue;
          if (cells[2] === langCell && cells[3] === fwCell && cells[4] === lead.source && cells[5] === lead.text) {
            matchedIdx = i;
            break;
          }
        }
      }
      if (matchedIdx !== -1) {
        // Refresh Last Seen.
        const cells = parseTableCells(lines[matchedIdx])!;
        cells[1] = lastSeenStr;
        lines[matchedIdx] = `| ${cells.join(' | ')} |`;
      } else {
        const newRow = `| ${lastSeenStr} | ${lastSeenStr} | ${langCell} | ${fwCell} | ${lead.source} | ${lead.text} |`;
        if (placeholderIdx !== -1) {
          lines[placeholderIdx] = newRow;
          leadsSec.firstDataIdx = placeholderIdx;
          leadsSec.lastDataIdx = placeholderIdx;
          placeholderIdx = -1;
        } else if (leadsSec.lastDataIdx !== -1) {
          lines.splice(leadsSec.lastDataIdx + 1, 0, newRow);
          leadsSec.lastDataIdx += 1;
        } else {
          // Empty section with no placeholder — find separator row beneath the
          // table header and insert after it.
          let sepIdx = -1;
          for (let j = leadsSec.headerIdx + 1; j < lines.length && j < leadsSec.headerIdx + 8; j++) {
            if (/^\|[\s|:-]+\|$/.test(lines[j].trim())) { sepIdx = j; break; }
          }
          if (sepIdx === -1) {
            console.warn('[performancePostRun] could not locate Auto-suggested leads separator — skipping a lead');
            continue;
          }
          lines.splice(sepIdx + 1, 0, newRow);
          leadsSec.firstDataIdx = sepIdx + 1;
          leadsSec.lastDataIdx = sepIdx + 1;
        }
      }
    }

    await fs.writeFile(KNOWN_ISSUES_PATH, lines.join('\n'), 'utf-8');
  } finally {
    await releaseScoresheetLock();
  }
}

async function appendScoresheetRow(row: ScoresheetRow): Promise<void> {
  const acquired = await acquireScoresheetLock();
  if (!acquired) {
    console.warn('[performancePostRun] Could not acquire scoresheet lock — skipping append');
    return;
  }
  try {
    const md = await fs.readFile(SCORESHEET_PATH, 'utf-8').catch(() => '');
    if (!md.includes('## All scored runs')) {
      // Scoresheet missing or corrupt — leave alone.
      console.warn('[performancePostRun] scoresheet.md missing "## All scored runs" section — skipping append');
      return;
    }
    // Find the "## All scored runs" section's header row, then append after the last data row.
    const lines = md.split('\n');
    let inSection = false;
    let lastDataLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '## All scored runs') {
        inSection = true;
        continue;
      }
      if (inSection && lines[i].startsWith('## ')) break; // next section
      if (inSection && /^\|/.test(lines[i].trim())) lastDataLineIdx = i;
    }
    if (lastDataLineIdx < 0) {
      console.warn('[performancePostRun] could not locate "## All scored runs" data rows — skipping');
      return;
    }
    lines.splice(lastDataLineIdx + 1, 0, rowToMarkdown(row));
    await fs.writeFile(SCORESHEET_PATH, lines.join('\n'), 'utf-8');
  } finally {
    await releaseScoresheetLock();
  }
}

// ============================================================================
// Prompt composition
// ============================================================================

async function composePrompt(args: {
  cands: DiscoveryCandidate[];
  packCombo: PackCombo;
  weightSet: PerformanceScore['weightSet'];
  flags: DeterministicFlag[];
  golden: GoldenAnchor | null;
  runMeta: { runId: string; mode: string; tier: string; durationMs: number | null };
}): Promise<{ system: string; user: string }> {
  const rubric = await fs.readFile(RUBRIC_PATH, 'utf-8');
  const summary = summarise(args.cands);
  const samples = samplePerType(args.cands, SAMPLE_SIZE);

  const summaryLines: string[] = [
    `runId: ${args.runMeta.runId}`,
    `mode: ${args.runMeta.mode}, tier: ${args.runMeta.tier}`,
    args.runMeta.durationMs !== null ? `duration: ${Math.round(args.runMeta.durationMs / 1000)}s` : 'duration: unknown',
    `total candidates: ${summary.total}`,
    `adapter: ${summary.adapter} (${summary.total ? Math.round((summary.adapter / summary.total) * 100) : 0}%)`,
    `LLM: ${summary.llm} (${summary.total ? Math.round((summary.llm / summary.total) * 100) : 0}%)`,
    '',
    '== PER-TYPE BREAKDOWN ==',
  ];
  for (const t of CURRENTLY_ANALYSED_MM_TYPES) {
    const c = summary.perType[t];
    summaryLines.push(`${t}: ${c.total} (adapter: ${c.adapter}, llm: ${c.llm})`);
  }

  const sampleLines: string[] = ['', '== PER-TYPE SAMPLES =='];
  for (const t of CURRENTLY_ANALYSED_MM_TYPES) {
    const list = samples[t];
    if (list.length === 0) continue;
    sampleLines.push(`\n--- ${t} (${list.length} of ${summary.perType[t].total}) ---`);
    for (const c of list) {
      const d = (c.data as Record<string, unknown> | undefined) ?? {};
      const slim: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(d)) {
        if (k === 'description') continue; // free text — drop to save tokens
        if (typeof v === 'string' && v.length > 200) {
          slim[k] = v.slice(0, 200) + '…';
        } else {
          slim[k] = v;
        }
      }
      const addedBy = String(slim._addedBy ?? '');
      delete slim._addedBy;
      sampleLines.push(`  [${addedBy}] ${c.name}: ${JSON.stringify(slim)}`);
    }
  }

  // GOLDEN ANCHOR (calibration only — 2026-04-28 rewrite).
  //
  // The golden run is on a DIFFERENT repository. Sending its candidate
  // counts as a benchmark to the LLM was actively harmful: every run got
  // marked down for "count below golden baseline" or "count above golden",
  // which says nothing about the pack's actual performance on the current
  // repo. The block below now sends only repo-agnostic calibration:
  //   - the golden's overall score
  //   - the golden's adapter share (a relative metric, not a count)
  //   - the golden's per-type AXIS scores when available (also relative)
  //   - an explicit instruction NOT to compare counts run-to-run
  const goldenAxesLines: string[] = [];
  if (args.golden?.perTypeAxes) {
    goldenAxesLines.push('Per-type axis scores (calibration — what "good" looks like on this pack):');
    for (const t of CURRENTLY_ANALYSED_MM_TYPES) {
      const a = args.golden.perTypeAxes[t];
      if (!a) continue;
      goldenAxesLines.push(
        `  ${t}: coverage=${a.coverage}, accuracy=${a.accuracy}, metadata=${a.metadataRichness}, provenance=${a.provenanceBalance}`,
      );
    }
  }
  const goldenBlock = args.golden
    ? [
        '== GOLDEN ANCHOR (calibration only — DIFFERENT repo) ==',
        `Best score so far on this pack: ${args.golden.score.toFixed(1)} (runId ${args.golden.runId.slice(0, 8)}..., ${args.golden.date})`,
        `Adapter share on the golden run: ${(args.golden.adapterShare * 100).toFixed(0)}%`,
        ...goldenAxesLines,
        '',
        'CRITICAL: the golden anchor is a DIFFERENT REPOSITORY. Do NOT compare candidate counts between runs — a small microservice legitimately has fewer endpoints than a 200-controller monolith. Use the golden ONLY as score calibration ("a run scoring 4.5 on this pack typically looks like X"). Score the current run on its OWN internal plausibility (count vs. scope, samples vs. expected shape, metadata population), never on count parity with the golden.',
      ].join('\n')
    : '== GOLDEN ANCHOR ==\n(none — this is the first scored run for this pack; tag confidence: "no-baseline")';

  const flagsBlock =
    args.flags.length > 0
      ? [
          '== DETERMINISTIC FLAGS (pre-computed by performanceHeuristics) ==',
          ...args.flags.map((f) => `[${f.severity}] ${f.code}: ${f.message}`),
        ].join('\n')
      : '== DETERMINISTIC FLAGS ==\n(none)';

  const user = [
    'Score this discovery run against the rubric.',
    '',
    `PACK COMBO: ${args.packCombo.language} / ${args.packCombo.frameworks.join(', ') || '(no frameworks)'}`,
    `WEIGHT SET: ${args.weightSet}`,
    '',
    goldenBlock,
    '',
    flagsBlock,
    '',
    '== CURRENT RUN DATA ==',
    summaryLines.join('\n'),
    sampleLines.join('\n'),
    '',
    'Emit a single JSON object matching the schema in the rubric. No prose, no markdown fences. Per-axis scores are integers 0-5; per-type and overall scores have one decimal place.',
  ].join('\n');

  return { system: rubric, user };
}

// ============================================================================
// LLM call + JSON parsing
// ============================================================================

async function callScorer(prompt: { system: string; user: string }, runId: string): Promise<PerformanceScore | null> {
  try {
    const raw = await gatewayClient.scoreDiscoveryPerformance({
      runId,
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
    });
    if (!raw || !raw.content) {
      console.warn('[performancePostRun] empty LLM response');
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.content);
    } catch (err) {
      console.warn('[performancePostRun] LLM returned non-JSON content; aborting', err);
      return null;
    }
    return parsed as PerformanceScore;
  } catch (err) {
    console.warn(
      `[performancePostRun] gateway scoreDiscoveryPerformance failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

// ============================================================================
// Per-run MD writer
// ============================================================================

function slugify(s: string, maxLen = 30): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen);
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildPerRunMd(args: {
  score: PerformanceScore;
  serviceName: string;
  packCombo: PackCombo;
  flags: DeterministicFlag[];
  goldenComparison: { existed: boolean; beat: boolean; deltaVsGolden: number | null };
  runMeta: { mode: string; tier: string; durationMs: number | null };
}): string {
  const s = args.score;
  const lines: string[] = [];
  lines.push(`# Performance Score — Run ${s.runId.slice(0, 8)}...`);
  lines.push('');
  lines.push(`Scored at: ${s.scoredAt}  ·  Rubric v${s.rubricVersion}  ·  Confidence: ${s.confidence}`);
  lines.push('');
  lines.push(`**Overall: ${s.overall.toFixed(1)} / 5.0**`);
  lines.push('');
  lines.push('## Run identification');
  lines.push('');
  lines.push(`- **runId:** \`${s.runId}\``);
  lines.push(`- **service:** ${args.serviceName}`);
  lines.push(`- **pack combo:** ${args.packCombo.language} / ${args.packCombo.frameworks.join(', ') || '(no frameworks)'}`);
  lines.push(`- **weight set:** ${s.weightSet}`);
  lines.push(`- **mode:** ${args.runMeta.mode}, tier ${args.runMeta.tier}`);
  if (args.runMeta.durationMs !== null) {
    lines.push(`- **duration:** ${Math.round(args.runMeta.durationMs / 1000)}s`);
  }
  lines.push('');
  lines.push('## Golden-anchor comparison');
  lines.push('');
  if (s.goldenAnchor.runId) {
    lines.push(`- **Compared against:** golden runId \`${s.goldenAnchor.runId.slice(0, 8)}...\` (score ${s.goldenAnchor.score?.toFixed(1)})`);
    if (args.goldenComparison.deltaVsGolden !== null) {
      const delta = args.goldenComparison.deltaVsGolden;
      const sign = delta > 0 ? '+' : '';
      lines.push(`- **Δ vs golden:** ${sign}${delta.toFixed(1)} ${args.goldenComparison.beat ? '— **NEW GOLDEN**' : ''}`);
    }
  } else {
    lines.push('- No prior golden for this pack; this run becomes the seed golden if scoring succeeds.');
  }
  lines.push('');
  if (args.flags.length > 0) {
    lines.push('## Deterministic flags');
    lines.push('');
    for (const f of args.flags) {
      lines.push(`- **[${f.severity}] ${f.code}** — ${f.message}`);
    }
    lines.push('');
  }
  lines.push('## Per-type scores');
  lines.push('');
  lines.push('| Type | Count | Coverage | Accuracy | Metadata | Provenance | Score | Reasoning |');
  lines.push('|---|--:|--:|--:|--:|--:|--:|---|');
  for (const t of CURRENTLY_ANALYSED_MM_TYPES) {
    const r = s.perType[t];
    if (!r) continue;
    lines.push(
      `| \`${t}\` | ${r.count} | ${r.axes.coverage} | ${r.axes.accuracy} | ${r.axes.metadataRichness} | ${r.axes.provenanceBalance} | **${r.score.toFixed(1)}** | ${r.reasoning} |`,
    );
  }
  lines.push('');
  lines.push('## Cross-cutting axes');
  lines.push('');
  lines.push('| Axis | Score |');
  lines.push('|---|--:|');
  lines.push(`| Determinism | ${s.crossCutting.determinism} |`);
  lines.push(`| Hallucination rate | ${s.crossCutting.hallucinationRate} |`);
  lines.push(`| Coverage of obvious gaps | ${s.crossCutting.coverageOfObviousGaps} |`);
  lines.push(`| Cost | ${s.crossCutting.cost} |`);
  lines.push('');
  if (s.anomalies.length > 0) {
    lines.push('## Anomalies');
    lines.push('');
    for (const a of s.anomalies) {
      lines.push(`- ${a}`);
    }
    lines.push('');
  }
  lines.push('---');
  lines.push('');
  lines.push('## Raw score JSON');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(s, null, 2));
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

// ============================================================================
// Public entry: scoreRun
// ============================================================================

export async function scoreRun(input: ScoreRunInput): Promise<{
  status: 'scored' | 'skipped' | 'failed';
  score: PerformanceScore | null;
  perRunPath: string | null;
  promotedToGolden: boolean;
  reason?: string;
}> {
  const { projectId, runId } = input;
  console.log(`[performancePostRun] scoring runId=${runId}`);

  // 1) Load run + candidates
  let run;
  try {
    run = await archModelClient.getDiscoveryRun(projectId, runId);
  } catch (err) {
    console.warn(`[performancePostRun] could not fetch discovery run: ${err}`);
    return { status: 'failed', score: null, perRunPath: null, promotedToGolden: false, reason: 'fetch-run-failed' };
  }
  if (!run) {
    return { status: 'failed', score: null, perRunPath: null, promotedToGolden: false, reason: 'run-not-found' };
  }

  let candidates: DiscoveryCandidate[];
  try {
    candidates = await archModelClient.getCandidatesByRun(projectId, runId);
  } catch (err) {
    console.warn(`[performancePostRun] could not fetch candidates: ${err}`);
    return { status: 'failed', score: null, perRunPath: null, promotedToGolden: false, reason: 'fetch-candidates-failed' };
  }
  if (candidates.length === 0) {
    return { status: 'skipped', score: null, perRunPath: null, promotedToGolden: false, reason: 'no-candidates' };
  }

  // 2) Pack combo + weight set.
  //
  // For service-scoped runs, fetch the service entity so we can read its
  // resolved language/framework pack columns directly. The framing config
  // on a multi-stack project (e.g. Java backend + React frontend in one
  // repo) carries hints from BOTH stacks; using those would mis-identify
  // a single-service-scoped run's pack. Using the service's resolved
  // columns gives us the actual packs that ran for this scope.
  const runRec = run as unknown as Record<string, unknown>;
  const runServiceId =
    typeof runRec.service_id === 'string' && (runRec.service_id as string).length > 0
      ? (runRec.service_id as string)
      : null;
  let serviceForCombo: { core_tech_language_pack?: string | null; core_tech_framework_packs?: string[] | null } | null = null;
  let serviceDisplayName: string | null = null;
  if (runServiceId) {
    try {
      // Read the architectureId bound to this run by the route layer at
      // run start (Spec: 2026-05-01 Multi-Architecture Discovery Integration
      // — Task Group 4). Fall back to the spec #1 default-resolver helper
      // only when there is no in-process binding (e.g. the discovery-service
      // process restarted between run-start and the post-run scoring trigger,
      // or the scorer was invoked directly via scripts/score-discovery-run.ts
      // outside a run lifecycle).
      const boundArchitectureId = getRunArchitectureId(runId);
      const architectureId = boundArchitectureId
        ?? (await archModelClient.resolveDefaultArchitectureId(projectId));
      const svc = await archModelClient.getService(projectId, architectureId, runServiceId);
      if (svc) {
        const svcRec = svc as unknown as Record<string, unknown>;
        serviceForCombo = {
          core_tech_language_pack: svcRec.core_tech_language_pack as string | null,
          core_tech_framework_packs: svcRec.core_tech_framework_packs as string[] | null,
        };
        const n = svcRec.name;
        if (typeof n === 'string' && n.length > 0) serviceDisplayName = n;
      }
    } catch (err) {
      console.warn(
        `[performancePostRun] could not fetch service ${runServiceId} for pack-combo inference; falling back to config_snapshot. ${err}`,
      );
    }
  }
  const packCombo = inferPackCombo(serviceForCombo, runRec.config_snapshot);
  const weightSet = inferWeightSet(packCombo);
  const packKey = packComboKey(packCombo);

  // 3) Heuristic flags
  const flags = runDeterministicChecks({
    candidates,
    packCombo,
    filesAnalyzed: undefined,
    hasWebScope: undefined,
  });

  // 4) Golden anchor
  const golden = await loadGoldenAnchor(packKey);

  // 5) Compose prompt + call LLM
  const runMeta = {
    runId,
    mode: String((run as unknown as Record<string, unknown>).mode ?? 'unknown'),
    tier: String((run as unknown as Record<string, unknown>).tier ?? 'unknown'),
    durationMs: null as number | null, // can be derived from created_at/updated_at if needed
  };
  const prompt = await composePrompt({
    cands: candidates,
    packCombo,
    weightSet,
    flags,
    golden,
    runMeta,
  });
  const score = await callScorer(prompt, runId);
  if (!score) {
    // Write a FAILED file so reviewers can see this attempt was made.
    await fs.mkdir(RUNS_DIR, { recursive: true });
    const failPath = path.join(RUNS_DIR, `${dateStamp()}-${runId}-FAILED.md`);
    await fs.writeFile(
      failPath,
      [
        `# Performance Score — Run ${runId.slice(0, 8)}... (FAILED)`,
        '',
        `Scored at: ${new Date().toISOString()}`,
        '',
        'The LLM scoring call did not return a parseable result. The discovery run itself completed successfully — only the performance scoring failed.',
        '',
        '- Pack combo: ' + packCombo.language + ' / ' + packCombo.frameworks.join(', '),
        '- Deterministic flags raised: ' + flags.length,
        '',
        flags.map((f) => `  - [${f.severity}] ${f.code}: ${f.message}`).join('\n'),
        '',
      ].join('\n'),
      'utf-8',
    );
    return { status: 'failed', score: null, perRunPath: failPath, promotedToGolden: false, reason: 'llm-failed' };
  }

  // Inject runner-known fields into the score (the LLM wouldn't know them).
  score.runId = runId;
  score.scoredAt = new Date().toISOString();
  if (!score.rubricVersion) score.rubricVersion = '2';
  score.packCombo = packCombo;
  score.weightSet = weightSet;
  score.deterministicFlags = flags;
  score.goldenAnchor = golden
    ? { runId: golden.runId, score: golden.score }
    : { runId: null, score: null };
  score.confidence = golden ? 'baseline-anchored' : 'no-baseline';

  // 6) Write per-run MD
  await fs.mkdir(RUNS_DIR, { recursive: true });
  const serviceName = String((run as unknown as Record<string, unknown>).service_id ?? 'unknown').slice(0, 12);
  const filename = `${dateStamp()}-${runId.slice(0, 8)}-${slugify(serviceName)}.md`;
  const perRunPath = path.join(RUNS_DIR, filename);
  const goldenComparison = {
    existed: !!golden,
    beat: !!golden && score.overall > golden.score + 0.1,
    deltaVsGolden: golden ? Number((score.overall - golden.score).toFixed(2)) : null,
  };
  const md = buildPerRunMd({ score, serviceName, packCombo, flags, goldenComparison, runMeta });
  await fs.writeFile(perRunPath, md, 'utf-8');

  // 7) Update scoresheet — Service column shows full id with display name
  // when available, e.g. "svc-mob4f5ai-h4yfj (PetClinic)". Falls back to the
  // raw service_id otherwise.
  const summary = summarise(candidates);
  const adapterPct = summary.total > 0 ? Math.round((summary.adapter / summary.total) * 100) : 0;
  const fullServiceId = String((run as unknown as Record<string, unknown>).service_id ?? 'unknown');
  const scoresheetService = serviceDisplayName
    ? `${fullServiceId} (${serviceDisplayName})`
    : fullServiceId;
  const perRunRelPath = `runs/${filename}`;
  await appendScoresheetRow({
    date: dateStamp(),
    runId,
    service: scoresheetService,
    language: packCombo.language,
    frameworks: packCombo.frameworks.join(', ') || '(none)',
    mode: runMeta.mode,
    tier: runMeta.tier,
    totalCands: summary.total,
    adapterPct,
    overall: score.overall,
    confidence: score.confidence,
    rubricVersion: score.rubricVersion,
    metaModelTypes: CURRENTLY_ANALYSED_MM_TYPES.length,
    isGolden: goldenComparison.beat || !golden,
    perRunPath: perRunRelPath,
  });

  // 7b) Update "Best per pack combo" band tables. Move the combo's row into
  // the band that matches the new score, but only if the new score beats
  // the existing recorded best. One framework per combo for now (the
  // banding key uses the first framework if multiple are listed).
  const primaryFw = packCombo.frameworks[0] ?? '';
  if (primaryFw) {
    const noteName = serviceDisplayName ?? fullServiceId;
    const beatGolden = goldenComparison.beat;
    const noteParts = [
      `${noteName}.`,
      `${adapterPct}% adapter, ${summary.total.toLocaleString()} cands.`,
    ];
    if (beatGolden) noteParts.push('(new golden)');
    await updateBestPerCombo({
      language: packCombo.language,
      framework: primaryFw,
      runId,
      score: score.overall,
      dateStr: dateStamp(),
      metaModelTypes: CURRENTLY_ANALYSED_MM_TYPES.length,
      perRunPath: perRunRelPath,
      notes: noteParts.join(' '),
    });

    // 7c) Maintain KNOWN_ISSUES.md — refresh "Last Seen" on Open issues
    // tagged with this combo, and append/refresh "Auto-suggested leads"
    // from anomalies + deterministic flags. Manual issues are not edited.
    await updateKnownIssues({
      language: packCombo.language,
      framework: primaryFw,
      runId,
      dateStr: dateStamp(),
      anomalies: Array.isArray(score.anomalies) ? score.anomalies : [],
      flags,
    });
  }

  // 8) Self-improving golden — promote if beat
  let promoted = false;
  if (!golden || goldenComparison.beat) {
    const newGolden: GoldenAnchor = {
      runId,
      score: score.overall,
      date: dateStamp(),
      perType: CURRENTLY_ANALYSED_MM_TYPES.reduce<Record<CandidateType, number>>(
        (acc, t) => {
          acc[t] = summary.perType[t].total;
          return acc;
        },
        {} as Record<CandidateType, number>,
      ),
      adapterShare: summary.total > 0 ? summary.adapter / summary.total : 0,
      // Per-type axes are repo-agnostic and are what the prompt actually
      // sends to future scorer calls (counts are deliberately not sent —
      // see the calibration-only goldenBlock in composePrompt).
      perTypeAxes: CURRENTLY_ANALYSED_MM_TYPES.reduce<Record<CandidateType, {
        coverage: number; accuracy: number; metadataRichness: number; provenanceBalance: number;
      }>>((acc, t) => {
        const pt = score.perType[t];
        acc[t] = pt
          ? {
              coverage: pt.axes.coverage,
              accuracy: pt.axes.accuracy,
              metadataRichness: pt.axes.metadataRichness,
              provenanceBalance: pt.axes.provenanceBalance,
            }
          : { coverage: 0, accuracy: 0, metadataRichness: 0, provenanceBalance: 0 };
        return acc;
      }, {} as Record<CandidateType, { coverage: number; accuracy: number; metadataRichness: number; provenanceBalance: number }>),
    };
    const goldenBody = buildGoldenBody(newGolden, packCombo, score, summary);
    await writeGoldenAnchor(packKey, newGolden, goldenBody);
    promoted = true;
    console.log(
      `[performancePostRun] promoted runId=${runId} to golden for pack ${packKey} (score ${score.overall.toFixed(1)} ${golden ? 'beat ' + golden.score.toFixed(1) : 'seed'})`,
    );
  }

  return { status: 'scored', score, perRunPath, promotedToGolden: promoted };
}

function buildGoldenBody(
  anchor: GoldenAnchor,
  packCombo: PackCombo,
  score: PerformanceScore,
  summary: CountsSummary,
): string {
  const lines: string[] = [];
  lines.push(`# Golden Run — ${packCombo.language} / ${packCombo.frameworks.join(', ') || '(no frameworks)'}`);
  lines.push('');
  lines.push(
    'This file pins the historical anchor for this pack combo. Updated automatically when a new run beats the recorded score by more than 0.1.',
  );
  lines.push('');
  lines.push(`**Current golden:** \`${anchor.runId}\``);
  lines.push(`**Score:** ${anchor.score.toFixed(1)} / 5.0`);
  lines.push(`**Date:** ${anchor.date}`);
  lines.push(`**Adapter share:** ${(anchor.adapterShare * 100).toFixed(0)}%`);
  lines.push(`**Total candidates:** ${summary.total.toLocaleString()}`);
  lines.push('');
  lines.push('## Anchor counts (per-type)');
  lines.push('');
  lines.push('| Type | Count |');
  lines.push('|---|--:|');
  for (const t of CURRENTLY_ANALYSED_MM_TYPES) {
    lines.push(`| \`${t}\` | ${anchor.perType[t]} |`);
  }
  lines.push('');
  if (score.anomalies.length > 0) {
    lines.push('## Notable observations from the scoring LLM');
    lines.push('');
    for (const a of score.anomalies) {
      lines.push(`- ${a}`);
    }
    lines.push('');
  }
  lines.push('---');
  return lines.join('\n');
}
