/**
 * Unit tests for `checkPersistenceCoreTech` -- the Persistence-Tier Core Tech
 * classifier (Spec 2026-06-06). Pure logic, no DOM.
 *
 * The caller has already established the parent application component is
 * "Persistence Tier"; this helper classifies the Core Tech text into one of:
 *   ok | unsupported-db | code-pack | none.
 */
import { describe, it, expect } from 'vitest';
import { checkPersistenceCoreTech } from './coreTechPersistenceCheck';

describe('checkPersistenceCoreTech', () => {
  describe('supported databases (PostgreSQL / Sybase / SQL Server)', () => {
    it('recognises PostgreSQL (with a version) as available', () => {
      const r = checkPersistenceCoreTech('PostgreSQL 16', false);
      expect(r.status).toBe('ok');
      expect(r.database).toBe('PostgreSQL');
      expect(r.message).toContain('PostgreSQL database scan pack available');
    });

    it('recognises the "postgres" and "pg" shorthands', () => {
      expect(checkPersistenceCoreTech('postgres', false).database).toBe('PostgreSQL');
      expect(checkPersistenceCoreTech('PG 14', false).database).toBe('PostgreSQL');
    });

    it('recognises Sybase (and SAP ASE)', () => {
      expect(checkPersistenceCoreTech('Sybase ASE 16', false).database).toBe('Sybase');
      expect(checkPersistenceCoreTech('SAP ASE', false).database).toBe('Sybase');
    });

    // SQL Server 16 -> PostgreSQL 18 pair programme, Spec 2 (2026-09-11):
    // SQL Server moved from OTHER_DATABASES ("no scan pack available") into
    // SUPPORTED_DATABASES the moment the `mssql` pack was registered. This is
    // the pin that keeps the two lists in lockstep with the pack registry.
    it('recognises SQL Server, its abbreviations, and the T-SQL dialect name', () => {
      for (const text of [
        'SQL Server 2022',
        'Microsoft SQL Server',
        'MSSQL',
        'MS SQL Server',
        'T-SQL',
        'tsql',
      ]) {
        const r = checkPersistenceCoreTech(text, false);
        expect(r.status).toBe('ok');
        expect(r.database).toBe('SQL Server');
      }
    });

    it('offers SQL Server the scan pack instead of the no-pack message', () => {
      const r = checkPersistenceCoreTech('Microsoft SQL Server', false);
      expect(r.status).not.toBe('unsupported-db');
      expect(r.message).toContain('SQL Server database scan pack available');
    });

    it('is case-insensitive', () => {
      expect(checkPersistenceCoreTech('SYBASE', false).status).toBe('ok');
      expect(checkPersistenceCoreTech('postgresql', false).status).toBe('ok');
    });

    it('lets a supported database win even if a code pack also resolved', () => {
      // A spurious code-pack resolution must not override a named, scannable DB.
      const r = checkPersistenceCoreTech('PostgreSQL', true);
      expect(r.status).toBe('ok');
      expect(r.database).toBe('PostgreSQL');
    });
  });

  describe('unsupported databases', () => {
    it('reports no pack available for Oracle', () => {
      const r = checkPersistenceCoreTech('Oracle 19c', false);
      expect(r.status).toBe('unsupported-db');
      expect(r.database).toBe('Oracle');
      expect(r.message).toBe('No database scan pack available for Oracle.');
    });

    it('names the specific database in the message', () => {
      expect(checkPersistenceCoreTech('MySQL 8', false).message).toBe(
        'No database scan pack available for MySQL.',
      );
      expect(checkPersistenceCoreTech('MongoDB', false).message).toBe(
        'No database scan pack available for MongoDB.',
      );
      expect(checkPersistenceCoreTech('Db2', false).message).toBe(
        'No database scan pack available for Db2.',
      );
    });

    it('flags an unsupported DB even when no code pack resolved', () => {
      expect(checkPersistenceCoreTech('MariaDB', false).status).toBe('unsupported-db');
    });
  });

  describe('code-related tech on a Persistence-Tier service', () => {
    it('flags a resolved code pack with the "please change" message', () => {
      const r = checkPersistenceCoreTech('Java, Spring', true);
      expect(r.status).toBe('code-pack');
      expect(r.message).toContain("set to 'Persistence Tier'");
      expect(r.message).toContain('please change');
    });

    it('does NOT flag code text until it has actually resolved to a pack', () => {
      // Before the LLM resolve completes there is no code pack yet -> no message.
      expect(checkPersistenceCoreTech('Java, Spring', false).status).toBe('none');
    });
  });

  describe('word-boundary safety + empties', () => {
    it('does not match the Sybase "ase" token inside the word "database"', () => {
      // "database layer" must not be mistaken for Sybase.
      expect(checkPersistenceCoreTech('database layer', false).status).toBe('none');
    });

    it('returns none for empty / whitespace / null Core Tech', () => {
      expect(checkPersistenceCoreTech('', false).status).toBe('none');
      expect(checkPersistenceCoreTech('   ', false).status).toBe('none');
      expect(checkPersistenceCoreTech(null, false).status).toBe('none');
      expect(checkPersistenceCoreTech(undefined, false).status).toBe('none');
    });

    it('returns none for unrecognised non-database text with no code pack', () => {
      expect(checkPersistenceCoreTech('some bespoke datastore', false).status).toBe('none');
    });
  });
});
