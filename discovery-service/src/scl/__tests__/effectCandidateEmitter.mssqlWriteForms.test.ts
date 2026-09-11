/**
 * SQL-Server house-style write forms (second-pair programme, Spec 6 §6.5):
 * `MERGE target USING …` without INTO, `MERGE TOP (n) INTO …`, and an INSERT
 * carrying an OUTPUT INSERTED clause all resolve their WRITE table; the ANSI
 * `MERGE INTO` form keeps working.
 */
import { parseWriteTablesFromSql } from '../effectCandidateEmitter';

describe('parseWriteTablesFromSql — SQL Server forms', () => {
  it('MERGE without INTO resolves the target table', () => {
    expect(parseWriteTablesFromSql('MERGE dbo.orders AS t USING staging AS s ON t.id = s.id WHEN MATCHED THEN UPDATE SET a = s.a')).toEqual(['orders']);
  });

  it('MERGE TOP (n) INTO resolves the target table', () => {
    expect(parseWriteTablesFromSql('MERGE TOP (10) INTO orders USING s ON orders.id = s.id WHEN NOT MATCHED THEN INSERT (a) VALUES (s.a)')).toEqual(['orders']);
  });

  it('ANSI MERGE INTO still resolves the target table', () => {
    expect(parseWriteTablesFromSql('MERGE INTO orders USING s ON orders.id = s.id WHEN MATCHED THEN DELETE')).toEqual(['orders']);
  });

  it('INSERT … OUTPUT INSERTED.* resolves the inserted table (never the pseudo-table)', () => {
    const tables = parseWriteTablesFromSql('INSERT INTO orders (a) OUTPUT INSERTED.id VALUES (1)');
    expect(tables).toEqual(['orders']);
    expect(tables.map((t) => t.toLowerCase())).not.toContain('inserted');
  });
});
