/**
 * Streaming pre-scan + sample-block assembler (Spec
 * 2026-06-20-runtime-log-evidence-format-agnostic-extraction, Task Group 2).
 *
 * STEP 1 of the quality-first runtime-log pipeline: a cheap, deterministic,
 * NO-LLM pass that turns an arbitrary-format log file into a small set of
 * REDACTED, budget-capped sample BLOCKS the LLM recipe-induction step (Task
 * Group 5) can study. The whole file is scanned; only a tiny representative
 * sample ever leaves the process, and only AFTER redaction.
 *
 * Design invariants (all test-pinned):
 *   - Candidate detection reuses the Task Group 1 `detectRequestLikeLine`
 *     primitive (HTTP verb + `/path` OR absolute URL) so the pre-scan's
 *     notion of a "request-like line" is byte-identical to the deterministic
 *     fallback matcher's. A bare `/seg/seg` path token is an ADDITIONAL signal
 *     added here (logs that print a bare path with no verb).
 *   - Blocks are spread across the file by BYTE OFFSET, not by "first N
 *     lines": startup banners cluster at the top of a log and must not consume
 *     the sample budget.
 *   - Near-identical blocks are de-duplicated so one hammered endpoint cannot
 *     crowd out the rest of the file.
 *   - EVERY emitted block is scrubbed with `redactFullBody` (existing secret
 *     defaults; nothing added). No un-redacted log content may leave the
 *     process -- this is the privacy invariant.
 *   - Per-line truncation (~2k chars) and a total assembled-sample cap
 *     (~12k chars) bound cost.
 *   - On ZERO request-like hits, fall back to offset-stratified
 *     head/middle/tail windows so the LLM still receives representative data.
 *   - Deterministic: the same input bytes always yield the same block
 *     selection.
 *
 * Streaming: the file is read via `fs.createReadStream` + `readline`
 * (mirroring `sampleFirstLines` / `parseClfStream`) tracking the BYTE OFFSET
 * of each line. Line metadata is retained for window assembly; the existing
 * per-file cap (`LOG_PARSE_MAX_FILE_BYTES`, 100MB) keeps that bounded, and the
 * non-CLF extraction path already buffers a whole file, so this is consistent
 * with the module's existing memory profile.
 */

import * as fs from 'fs';
import * as readline from 'readline';

import { detectRequestLikeLine } from './runDiscoveryRuntimeEvidence';
import { redactFullBody } from '../../utils/snippetRedaction';

/** Lines of context retained BEFORE a hit line in an assembled block. */
export const BLOCK_LINES_BEFORE = 10;
/** Lines of context retained AFTER a hit line in an assembled block. */
export const BLOCK_LINES_AFTER = 30;
/** Target number of assembled blocks (spread across the file). */
export const MIN_TARGET_BLOCKS = 8;
export const MAX_TARGET_BLOCKS = 12;
/** Per-line truncation cap (chars). Over-long lines are clipped. */
export const MAX_LINE_CHARS = 2000;
/** Total assembled-sample cap (chars) across all blocks. */
export const MAX_SAMPLE_CHARS = 12000;

/**
 * A bare `/segment/segment...` path token anywhere in a line. This is the
 * ADDITIONAL pre-scan signal (beyond the TG1 verb/URL detector) for logs that
 * print a path with no HTTP verb. Requires at least two segments so ordinary
 * unix paths-in-prose are less likely to false-positive; the redaction +
 * held-out validation downstream tolerate occasional noise.
 */
const BARE_PATH_TOKEN_REGEX = /(?:^|[\s"'(\[=])(\/[A-Za-z0-9._~%-]+(?:\/[A-Za-z0-9._~%-]+)+)/;

/** One scanned line plus its byte offset within the file. */
interface ScannedLine {
  /** 0-based line index. */
  index: number;
  /** Byte offset of the line's first byte within the file. */
  byteOffset: number;
  /** The line text (line terminator stripped). */
  text: string;
  /** True when this line is a request-like candidate (a "hit"). */
  isHit: boolean;
}

/** A single assembled, redacted sample block. */
export interface SampleBlock {
  /** 0-based index of the hit line that anchored this block (or window start for fallback). */
  hitLineIndex: number;
  /** Byte offset of the anchor line. */
  byteOffset: number;
  /** Inclusive 0-based start line index of the block window. */
  startLineIndex: number;
  /** Inclusive 0-based end line index of the block window. */
  endLineIndex: number;
  /** The redacted block text (per-line truncated, joined by `\n`). */
  text: string;
  /** True when this block came from the zero-hits head/middle/tail fallback. */
  fromFallbackWindow: boolean;
}

/** Result of a pre-scan + sample pass. */
export interface PreScanSampleResult {
  /** Total lines scanned. */
  totalLines: number;
  /** Total bytes scanned. */
  totalBytes: number;
  /** Number of request-like hit lines detected across the whole file. */
  hitCount: number;
  /** The assembled, redacted, budget-capped sample blocks. */
  blocks: SampleBlock[];
  /** The concatenated assembled sample (`blocks` joined), already ≤ MAX_SAMPLE_CHARS. */
  assembledSample: string;
  /** True when blocks came from the zero-hits fallback windows. */
  usedFallbackWindows: boolean;
}

/**
 * Detect whether a line is "request-like" for pre-scan purposes.
 *
 * Reuses the Task Group 1 `detectRequestLikeLine` primitive (verb + `/path`
 * or absolute URL) and ALSO accepts a bare `/seg/seg` path token. Exported so
 * tests can assert the candidate-detection contract directly.
 */
export function isRequestLikeLine(line: string): boolean {
  if (!line) return false;
  if (detectRequestLikeLine(line)) return true;
  BARE_PATH_TOKEN_REGEX.lastIndex = 0;
  return BARE_PATH_TOKEN_REGEX.test(line);
}

/**
 * Stream the file via `createReadStream` + `readline`, recording every line's
 * byte offset and whether it is a request-like hit.
 *
 * `readline` strips the line terminator, so the byte offset of the NEXT line
 * is advanced by the UTF-8 byte length of the current line plus the terminator
 * width. We cannot know from `readline` alone whether the terminator was
 * `\n` or `\r\n`, so the offset is an approximation accurate to ±1 byte per
 * `\r\n` line; that is sufficient for the spread/stratification heuristic
 * (offsets are used only to bucket lines across the file, never to seek).
 */
async function scanLines(filePath: string): Promise<{
  lines: ScannedLine[];
  totalBytes: number;
}> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines: ScannedLine[] = [];
  let byteOffset = 0;
  let index = 0;
  try {
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const rawLine of rl) {
      // `readline` already strips a trailing `\r` when crlfDelay is set; keep
      // the visible text as-is for block assembly.
      const text = rawLine;
      lines.push({
        index,
        byteOffset,
        text,
        isHit: isRequestLikeLine(text),
      });
      // Advance the offset: line bytes + a 1-byte newline assumption.
      byteOffset += Buffer.byteLength(text, 'utf8') + 1;
      index += 1;
    }
  } finally {
    stream.close();
  }
  return { lines, totalBytes: byteOffset };
}

/** Truncate a single line to the per-line char cap, flagging the clip. */
function truncateLine(line: string): string {
  if (line.length <= MAX_LINE_CHARS) return line;
  return line.slice(0, MAX_LINE_CHARS) + ' …[truncated]';
}

/**
 * Build the raw (un-redacted) text for a window of lines, applying per-line
 * truncation. The caller redacts the result before it is retained.
 */
function buildWindowText(lines: ScannedLine[], start: number, end: number): string {
  const out: string[] = [];
  for (let i = start; i <= end && i < lines.length; i++) {
    out.push(truncateLine(lines[i].text));
  }
  return out.join('\n');
}

/**
 * A cheap, order-insensitive-ish dedup signature for a block: the request-like
 * lines inside it, with digit runs collapsed to `#` so the same endpoint
 * hammered with different ids/timestamps produces the SAME signature. Blocks
 * with no request-like lines fall back to a normalized whole-block signature.
 */
function blockSignature(lines: ScannedLine[], start: number, end: number): string {
  // Use the SET of distinct collapsed request-like-line signatures in the
  // window (not the multiset/count): a window that happens to span two
  // hammer hits and one that spans a single hit of the SAME endpoint must
  // share a signature so the hammered endpoint collapses to one block
  // regardless of how many copies the ~40-line window happened to capture.
  const hitSet = new Set<string>();
  for (let i = start; i <= end && i < lines.length; i++) {
    if (lines[i].isHit) {
      hitSet.add(lines[i].text.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim());
    }
  }
  if (hitSet.size > 0) {
    return 'H:' + Array.from(hitSet).sort().join('|');
  }
  // No hits in window (fallback windows): normalize the whole window.
  return 'W:' + buildWindowText(lines, start, end).replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 400);
}

/**
 * Choose `targetCount` hit lines EVENLY SPREAD across the file by BYTE
 * OFFSET. The file's byte span is divided into `targetCount` equal buckets;
 * for each bucket the FIRST hit whose byte offset falls in (or after) that
 * bucket is picked. This guarantees coverage of BOTH the head and the tail
 * of the file -- hits clustered at the top (startup banners, warmup traffic)
 * can never crowd out later-file blocks, because every bucket (including the
 * last) contributes at most one representative. Deterministic: selection
 * depends only on byte offsets and the target count.
 */
function selectSpreadHits(
  lines: ScannedLine[],
  totalBytes: number,
  targetCount: number,
): ScannedLine[] {
  const hits = lines.filter((l) => l.isHit);
  if (hits.length === 0) return [];
  const target = Math.max(1, Math.min(targetCount, hits.length));
  if (hits.length <= target) return hits;

  const span = Math.max(totalBytes, 1);
  const bucketSize = span / target;
  const picked: ScannedLine[] = [];
  const pickedIdx = new Set<number>();
  // One representative per bucket: the first hit at/after the bucket start.
  // Walking hits once (they are already in byte order) keeps this O(n).
  let hitCursor = 0;
  for (let bucket = 0; bucket < target; bucket++) {
    const bucketStart = bucket * bucketSize;
    while (hitCursor < hits.length && hits[hitCursor].byteOffset < bucketStart) {
      hitCursor++;
    }
    if (hitCursor >= hits.length) break;
    const cand = hits[hitCursor];
    if (!pickedIdx.has(cand.index)) {
      pickedIdx.add(cand.index);
      picked.push(cand);
    }
  }
  // Guarantee the LAST hit (file tail) is represented even if bucket
  // rounding skipped it -- the tail block is the load-bearing case.
  const lastHit = hits[hits.length - 1];
  if (!pickedIdx.has(lastHit.index)) {
    pickedIdx.add(lastHit.index);
    picked.push(lastHit);
  }
  // Stable order by line index for deterministic, readable output.
  picked.sort((a, b) => a.index - b.index);
  return picked;
}

/**
 * Build offset-stratified head/middle/tail windows for the zero-hits case so
 * the LLM still gets representative data. Three windows anchored at ~0%, ~50%,
 * and the last full window of the file (by line index, which tracks byte
 * offset closely enough for stratification).
 */
function buildFallbackWindows(lines: ScannedLine[]): SampleBlock[] {
  if (lines.length === 0) return [];
  const windowLen = BLOCK_LINES_BEFORE + 1 + BLOCK_LINES_AFTER;
  const anchors = [
    0,
    Math.floor(lines.length / 2),
    Math.max(0, lines.length - windowLen),
  ];
  const seen = new Set<number>();
  const blocks: SampleBlock[] = [];
  for (const anchor of anchors) {
    const start = Math.max(0, anchor);
    if (seen.has(start)) continue;
    seen.add(start);
    const end = Math.min(lines.length - 1, start + windowLen - 1);
    const raw = buildWindowText(lines, start, end);
    const redacted = redactFullBody(raw);
    blocks.push({
      hitLineIndex: start,
      byteOffset: lines[start].byteOffset,
      startLineIndex: start,
      endLineIndex: end,
      text: redacted.body,
      fromFallbackWindow: true,
    });
  }
  return blocks;
}

/**
 * Estimate the redacted char-length of the block window anchored at a hit.
 * Used to derive how many blocks fit the total budget BEFORE selection, so
 * the byte-spread set we pick is one that survives the cap intact (the tail
 * block is otherwise the first casualty of a naive in-order budget break).
 */
function estimateBlockChars(lines: ScannedLine[], hit: ScannedLine): number {
  const start = Math.max(0, hit.index - BLOCK_LINES_BEFORE);
  const end = Math.min(lines.length - 1, hit.index + BLOCK_LINES_AFTER);
  return redactFullBody(buildWindowText(lines, start, end)).body.length;
}

/**
 * Assemble blocks around byte-spread hits, applying dedup, per-line
 * truncation, redaction, and the total-sample budget cap.
 *
 * Block COUNT is derived from the budget first: we probe one mid-file block
 * to estimate per-block size, divide the total budget by it to get a
 * budget-feasible count (clamped to <= 12), then select THAT many hits
 * evenly spread by byte offset. Because the selected set already fits the
 * budget, every spread block -- including the file-tail block -- is
 * assembled; the final char cap is only a defensive clamp.
 */
function assembleHitBlocks(
  lines: ScannedLine[],
  totalBytes: number,
): SampleBlock[] {
  const allHits = lines.filter((l) => l.isHit);
  if (allHits.length === 0) return [];

  // Estimate per-block size from a mid-file hit (representative window).
  const probe = allHits[Math.floor(allHits.length / 2)];
  const perBlockChars = Math.max(1, estimateBlockChars(lines, probe));
  const budgetCount = Math.max(
    1,
    Math.floor(MAX_SAMPLE_CHARS / (perBlockChars + 2)),
  );
  const targetCount = Math.min(MAX_TARGET_BLOCKS, budgetCount);

  const hits = selectSpreadHits(lines, totalBytes, targetCount);

  const blocks: SampleBlock[] = [];
  const seenSignatures = new Set<string>();
  let budgetUsed = 0;

  for (const hit of hits) {
    const start = Math.max(0, hit.index - BLOCK_LINES_BEFORE);
    const end = Math.min(lines.length - 1, hit.index + BLOCK_LINES_AFTER);

    const signature = blockSignature(lines, start, end);
    if (seenSignatures.has(signature)) continue;

    const raw = buildWindowText(lines, start, end);
    const blockText = redactFullBody(raw).body;

    // Defensive cap: never let the assembled total exceed the budget. The
    // budget-derived count keeps this from cutting the tail block in normal
    // cases; this guard only fires on pathological oversize blocks.
    if (budgetUsed > 0 && budgetUsed + blockText.length > MAX_SAMPLE_CHARS) {
      break;
    }

    seenSignatures.add(signature);
    blocks.push({
      hitLineIndex: hit.index,
      byteOffset: hit.byteOffset,
      startLineIndex: start,
      endLineIndex: end,
      text: blockText,
      fromFallbackWindow: false,
    });
    budgetUsed += blockText.length + 2; // +2 for the "\n\n" join separator.

    if (blocks.length >= MAX_TARGET_BLOCKS) break;
  }
  return blocks;
}

/**
 * Cap the assembled sample to MAX_SAMPLE_CHARS. Blocks are concatenated in
 * order; if the last included block pushes the total over the cap, the
 * concatenation is clipped at the cap boundary (the per-block budget guard
 * already keeps this from discarding whole blocks except at the very end).
 */
function capAssembledSample(blocks: SampleBlock[]): string {
  const joined = blocks.map((b) => b.text).join('\n\n');
  if (joined.length <= MAX_SAMPLE_CHARS) return joined;
  return joined.slice(0, MAX_SAMPLE_CHARS);
}

/**
 * Run the streaming pre-scan + sample-block assembly over a log file.
 *
 * @param filePath absolute path to the log file (already size-capped by the caller).
 * @returns a {@link PreScanSampleResult} whose blocks are redacted and budgeted.
 */
export async function preScanAndSample(filePath: string): Promise<PreScanSampleResult> {
  const { lines, totalBytes } = await scanLines(filePath);
  const hitCount = lines.reduce((n, l) => (l.isHit ? n + 1 : n), 0);

  if (hitCount === 0) {
    const fallbackBlocks = buildFallbackWindows(lines);
    return {
      totalLines: lines.length,
      totalBytes,
      hitCount: 0,
      blocks: fallbackBlocks,
      assembledSample: capAssembledSample(fallbackBlocks),
      usedFallbackWindows: true,
    };
  }

  const blocks = assembleHitBlocks(lines, totalBytes);

  return {
    totalLines: lines.length,
    totalBytes,
    hitCount,
    blocks,
    assembledSample: capAssembledSample(blocks),
    usedFallbackWindows: false,
  };
}

/**
 * In-memory variant for tests / callers that already hold the file content.
 * Splits on `\n`, assigns approximate byte offsets, and runs the same
 * selection/assembly/redaction pipeline as {@link preScanAndSample}.
 */
export function preScanAndSampleContent(content: string): PreScanSampleResult {
  const rawLines = content.split('\n');
  const lines: ScannedLine[] = [];
  let byteOffset = 0;
  rawLines.forEach((text, index) => {
    lines.push({ index, byteOffset, text, isHit: isRequestLikeLine(text) });
    byteOffset += Buffer.byteLength(text, 'utf8') + 1;
  });
  const totalBytes = byteOffset;
  const hitCount = lines.reduce((n, l) => (l.isHit ? n + 1 : n), 0);

  if (hitCount === 0) {
    const fallbackBlocks = buildFallbackWindows(lines);
    return {
      totalLines: lines.length,
      totalBytes,
      hitCount: 0,
      blocks: fallbackBlocks,
      assembledSample: capAssembledSample(fallbackBlocks),
      usedFallbackWindows: true,
    };
  }

  const blocks = assembleHitBlocks(lines, totalBytes);
  return {
    totalLines: lines.length,
    totalBytes,
    hitCount,
    blocks,
    assembledSample: capAssembledSample(blocks),
    usedFallbackWindows: false,
  };
}
