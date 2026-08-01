/**
 * Liquibase formatted-SQL + master-changelog parsing for the schema-apply
 * runner (WS2 DB-plane execution chain, 2026-07-31).
 *
 * The DB pack's changesets are Liquibase FORMATTED SQL:
 *
 *   --liquibase formatted sql logicalFilePath:liquibase/changesets/...
 *   --changeset <author>:<id> context:<structural|post-load> splitStatements:false
 *   <sql body until the next --changeset header or EOF>
 *
 * and the master changelog is XML whose ordered `<include file="..."/>` list
 * defines the apply order. This module parses both deterministically — no
 * Liquibase runtime involved (the runner executes the bodies itself and keeps
 * its own applied-changeset log).
 */

export interface ParsedChangeset {
  /** The changeset id (`table-dbo.orders`, `schemas`, `foreign-keys`, ...). */
  id: string;
  /** The declared author (informational). */
  author: string;
  /** The declared context, or null when the header carries none. */
  context: string | null;
  /** The SQL body (verbatim lines between this header and the next). */
  body: string;
  /** The pack-relative file the changeset came from. */
  filePath: string;
}

const CHANGESET_HEADER = /^--changeset\s+([^:\s]+):(\S+)(.*)$/;
const CONTEXT_ATTR = /(?:^|\s)context:(\S+)/;

/**
 * Ordered include paths from the master changelog XML, resolved relative to
 * the master's own directory (`relativeToChangelogFile` semantics — the only
 * form the pack generator emits).
 */
export function parseMasterIncludes(masterXml: string, masterPath: string): string[] {
  const cleanMaster = normalisePackPath(masterPath);
  const masterDir = cleanMaster.includes('/')
    ? cleanMaster.slice(0, cleanMaster.lastIndexOf('/') + 1)
    : '';
  const includes: string[] = [];
  const re = /<include\s+[^>]*?file="([^"]+)"[^>]*?\/>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(masterXml)) !== null) {
    includes.push(normalisePackPath(masterDir + match[1]));
  }
  return includes;
}

/**
 * Canonical pack-path normalisation (2026-08-01): backslashes -> forward
 * slashes, then collapse `.` / `..` / empty segments. Shared by the include
 * resolver AND the apply-plan file keying — the two previously used
 * DIFFERENT partial normalisers (one fixed slashes, the other collapsed
 * segments), so a path needing both fixes keyed differently on each side
 * and the include lookup missed with a spurious "not among the posted
 * files" issue.
 */
export function normalisePackPath(p: string): string {
  const out: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

/** Parse one formatted-SQL file into its ordered changesets. */
export function parseFormattedSql(filePath: string, text: string): ParsedChangeset[] {
  const changesets: ParsedChangeset[] = [];
  let current: ParsedChangeset | null = null;
  const bodyLines: string[] = [];

  const flush = () => {
    if (current) {
      current.body = bodyLines.join('\n').trim();
      changesets.push(current);
    }
    bodyLines.length = 0;
  };

  for (const line of text.split(/\r?\n/)) {
    const header = CHANGESET_HEADER.exec(line);
    if (header) {
      flush();
      const attrs = header[3] ?? '';
      const context = CONTEXT_ATTR.exec(attrs);
      current = {
        id: header[2],
        author: header[1],
        context: context ? context[1] : null,
        body: '',
        filePath,
      };
      continue;
    }
    if (current) bodyLines.push(line);
  }
  flush();
  return changesets;
}
