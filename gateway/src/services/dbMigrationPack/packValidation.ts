/**
 * Generation-time runnable-pack validation (WS3 P0, 2026-07-31).
 *
 * The live 2026-07-30 run shipped a pack that could not parse at all: the
 * master changelog carried `--` inside XML comments (illegal XML), changeset
 * ids contained `--` (breaks Liquibase's formatted-SQL parser), and the
 * changelog included a `050-translations.sql` that was never generated. All
 * three were only discovered at APPLY time, on the target machine. This gate
 * enforces the runnable-pack invariants at GENERATION time — a pack that
 * fails is never persisted as complete.
 *
 * The same invariants are re-checked downstream (IVS run assembly validates
 * the overlaid files on disk; the AMVS schema-apply route refuses unresolved
 * includes) — defence in depth, with THIS gate as the earliest and loudest.
 *
 * NO LLM — pure deterministic code.
 */

/**
 * Accepts BOTH pack-file shapes: the generation-side camelCase `PackFile`
 * (`filePath`) and the AMS-wire snake_case row (`file_path`).
 */
export interface ValidatablePackFile {
  file_path?: string;
  filePath?: string;
  content: string;
}

function pathOf(f: ValidatablePackFile): string {
  return f.file_path ?? f.filePath ?? '';
}

const CHANGESET_HEADER_RE = /^--changeset\s+([^:\s]+):(\S+)/gm;
const SAFE_CHANGESET_ID_RE = /^[A-Za-z0-9._-]+$/;
const XML_COMMENT_RE = /<!--([\s\S]*?)-->/g;
const INCLUDE_RE = /<include\s+[^>]*?file="([^"]+)"[^>]*?\/>/g;

/** Collapse `a/./b` + `a/x/../b` (pure string normalisation). */
function normalisePath(p: string): string {
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

/**
 * Validate the assembled pack file set. Returns the list of problems —
 * empty means the pack is structurally runnable.
 */
export function validatePackFiles(files: ValidatablePackFile[]): string[] {
  const problems: string[] = [];
  const byPath = new Map(files.map((f) => [normalisePath(pathOf(f)), f]));

  const master = files.find((f) => pathOf(f).endsWith('db.changelog-master.xml'));
  if (!master) {
    problems.push('pack has no db.changelog-master.xml (liquibase master changelog)');
  } else {
    const masterPath = pathOf(master);
    // 1) XML comments must never contain a double-dash (illegal XML).
    let comment: RegExpExecArray | null;
    XML_COMMENT_RE.lastIndex = 0;
    while ((comment = XML_COMMENT_RE.exec(master.content)) !== null) {
      if (comment[1].includes('--')) {
        problems.push(
          `${masterPath}: XML comment contains '--' (illegal XML): ` +
            `"${comment[1].trim().slice(0, 80)}"`
        );
      }
    }
    // 2) Every include must resolve to a generated file (relative to the
    //    master's own directory — relativeToChangelogFile semantics).
    const masterDir = masterPath.includes('/')
      ? masterPath.slice(0, masterPath.lastIndexOf('/') + 1)
      : '';
    let include: RegExpExecArray | null;
    INCLUDE_RE.lastIndex = 0;
    while ((include = INCLUDE_RE.exec(master.content)) !== null) {
      const resolved = normalisePath(masterDir + include[1]);
      if (!byPath.has(resolved)) {
        problems.push(
          `${masterPath}: dangling include '${include[1]}' — no generated file at '${resolved}'`
        );
      }
    }
  }

  // 3) Changeset ids must be parser-safe in every formatted-SQL file.
  for (const f of files) {
    if (!pathOf(f).endsWith('.sql')) continue;
    let header: RegExpExecArray | null;
    CHANGESET_HEADER_RE.lastIndex = 0;
    while ((header = CHANGESET_HEADER_RE.exec(f.content)) !== null) {
      const id = header[2];
      if (id.includes('--') || !SAFE_CHANGESET_ID_RE.test(id)) {
        problems.push(
          `${pathOf(f)}: changeset id '${id}' is not parser-safe ` +
            `(charset [A-Za-z0-9._-]; '--' opens a SQL comment inside the header)`
        );
      }
    }
  }

  // 4) Per-schema RELATION-namespace uniqueness (2026-08-06, the live
  //    `relation "hir_book_ak1" already exists` schema-apply halt): Postgres
  //    backs PK/UNIQUE constraints with indexes, and indexes share ONE
  //    per-schema namespace with tables and other indexes. Sybase scopes
  //    these names per table, so source-verbatim emission collides on copied
  //    tables (temp_*, load_*). The generator renames colliders
  //    deterministically; this check is the independent backstop — a pack
  //    that would fail its first clean apply FAILS generation instead.
  //    FK/CHECK constraint names are exempt: pg_constraint scopes them per
  //    table, like Sybase.
  const relationOwners = new Map<string, string>(); // "schema\0name" -> declaring site
  const claimRelation = (
    schema: string,
    name: string,
    site: string
  ): void => {
    const k = `${schema}\0${name}`;
    const owner = relationOwners.get(k);
    if (owner === undefined) {
      relationOwners.set(k, site);
      return;
    }
    problems.push(
      `schema "${schema}": relation name "${name}" is declared by both ${owner} ` +
        `and ${site} — Postgres scopes table/PK/UNIQUE/index names per SCHEMA ` +
        `(one relation namespace), so the second CREATE fails ` +
        `'relation "${name}" already exists' at schema-apply`
    );
  };
  const CREATE_TABLE_RE = /CREATE TABLE "((?:[^"]|"")+)"\."((?:[^"]|"")+)"\s*\(([\s\S]*?)\n\);/g;
  const TABLE_CONSTRAINT_RE = /CONSTRAINT "((?:[^"]|"")+)"\s+(PRIMARY KEY|UNIQUE)/g;
  const CREATE_INDEX_RE = /CREATE (?:UNIQUE )?INDEX "((?:[^"]|"")+)" ON "((?:[^"]|"")+)"\./g;
  const unq = (s: string): string => s.replace(/""/g, '"');
  for (const f of files) {
    if (!pathOf(f).endsWith('.sql')) continue;
    let tbl: RegExpExecArray | null;
    CREATE_TABLE_RE.lastIndex = 0;
    while ((tbl = CREATE_TABLE_RE.exec(f.content)) !== null) {
      const schema = unq(tbl[1]);
      const table = unq(tbl[2]);
      claimRelation(schema, table, `table ${schema}.${table} (${pathOf(f)})`);
      let con: RegExpExecArray | null;
      TABLE_CONSTRAINT_RE.lastIndex = 0;
      while ((con = TABLE_CONSTRAINT_RE.exec(tbl[3])) !== null) {
        claimRelation(
          schema,
          unq(con[1]),
          `${con[2] === 'PRIMARY KEY' ? 'PK' : 'UNIQUE'} constraint on ${schema}.${table} (${pathOf(f)})`
        );
      }
    }
    let idx: RegExpExecArray | null;
    CREATE_INDEX_RE.lastIndex = 0;
    while ((idx = CREATE_INDEX_RE.exec(f.content)) !== null) {
      claimRelation(unq(idx[2]), unq(idx[1]), `index on schema ${unq(idx[2])} (${pathOf(f)})`);
    }
  }

  // 5) Every JSON pack file parses and carries no BOM.
  for (const f of files) {
    if (!pathOf(f).endsWith('.json')) continue;
    if (f.content.charCodeAt(0) === 0xfeff) {
      problems.push(`${pathOf(f)}: starts with a BOM (pack JSON writers must be BOM-free)`);
    }
    try {
      JSON.parse(f.content.replace(/^﻿/, ''));
    } catch (err) {
      problems.push(
        `${pathOf(f)}: not valid JSON (${err instanceof Error ? err.message.slice(0, 120) : 'parse error'})`
      );
    }
  }

  return problems;
}

/** Throwing wrapper — the generation-side gate. */
export function assertPackFilesValid(files: ValidatablePackFile[], stage: string): void {
  const problems = validatePackFiles(files);
  if (problems.length > 0) {
    throw new Error(
      `DB migration pack failed the runnable-pack validation at ${stage} ` +
        `(${problems.length} problem(s)) — the pack was NOT persisted as complete:\n- ` +
        problems.join('\n- ')
    );
  }
}
