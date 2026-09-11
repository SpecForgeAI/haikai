/**
 * Compensation SQL guard tests (Capture-State Discipline Spec 1). Mirrors the
 * sidecar's MutationSqlGuardTest: the TS layer admits exactly the generator's
 * grammar and refuses everything else, with chaining/comment fragments
 * checked OUTSIDE quoted literal spans.
 */

import {
  assertCompensationBatch,
  checkCompensationStatement,
  stripQuotedLiterals,
} from '../services/compensation/compensationSqlGuard';

describe('checkCompensationStatement', () => {
  it('admits the derived DML forms', () => {
    expect(checkCompensationStatement('DELETE FROM orders WHERE id = 42').allowed).toBe(true);
    expect(
      checkCompensationStatement("UPDATE orders SET name = 'Quarterly', depth = 3 WHERE id = 42")
        .allowed,
    ).toBe(true);
    expect(
      checkCompensationStatement("INSERT INTO orders (id, name) VALUES (42, 'Quarterly')").allowed,
    ).toBe(true);
  });

  it('admits identity toggles and both reseed forms', () => {
    expect(checkCompensationStatement('SET IDENTITY_INSERT orders ON').allowed).toBe(true);
    expect(checkCompensationStatement('SET IDENTITY_INSERT orders OFF').allowed).toBe(true);
    expect(
      checkCompensationStatement("EXEC sp_chgattribute 'orders', 'identity_burn_max', 0, '41'")
        .allowed,
    ).toBe(true);
    expect(
      checkCompensationStatement(
        "SELECT setval(pg_get_serial_sequence('public.orders', 'id'), 41, true)",
      ).allowed,
    ).toBe(true);
  });

  it('admits literals containing chaining/comment fragments', () => {
    expect(
      checkCompensationStatement("UPDATE orders SET note = 'a; b -- c /* d */' WHERE id = 1")
        .allowed,
    ).toBe(true);
    expect(
      checkCompensationStatement("INSERT INTO orders (id, note) VALUES (7, 'it''s; ok -- yes')")
        .allowed,
    ).toBe(true);
  });

  it('refuses DDL, TRUNCATE, bare SELECT and unknown grammar', () => {
    for (const sql of [
      'DROP TABLE orders',
      'TRUNCATE TABLE orders',
      'ALTER TABLE orders ADD c INT',
      'SELECT * FROM orders',
      'MERGE INTO orders USING x ON 1=1',
    ]) {
      expect(checkCompensationStatement(sql).allowed).toBe(false);
    }
  });

  it('refuses chaining and comments outside literals', () => {
    expect(
      checkCompensationStatement('DELETE FROM orders WHERE id = 1; DROP TABLE orders').allowed,
    ).toBe(false);
    expect(checkCompensationStatement('DELETE FROM orders -- all').allowed).toBe(false);
    expect(checkCompensationStatement('DELETE FROM orders /* all */ WHERE id = 1').allowed).toBe(
      false,
    );
  });

  it('refuses unterminated literals and empty statements', () => {
    expect(checkCompensationStatement("UPDATE orders SET a = 'open WHERE id = 1").allowed).toBe(
      false,
    );
    expect(checkCompensationStatement('   ').allowed).toBe(false);
  });
});

describe('assertCompensationBatch', () => {
  it('is fail-closed on the first violation', () => {
    expect(() =>
      assertCompensationBatch(['DELETE FROM orders WHERE id = 1', 'DROP TABLE orders']),
    ).toThrow(/guard refused/);
  });

  it('passes an all-admitted batch', () => {
    expect(() =>
      assertCompensationBatch([
        'SET IDENTITY_INSERT orders ON',
        "INSERT INTO orders (id, name) VALUES (1, 'a')",
        'SET IDENTITY_INSERT orders OFF',
      ]),
    ).not.toThrow();
  });
});

describe('stripQuotedLiterals', () => {
  it('blanks literal spans, quote-doubling aware', () => {
    expect(stripQuotedLiterals("UPDATE t SET a = 'x; --' WHERE b = 'it''s'")).toEqual({
      skeleton: "UPDATE t SET a = '' WHERE b = ''",
      terminated: true,
    });
  });
  it('flags unterminated literals', () => {
    expect(stripQuotedLiterals("UPDATE t SET a = 'open").terminated).toBe(false);
  });
});

describe('SQL Server reseed grammar (second-pair programme, Spec 4)', () => {
  it('admits DBCC CHECKIDENT RESEED (with or without NO_INFOMSGS) and refuses other DBCC forms', () => {
    expect(checkCompensationStatement("DBCC CHECKIDENT ('[dbo].[orders]', RESEED, 41)").allowed).toBe(true);
    expect(checkCompensationStatement("DBCC CHECKIDENT ('dbo.orders', RESEED, 0) WITH NO_INFOMSGS").allowed).toBe(true);
    expect(checkCompensationStatement("DBCC CHECKIDENT ('dbo.orders')").allowed).toBe(false);
    expect(checkCompensationStatement("DBCC CHECKIDENT ('dbo.orders', NORESEED)").allowed).toBe(false);
    expect(checkCompensationStatement('DBCC SHRINKDATABASE (demo)').allowed).toBe(false);
  });
});
