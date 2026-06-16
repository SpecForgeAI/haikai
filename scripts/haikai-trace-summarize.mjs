#!/usr/bin/env node
/**
 * Haikai trace summarizer — see docs/trace-logging.md.
 *
 * Reads the shared trace file and prints a clean, run-grouped block of the
 * [SUMMARY] lines (a regenerated "top summary" on demand, without fighting the
 * append-only, multi-writer live file). Dependency-free.
 *
 *   node scripts/haikai-trace-summarize.mjs [file]
 *   node scripts/haikai-trace-summarize.mjs --detail <session-or-run-or-job-id> [file]
 *
 * Default file: $HAIKAI_TRACE_FILE or ~/.haikai/trace.log
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const argv = process.argv.slice(2);
let file = null;
let detailId = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--detail') detailId = argv[++i];
  else if (!file && !argv[i].startsWith('--')) file = argv[i];
}
file = file || process.env.HAIKAI_TRACE_FILE || join(homedir(), '.haikai', 'trace.log');

let text;
try {
  text = readFileSync(file, 'utf8');
} catch (e) {
  console.error(`Cannot read trace file: ${file}\n  ${e.message}`);
  process.exit(1);
}

const HEADER =
  /^===\s+HAIKAI TRACE\s+run=(\S+)(?:\s+project="([^"]*)")?(?:\s+arch="([^"]*)")?\s+(\S+)\s+===$/;
const LINE = /^(\S+)\s{2,}\[(SUMMARY|detail)\]\s{2,}(\S+)\s{2,}(.*)$/;
const field = (raw, key) => {
  const m = raw.match(new RegExp(`\\b${key}=(?:"([^"]*)"|(\\S+))`));
  return m ? m[1] ?? m[2] : null;
};

// The workflow-spanning id is project (+arch); run/session/job are sub-threads.
const groups = new Map(); // project -> { arch, entries: [{ ts, tier, service, body, raw }] }
const order = [];
function getGroup(project) {
  if (!groups.has(project)) {
    groups.set(project, { arch: null, entries: [] });
    order.push(project);
  }
  return groups.get(project);
}

let ctxProject = '(unattributed)';
let ctxArch = null;
for (const raw of text.split(/\r?\n/)) {
  if (!raw.trim()) continue;
  const h = raw.match(HEADER);
  if (h) {
    if (h[2]) ctxProject = h[2];
    if (h[3]) ctxArch = h[3];
    if (h[2]) {
      const g = getGroup(ctxProject);
      if (ctxArch) g.arch = ctxArch;
    }
    continue;
  }
  const m = raw.match(LINE);
  if (!m) continue;
  const [, ts, tier, service, body] = m;
  // Prefer the line's own project/arch; otherwise inherit the last-seen context.
  const project = field(raw, 'project') ?? ctxProject;
  const arch = field(raw, 'arch') ?? ctxArch;
  ctxProject = project;
  ctxArch = arch;
  const g = getGroup(project);
  if (arch && !g.arch) g.arch = arch;
  g.entries.push({ ts, tier, service, body, raw });
}

const hms = (ts) => (ts.match(/T(\d{2}:\d{2}:\d{2})/)?.[1]) ?? ts;
const matchesId = (raw, id) =>
  raw.includes(`=${id}`) || raw.includes(`="${id}"`) || raw.includes(`"${id}"`);

let printedAny = false;
for (const project of order) {
  const r = groups.get(project);
  let entries = r.entries.filter((e) => e.tier === 'SUMMARY');
  if (detailId) {
    entries = r.entries.filter(
      (e) => e.tier === 'SUMMARY' || (e.tier === 'detail' && matchesId(e.raw, detailId)),
    );
    // When filtering to an id, only show groups that actually touch it.
    if (!r.entries.some((e) => matchesId(e.raw, detailId))) continue;
  }
  if (entries.length === 0) continue;
  printedAny = true;

  const width = Math.min(12, Math.max(7, ...entries.map((e) => e.service.length)));
  const hdr =
    `project="${project}"` + (r.arch ? `  arch="${r.arch}"` : '');
  console.log(`\n=== ${hdr} ===`);
  for (const e of entries.sort((a, b) => a.ts.localeCompare(b.ts))) {
    const marker = e.tier === 'detail' ? '· ' : '';
    console.log(`${hms(e.ts)}  ${e.service.padEnd(width)}  ${marker}${e.body}`);
  }
}

if (!printedAny) {
  console.log(
    detailId
      ? `No trace entries matching id "${detailId}" in ${file}`
      : `No [SUMMARY] entries in ${file}`,
  );
}
