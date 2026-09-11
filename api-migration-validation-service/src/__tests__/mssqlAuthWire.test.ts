/**
 * parseMssqlAuthWire accepts every wire spelling the frontend / gateway /
 * discovery emit (snake_case, camelCase, and the scan-config `scheme` form)
 * and defaults the way the ruling requires (encrypt ON, trust OFF, SQL login).
 */
import { parseMssqlAuthWire } from '../types/db';

test('snake_case and camelCase forms parse identically', () => {
  const a = parseMssqlAuthWire({ auth_scheme: 'ntlm', domain: 'CORP', encrypt: false, trust_server_certificate: true, instance_name: 'INST' });
  const b = parseMssqlAuthWire({ authScheme: 'ntlm', domain: 'CORP', encrypt: false, trustServerCertificate: true, instanceName: 'INST' });
  expect(a).toEqual({ authScheme: 'ntlm', domain: 'CORP', encrypt: false, trustServerCertificate: true, instanceName: 'INST' });
  expect(b).toEqual(a);
});

test('the discovery scan-config form (scheme) parses too', () => {
  expect(parseMssqlAuthWire({ scheme: 'ntlm', domain: 'CORP', encrypt: true, trustServerCertificate: false, instanceName: null })).toEqual({
    authScheme: 'ntlm', domain: 'CORP', encrypt: true, trustServerCertificate: false, instanceName: null,
  });
});

test('defaults: sql login, encrypt on, trust off; blanks become null; junk is null', () => {
  expect(parseMssqlAuthWire({})).toEqual({ authScheme: 'sql', domain: null, encrypt: true, trustServerCertificate: false, instanceName: null });
  expect(parseMssqlAuthWire({ scheme: 'bogus', domain: '  ', instance_name: '' })).toEqual({ authScheme: 'sql', domain: null, encrypt: true, trustServerCertificate: false, instanceName: null });
  expect(parseMssqlAuthWire(null)).toBeNull();
  expect(parseMssqlAuthWire('x')).toBeNull();
});
