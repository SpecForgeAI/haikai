/**
 * Autosys `.jil` scheduler adapter (Oracle Nine item 8).
 *
 * The batch plane's ground truth is job -> shell command -> Java main ->
 * proc -> tables; the mains are already internal corpus roots, but WITHOUT
 * the scheduler layer the jobs' cadence (17:00 feed!), box grouping, and
 * ordering conditions were invisible — the quiet-window rule and the batch
 * book-of-work both need them. Vendor-generic (any estate using Autosys),
 * silent no-op when no `.jil` files exist.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface JilJob {
  jobName: string;
  jobType: string | null;
  command: string | null;
  boxName: string | null;
  condition: string | null;
  startTimes: string | null;
  daysOfWeek: string | null;
  watchFile: string | null;
  sourcePath: string;
}

export interface ResolvedJilJob extends JilJob {
  /** Fully-qualified main class the command chain resolves to, or null. */
  resolvedMainFqn: string | null;
  /** How it resolved: direct `java X` in the command, or via the named
   *  shell script's content. */
  resolvedVia: 'command' | 'script' | null;
}

const SKIP_DIRS = new Set(['target', 'build', '.git', 'node_modules']);

function walkFilesByExt(rootDir: string, ext: string): string[] {
  const out: string[] = [];
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
      } else if (e.name.toLowerCase().endsWith(ext)) {
        out.push(full);
      }
    }
  }
  out.sort();
  return out;
}

const FIELD_RE = /^\s*([a-z_]+)\s*:\s*(.+?)\s*$/;

/** Parse one jil text: `insert_job: NAME   job_type: c` starts a job; the
 *  following `field: value` lines belong to it until the next insert_job. */
export function parseJilText(text: string, sourcePath: string): JilJob[] {
  const jobs: JilJob[] = [];
  let current: JilJob | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\*.*?\*\//g, '').trimEnd();
    const insertMatch = /^\s*insert_job\s*:\s*(\S+)(?:\s+job_type\s*:\s*(\S+))?/.exec(line);
    if (insertMatch) {
      current = {
        jobName: insertMatch[1],
        jobType: insertMatch[2] ?? null,
        command: null,
        boxName: null,
        condition: null,
        startTimes: null,
        daysOfWeek: null,
        watchFile: null,
        sourcePath,
      };
      jobs.push(current);
      continue;
    }
    if (!current) continue;
    const fm = FIELD_RE.exec(line);
    if (!fm) continue;
    const value = fm[2].replace(/^"|"$/g, '');
    switch (fm[1]) {
      case 'job_type':
        current.jobType = value;
        break;
      case 'command':
        current.command = value;
        break;
      case 'box_name':
        current.boxName = value;
        break;
      case 'condition':
        current.condition = value;
        break;
      case 'start_times':
        current.startTimes = value;
        break;
      case 'days_of_week':
        current.daysOfWeek = value;
        break;
      case 'watch_file':
        current.watchFile = value;
        break;
      default:
        break;
    }
  }
  return jobs;
}

export function parseJilFiles(rootDir: string): JilJob[] {
  const out: JilJob[] = [];
  for (const file of walkFilesByExt(rootDir, '.jil')) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(rootDir, file).split(path.sep).join('/');
    out.push(...parseJilText(text, rel));
  }
  return out;
}

const JAVA_CLASS_RE = /\bjava\b[^\n]*?\s((?:[a-z_][a-z0-9_]*\.)+[A-Z]\w+)/;

/**
 * Resolve each command job to a known main class: (a) a direct `java com.x.M`
 * token in the command; (b) the command's script basename found in the repo,
 * whose content names a known main (FQN token or unique simple-name match).
 */
export function resolveJobsToMains(
  jobs: JilJob[],
  rootDir: string,
  knownMainFqns: string[],
): ResolvedJilJob[] {
  const simpleToFqns = new Map<string, string[]>();
  for (const fqn of knownMainFqns) {
    const simple = fqn.includes('.') ? fqn.slice(fqn.lastIndexOf('.') + 1) : fqn;
    const list = simpleToFqns.get(simple) ?? [];
    list.push(fqn);
    simpleToFqns.set(simple, list);
  }
  const shellFiles = walkFilesByExt(rootDir, '.sh');
  const shellByBasename = new Map<string, string[]>();
  for (const file of shellFiles) {
    const base = path.basename(file).toLowerCase();
    const list = shellByBasename.get(base) ?? [];
    list.push(file);
    shellByBasename.set(base, list);
  }
  const resolveFromText = (text: string): string | null => {
    const direct = JAVA_CLASS_RE.exec(text);
    if (direct && knownMainFqns.includes(direct[1])) return direct[1];
    for (const fqn of knownMainFqns) {
      if (text.includes(fqn)) return fqn;
    }
    for (const [simple, fqns] of simpleToFqns) {
      if (fqns.length === 1 && new RegExp(`\\b${simple}\\b`).test(text)) return fqns[0];
    }
    return null;
  };
  return jobs.map((job) => {
    if (job.jobType !== null && job.jobType !== 'c') {
      return { ...job, resolvedMainFqn: null, resolvedVia: null };
    }
    const command = job.command ?? '';
    const direct = resolveFromText(command);
    if (direct) return { ...job, resolvedMainFqn: direct, resolvedVia: 'command' };
    const scriptToken = command
      .split(/\s+/)
      .find((tok) => tok.toLowerCase().endsWith('.sh'));
    if (scriptToken) {
      const base = path.basename(scriptToken).toLowerCase();
      for (const file of shellByBasename.get(base) ?? []) {
        try {
          const text = fs.readFileSync(file, 'utf8');
          const resolved = resolveFromText(text);
          if (resolved) return { ...job, resolvedMainFqn: resolved, resolvedVia: 'script' };
        } catch {
          // unreadable script — keep looking
        }
      }
    }
    return { ...job, resolvedMainFqn: null, resolvedVia: null };
  });
}
