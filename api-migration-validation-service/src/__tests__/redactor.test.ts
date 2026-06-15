import {
  redactHeaders,
  redactJson,
  redactLogString,
  redactUrl,
  REDACTED_PLACEHOLDER,
} from '../services/redactor';

/**
 * Redactor unit tests. Confirms the four redaction surfaces strip the
 * categories of secret called out in the spec:
 *   - bearer tokens (header form + free-form log line)
 *   - basic-auth values (header form)
 *   - custom-header secrets (configurable + default API-key headers)
 *   - DB passwords (Postgres-style DSN string + log line)
 *
 * Spec: 2026-05-15 API Behaviour Baseline Capture Service -- Task Group 4
 * sub-task 4.1.
 */

describe('redactor', () => {
  it('redactHeaders strips Authorization / Bearer tokens', () => {
    const out = redactHeaders({
      Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig',
      'Content-Type': 'application/json',
    });
    expect(out.Authorization).toBe(REDACTED_PLACEHOLDER);
    expect(out['Content-Type']).toBe('application/json');
  });

  it('redactHeaders strips basic-auth Authorization values', () => {
    const out = redactHeaders({
      Authorization: 'Basic dXNlcjpwYXNz',
      Accept: '*/*',
    });
    expect(out.Authorization).toBe(REDACTED_PLACEHOLDER);
    expect(out.Accept).toBe('*/*');
  });

  it('redactHeaders strips default + custom API-key headers', () => {
    const out = redactHeaders(
      {
        'X-Api-Key': 'super-secret',
        'X-Custom-Token': 'also-secret',
        'X-Trace-Id': 'public-trace',
      },
      { extraHeaderNames: ['x-custom-token'] },
    );
    expect(out['X-Api-Key']).toBe(REDACTED_PLACEHOLDER);
    expect(out['X-Custom-Token']).toBe(REDACTED_PLACEHOLDER);
    expect(out['X-Trace-Id']).toBe('public-trace');
  });

  it('redactJson strips secret-named fields recursively', () => {
    const result = redactJson({
      ok: true,
      user: {
        name: 'alice',
        password: 'hunter2',
        meta: {
          apiKey: 'k123',
          accessToken: 'at456',
          public: 'fine',
        },
      },
      tokens: [{ token: 'tt' }, { token: 'uu', other: 'ok' }],
    });
    const out = result as Record<string, unknown>;
    const user = out.user as Record<string, unknown>;
    const meta = user.meta as Record<string, unknown>;
    const tokens = out.tokens as Array<Record<string, unknown>>;
    expect(user.name).toBe('alice');
    expect(user.password).toBe(REDACTED_PLACEHOLDER);
    expect(meta.apiKey).toBe(REDACTED_PLACEHOLDER);
    expect(meta.accessToken).toBe(REDACTED_PLACEHOLDER);
    expect(meta.public).toBe('fine');
    expect(tokens[0].token).toBe(REDACTED_PLACEHOLDER);
    expect(tokens[1].token).toBe(REDACTED_PLACEHOLDER);
    expect(tokens[1].other).toBe('ok');
  });

  it('redactLogString strips bearer + basic + DSN passwords', () => {
    const line =
      'GET /v1/x failed: Authorization: Bearer abcdefghij1234567890 -- conn=postgres://app:s3cr3t@db.example.com:5432/main';
    const safe = redactLogString(line);
    expect(safe).not.toContain('abcdefghij1234567890');
    expect(safe).not.toContain('s3cr3t');
    expect(safe).toContain(REDACTED_PLACEHOLDER);
  });

  it('redactLogString strips X-Api-Key style header lines and querystring secrets', () => {
    const line =
      'logged: X-Api-Key: zyxwvut987 ; called https://api.example.com/v1?token=qrs456&safe=ok';
    const safe = redactLogString(line);
    expect(safe).not.toContain('zyxwvut987');
    expect(safe).not.toContain('qrs456');
    expect(safe).toContain('safe=ok');
  });

  it('redactUrl strips userinfo password and known sensitive query params', () => {
    const safe = redactUrl(
      'https://app:s3cr3t@api.example.com/v1/things?token=abc&id=42',
    );
    expect(safe).not.toContain('s3cr3t');
    expect(safe).not.toContain('abc');
    expect(safe).toContain('id=42');
  });
});
