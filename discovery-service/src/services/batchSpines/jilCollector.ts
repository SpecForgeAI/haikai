/**
 * JIL collector (D2 — Capability Synthesis + Batch Spines, Task Group 4).
 *
 * The capability-synthesis step lands the Autosys orchestration topology
 * AUTHORITATIVELY in capability `detail_json`. To do that it needs the parsed
 * {@link JilTopology} for every `.jil` file in scope. `.jil` files are
 * symbol-less, so they are NOT in the source-language IR set (`irFiles`) and the
 * D1 operational-artifact scan discards their raw text after summarising. This
 * collector does the minimal, self-contained re-read: walk `repoRoot` for
 * `.jil` files and parse each via the hand-rolled {@link parseJil} (NO
 * tree-sitter, NO candidate minting).
 *
 * Bounded + soft: it honours the standard skip-directories, caps the file count
 * and per-file bytes, and never throws (a read / parse failure is logged and the
 * file is skipped). Returns a map keyed by repo-relative `.jil` path. Empty when
 * no `.jil` files exist (the zero-JIL path, fully supported by D9).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { parseJil, type JilTopology } from './jilParser';
import { SKIP_DIRECTORIES } from '../scanPlanBuilder';

/** Max `.jil` files parsed per run (a defensive cap). */
const MAX_JIL_FILES = 500;
/** Max bytes read per `.jil` file (Autosys definitions are small). */
const MAX_JIL_BYTES = 2 * 1024 * 1024;

/**
 * Recursively collect repo-relative `.jil` file paths under `scanRoot`, pruning
 * the standard skip directories. Bounded by {@link MAX_JIL_FILES}.
 */
async function findJilFiles(repoRoot: string, scanRoot: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (out.length >= MAX_JIL_FILES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= MAX_JIL_FILES) return;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRECTORIES.has(ent.name)) continue;
        await walk(full);
      } else if (ent.isFile() && /\.jil$/i.test(ent.name)) {
        out.push(path.relative(repoRoot, full).replace(/\\/g, '/'));
      }
    }
  }

  await walk(scanRoot);
  return out;
}

/**
 * Collect + parse every `.jil` file under `repoRoot` (optionally scoped to a
 * `subfolder`). Returns a map of repo-relative path -> {@link JilTopology}.
 * Never throws; a per-file failure is logged and skipped.
 */
export async function collectJilTopologies(
  repoRoot: string,
  subfolder?: string,
): Promise<Map<string, JilTopology>> {
  const result = new Map<string, JilTopology>();
  const scanRoot = subfolder ? path.join(repoRoot, subfolder) : repoRoot;

  let relPaths: string[];
  try {
    relPaths = await findJilFiles(repoRoot, scanRoot);
  } catch (err) {
    console.warn(
      `[JilCollector] walk failed under "${scanRoot}": ${err instanceof Error ? err.message : String(err)}`,
    );
    return result;
  }

  for (const relPath of relPaths) {
    const abs = path.join(repoRoot, relPath);
    try {
      const stat = await fs.stat(abs);
      if (stat.size > MAX_JIL_BYTES) {
        console.warn(`[JilCollector] skipping oversize .jil (${stat.size} bytes): ${relPath}`);
        continue;
      }
      const text = await fs.readFile(abs, 'utf-8');
      const topology = parseJil(text);
      if (topology.jobs.length > 0) {
        result.set(relPath, topology);
      }
    } catch (err) {
      console.warn(
        `[JilCollector] read/parse failed for "${relPath}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return result;
}
