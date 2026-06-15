/**
 * Tests for the shared snippet-redaction utility (Spec 2026-05-16 Wire
 * Java + Spring + Maven Findings -- Task Group 1, sub-task 1.1).
 *
 * Extended 2026-05-29 (DB Structural Fidelity, Group B) with the full-body
 * path: `redactFullBody` scrubs FULL bodies and stamps `redacted` / `truncated`
 * while `redactSnippet` keeps its EXACT 200-char-truncate behaviour for the
 * code-pack scanners + DB-pack profilers.
 *
 * Extended 2026-06-11 (DB Object Translation Drafts -- Task Group 1) with the
 * TARGETED literal scrub on the full-body path: ordinary string literals now
 * survive verbatim, secret-named assignment targets are still scrubbed, and
 * the result carries the `literal_policy: targeted_v2` marker. The snippet
 * path keeps the blanket literal collapse byte-identically.
 *
 * Coverage scope:
 *  - Truncates at 200 chars by default (redactSnippet -- UNCHANGED).
 *  - Replaces both double- and single-quoted string literals with `?`.
 *  - Masks secret-bearing query params and property-file forms for the
 *    full keyword list (password/pwd/secret/token/api_key/api-key).
 *  - Drops Authorization: Basic <token> header content.
 *  - Order of operations is preserved.
 *  - redactFullBody over a FULL body scrubs credentials / connection strings /
 *    API keys and stamps `redacted: true`.
 *  - A >64KB body is capped + stamps `truncated: true`; a small clean body
 *    stamps neither.
 *  - Targeted scrub (TG1 2026-06-11): ordinary literals verbatim; secret-named
 *    targets scrubbed; steps 1-2 + cap unchanged; literal_policy marker;
 *    redactSnippet byte-identical.
 */

import {
  redactSnippet,
  redactFullBody,
  DEFAULT_SNIPPET_MAX_LEN,
  FULL_BODY_MAX_BYTES,
  FULL_BODY_LITERAL_POLICY,
} from '../utils/snippetRedaction';

describe('snippetRedaction.redactSnippet', () => {
  it('truncates at 200 chars when input exceeds the default cap', () => {
    const longText = 'x'.repeat(250);
    const out = redactSnippet(longText);
    expect(out.length).toBe(DEFAULT_SNIPPET_MAX_LEN);
    expect(out.length).toBe(200);
  });

  it('replaces both double- and single-quoted string literals with `?`', () => {
    const input = `String greeting = "Hello, " + 'World' + "!";`;
    const out = redactSnippet(input);
    // Both literals collapse to `?`. The structural characters between them
    // (+, whitespace, semicolons) are preserved verbatim.
    expect(out).toContain('?');
    expect(out).not.toContain('Hello');
    expect(out).not.toContain('World');
    // Three literals replaced -> at least three `?`s.
    expect((out.match(/\?/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('masks values of password / pwd / secret / token / api_key / api-key', () => {
    const inputs = [
      'jdbc:postgres://host?user=foo&password=hunter2',
      'spring.datasource.pwd=topsecret',
      'session_secret=DEADBEEF; path=/',
      'token=abc.def.ghi&scope=read',
      'http://example.com/?api_key=AKIAEXAMPLE',
      'X-Api-Key Header config: api-key=longvaluehere',
    ];
    for (const i of inputs) {
      const out = redactSnippet(i);
      // The redacted sentinel must appear.
      expect(out).toContain('<REDACTED>');
      // The original secret value must NOT survive verbatim.
      expect(out).not.toContain('hunter2');
      expect(out).not.toContain('topsecret');
      expect(out).not.toContain('DEADBEEF');
      expect(out).not.toContain('abc.def.ghi');
      expect(out).not.toContain('AKIAEXAMPLE');
      expect(out).not.toContain('longvaluehere');
    }
  });

  it('drops Authorization: Basic <token> header content', () => {
    const input = `GET /resource HTTP/1.1\r\nAuthorization: Basic ZGVtbzpwQDU1dzByZA==\r\nAccept: */*`;
    const out = redactSnippet(input);
    expect(out).toContain('Authorization: Basic <REDACTED>');
    expect(out).not.toContain('ZGVtbzpwQDU1dzByZA');
  });

  it('preserves the redaction sentinel through literal replacement (order of ops)', () => {
    const input = `String connectionString = "jdbc://h?password=hunter2";`;
    const out = redactSnippet(input);
    expect(out).not.toContain('hunter2');
  });
});

describe('snippetRedaction.redactFullBody (Spec 2026-05-29)', () => {
  it('scrubs embedded credentials / connection strings / API keys over a FULL body and stamps redacted=true', () => {
    const body = [
      'CREATE PROCEDURE sync_to_remote AS',
      'BEGIN',
      "  DECLARE @conn VARCHAR(400) = 'postgres://svc:s3cr3tP@ss@remote-host:5432/db';",
      '  -- pull an api token from config',
      '  SET @cfg = api_key=AKIAABCDEFGHIJKLMNOP;',
      '  EXEC sp_call_remote @conn, @cfg;',
      'END',
    ].join('\n');

    const out = redactFullBody(body);
    // A secret-bearing rule fired -> redacted flag set.
    expect(out.redacted).toBe(true);
    expect(out.truncated).toBe(false);
    // None of the verbatim secret material survives.
    expect(out.body).not.toContain('s3cr3tP@ss');
    expect(out.body).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(out.body).toContain('<REDACTED>');
    // But the procedural SHAPE is preserved (not truncated to 200, full body).
    expect(out.body).toContain('CREATE PROCEDURE sync_to_remote');
    expect(out.body).toContain('EXEC sp_call_remote');
  });

  it('size-caps a >64KB body and stamps truncated=true', () => {
    const huge = 'SELECT 1;\n'.repeat(10000); // ~100KB, no secrets
    expect(huge.length).toBeGreaterThan(FULL_BODY_MAX_BYTES);
    const out = redactFullBody(huge);
    expect(out.truncated).toBe(true);
    expect(out.redacted).toBe(false);
    expect(Buffer.byteLength(out.body, 'utf8')).toBeLessThanOrEqual(FULL_BODY_MAX_BYTES);
  });

  it('stamps neither flag for a small clean body and keeps it verbatim', () => {
    const clean = 'CREATE VIEW v_active AS SELECT id, name FROM users WHERE active;';
    const out = redactFullBody(clean);
    expect(out.redacted).toBe(false);
    expect(out.truncated).toBe(false);
    // No quoted literals + no secrets -> body unchanged.
    expect(out.body).toBe(clean);
  });

  it('does NOT re-truncate a long clean body at 200 (the de-cap requirement)', () => {
    const longBody = 'BEGIN\n' + 'SELECT col FROM tbl;\n'.repeat(50) + 'END';
    expect(longBody.length).toBeGreaterThan(200);
    const out = redactFullBody(longBody);
    expect(out.truncated).toBe(false);
    expect(out.body.length).toBeGreaterThan(200);
  });
});

describe('snippetRedaction.redactFullBody targeted literal scrub (Spec 2026-06-11, TG1)', () => {
  it('(a) preserves ordinary string literals verbatim in a full proc body', () => {
    const body = [
      'CREATE PROCEDURE update_orders AS',
      'BEGIN',
      "  PRINT 'starting batch'",
      "  UPDATE orders SET label = 'priority' WHERE status = 'ACTIVE'",
      "  IF @region = 'EMEA' RETURN",
      'END',
    ].join('\n');
    const out = redactFullBody(body);
    // The blanket literal collapse is GONE on the full-body path: every
    // ordinary literal survives byte-for-byte.
    expect(out.body).toBe(body);
    expect(out.redacted).toBe(false);
    expect(out.truncated).toBe(false);
  });

  it('(b) scrubs literals assigned to secret-named targets, case-insensitive, across all three forms', () => {
    const body = [
      "SET @Password = 'hunter2'", // variable assignment
      "UPDATE users SET pwd_column = 'p455w0rd', name = 'Alice'", // column assignment
      "DECLARE @api_TOKEN VARCHAR(64) = 'tok_live_abc123'", // declare-with-default
      "IF @user_credential = 'letmein' RETURN",
      "SELECT * FROM t WHERE secret_key = 'shhh'",
    ].join('\n');
    const out = redactFullBody(body);
    // None of the secret values survive...
    expect(out.body).not.toContain('hunter2');
    expect(out.body).not.toContain('p455w0rd');
    expect(out.body).not.toContain('tok_live_abc123');
    expect(out.body).not.toContain('letmein');
    expect(out.body).not.toContain('shhh');
    // ...the targeted scrub IS a secret signal...
    expect(out.redacted).toBe(true);
    // ...and the NON-secret literal on the same statement survives verbatim.
    expect(out.body).toContain("name = 'Alice'");
  });

  it('(c) steps 1-2 still fire on the full-body path: key=value, JDBC/URI credentials and PEM blocks', () => {
    const body = [
      'CREATE PROCEDURE sync AS BEGIN',
      '  SET @cfg = api_key=AKIAABCDEFGHIJKLMNOP;',
      "  DECLARE @conn VARCHAR(200) = 'postgres://svc:s3cr3tP@remote:5432/db';",
      '  -----BEGIN RSA PRIVATE KEY-----',
      '  MIIEpAIBAAKCAQEA7',
      '  -----END RSA PRIVATE KEY-----',
      'END',
    ].join('\n');
    const out = redactFullBody(body);
    expect(out.redacted).toBe(true);
    expect(out.body).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(out.body).not.toContain('s3cr3tP');
    expect(out.body).not.toContain('MIIEpAIBAAKCAQEA7');
    expect(out.body).toContain('<REDACTED>');
  });

  it('(c) the 64KB cap still sets truncated=true with ordinary literals preserved up to the cap', () => {
    const huge = "SELECT col FROM tbl WHERE status = 'ACTIVE';\n".repeat(3000); // > 64KB
    expect(Buffer.byteLength(huge, 'utf8')).toBeGreaterThan(FULL_BODY_MAX_BYTES);
    const out = redactFullBody(huge);
    expect(out.truncated).toBe(true);
    expect(out.redacted).toBe(false);
    expect(Buffer.byteLength(out.body, 'utf8')).toBeLessThanOrEqual(FULL_BODY_MAX_BYTES);
    expect(out.body).toContain("status = 'ACTIVE'");
  });

  it('(d) every full-body result carries the literal_policy: targeted_v2 marker (legacy detection is by ABSENCE)', () => {
    expect(FULL_BODY_LITERAL_POLICY).toBe('targeted_v2');
    expect(redactFullBody("SELECT 'x'").literal_policy).toBe('targeted_v2');
    expect(redactFullBody('').literal_policy).toBe('targeted_v2');
    expect(redactFullBody(null).literal_policy).toBe('targeted_v2');
  });

  it('(e) redactSnippet output is byte-identical to its historical behaviour (blanket collapse retained)', () => {
    // Exact historical outputs -- the code-pack scanners + DB-pack profilers
    // depend on these shapes; the full-body change must NOT leak here.
    expect(redactSnippet(`WHERE status = 'ACTIVE' AND name = "Bob"`)).toBe(
      'WHERE status = ? AND name = ?',
    );
    expect(redactSnippet(`password='supersecret' AND name = 'Alice'`)).toBe(
      'password=<REDACTED>? AND name = ?',
    );
    expect(redactSnippet('x'.repeat(250)).length).toBe(DEFAULT_SNIPPET_MAX_LEN);
  });
});
