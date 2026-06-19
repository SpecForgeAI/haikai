import { normaliseBodyForAms } from '../services/amsBodyEnvelope';

/**
 * Guards the SINGLE source of truth for AMS body wrapping used by
 * execute_http_request (current-state captures), targetReplayRunner and
 * sequenceReplayRunner (target-state replay captures). AMS types
 * request_body_json / response_body_json as Jackson Map<String,Object>, so a
 * non-object body (HTML/text error page, plain string, top-level array) must be
 * wrapped or the createCapture POST is rejected HTTP 400 (Issue 2).
 */
describe('normaliseBodyForAms', () => {
  it('passes a plain object through unchanged (Map-deserializable already)', () => {
    const obj = { id: 1, name: 'x' };
    expect(normaliseBodyForAms(obj)).toBe(obj);
  });

  it('collapses null / undefined to null', () => {
    expect(normaliseBodyForAms(null)).toBeNull();
    expect(normaliseBodyForAms(undefined)).toBeNull();
  });

  it('wraps an HTML/text string error body (the Tomcat 415/500 case) so AMS accepts it', () => {
    const html = '<html><body><h1>HTTP Status 415</h1></body></html>';
    expect(normaliseBodyForAms(html)).toEqual({ _raw: html, _type: 'string' });
  });

  it('wraps a top-level array with _type:"array"', () => {
    expect(normaliseBodyForAms([1, 2, 3])).toEqual({ _raw: [1, 2, 3], _type: 'array' });
  });

  it('wraps primitive number / boolean bodies', () => {
    expect(normaliseBodyForAms(42)).toEqual({ _raw: 42, _type: 'number' });
    expect(normaliseBodyForAms(true)).toEqual({ _raw: true, _type: 'boolean' });
  });
});
