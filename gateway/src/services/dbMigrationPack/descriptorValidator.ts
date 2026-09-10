/**
 * Draft-vs-descriptor header validation (Stored Proc & Function Behaviour
 * Program, Spec 2, 2026-09-09) — deterministic, regex-level.
 *
 * The translator is told the exact header the calling convention requires;
 * this validator checks the draft actually emitted it: function name,
 * argument names + order (IN then OUT as declared), OUT arguments,
 * refcursor OUT arguments (`rich`), and the RETURNS clause form per shape.
 * Types are checked loosely (presence, not spelling) — the apply step and
 * the reconcile catch type errors with the engine's own verdict.
 */

import type { RoutineDescriptor } from './routineInvocationDescriptor';

export interface DescriptorCheck {
  ok: boolean;
  violations: string[];
}

interface ParsedHeader {
  name: string;
  args: Array<{ mode: 'in' | 'out' | 'inout'; name: string; type: string }>;
  returns: string | null;
}

/** Parse the first CREATE [OR REPLACE] FUNCTION header in a draft (exported for tests). */
export function parseFunctionHeader(draftSql: string): ParsedHeader | null {
  const m = /create\s+(?:or\s+replace\s+)?function\s+([A-Za-z0-9_."]+)\s*\(([\s\S]*?)\)\s*(?:returns\s+([\s\S]*?))?\s*(?=\bas\b|\blanguage\b|\$\$|\bbegin\b|;)/i.exec(
    draftSql
  );
  if (!m) return null;
  const rawName = m[1].replace(/"/g, '');
  const name = (rawName.split('.').pop() ?? rawName).toLowerCase();
  const args: ParsedHeader['args'] = [];
  const argText = m[2].trim();
  if (argText.length > 0) {
    let depth = 0;
    let cur = '';
    const parts: string[] = [];
    for (const ch of argText) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        parts.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    if (cur.trim().length > 0) parts.push(cur);
    for (const p of parts) {
      const tokens = p.trim().replace(/\s+/g, ' ').split(' ');
      let mode: 'in' | 'out' | 'inout' = 'in';
      let idx = 0;
      const first = tokens[0]?.toLowerCase();
      if (first === 'in' || first === 'out' || first === 'inout') {
        mode = first;
        idx = 1;
      }
      const argName = (tokens[idx] ?? '').replace(/"/g, '').toLowerCase();
      const type = tokens.slice(idx + 1).join(' ').replace(/\s+default\s+[\s\S]*$/i, '').trim();
      if (argName) args.push({ mode, name: argName, type });
    }
  }
  const returns = m[3] ? m[3].replace(/\s+/g, ' ').trim() : null;
  return { name, args, returns };
}

export function validateDraftAgainstDescriptor(draftSql: string, descriptor: RoutineDescriptor): DescriptorCheck {
  const violations: string[] = [];
  const header = parseFunctionHeader(draftSql);
  if (!header) {
    return { ok: false, violations: ['no CREATE [OR REPLACE] FUNCTION header found in the draft'] };
  }
  if (header.name !== descriptor.pg_function.toLowerCase()) {
    violations.push(`function name must be ${descriptor.pg_function} (found ${header.name})`);
  }
  const expectedIn = descriptor.args.filter((a) => a.direction === 'in').map((a) => a.name.toLowerCase());
  const actualIn = header.args.filter((a) => a.mode === 'in').map((a) => a.name);
  if (expectedIn.join(',') !== actualIn.join(',')) {
    violations.push(`IN arguments must be exactly (${expectedIn.join(', ')}) in that order (found ${actualIn.join(', ') || 'none'})`);
  }
  const expectedOut = [
    ...descriptor.out_params.map((n) => n.toLowerCase()),
    ...(descriptor.return_status_carriage === 'out_param' ? ['return_status'] : []),
    ...descriptor.refcursors.map((n) => n.toLowerCase()),
  ];
  const actualOut = header.args.filter((a) => a.mode !== 'in').map((a) => a.name);
  for (const name of expectedOut) {
    if (!actualOut.includes(name)) violations.push(`missing OUT argument ${name}`);
  }
  for (const name of actualOut) {
    if (!expectedOut.includes(name)) violations.push(`unexpected OUT argument ${name}`);
  }
  const returns = (header.returns ?? '').toLowerCase();
  switch (descriptor.shape) {
    case 'return_status':
      if (!/^(integer|int|int4)\b/.test(returns)) violations.push('RETURNS must be integer (return_status shape)');
      break;
    case 'single_result_set':
      if (!/^(table\s*\(|setof\b)/.test(returns)) violations.push('RETURNS must be TABLE(...) or SETOF (single_result_set shape)');
      break;
    case 'out_params':
    case 'rich':
      if (returns.length > 0 && !/^(record|setof\s+record)\b/.test(returns)) {
        violations.push('RETURNS must be omitted or record when OUT arguments carry the results');
      }
      for (const cur of descriptor.refcursors) {
        const arg = header.args.find((a) => a.name === cur.toLowerCase());
        if (arg && !/refcursor/i.test(arg.type)) violations.push(`OUT argument ${cur} must be refcursor`);
      }
      break;
    default:
      break;
  }
  return { ok: violations.length === 0, violations };
}
