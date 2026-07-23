/**
 * XML-body redaction (Spec 2026-07-23, XML2).
 *
 * Pre-fix, `redactJson` returned non-object values verbatim, so an XML request
 * or response body (a STRING — REST-XML or SOAP) persisted secrets in the
 * CLEAR. Pins: element + attribute masking, namespace tolerance, name
 * boundaries, non-markup strings untouched, and the redactJson string route.
 */
import {
  redactJson,
  redactXmlString,
  REDACTED_PLACEHOLDER,
} from '../services/redactor';

describe('redactXmlString', () => {
  it('masks sensitive element content, keeping tags + other elements', () => {
    const xml = '<login><username>gary</username><password>hunter2</password></login>';
    expect(redactXmlString(xml)).toBe(
      `<login><username>gary</username><password>${REDACTED_PLACEHOLDER}</password></login>`,
    );
  });

  it('is namespace-prefix tolerant and case-insensitive (SOAP WS-Security shape)', () => {
    const soap =
      '<soapenv:Envelope><wsse:Password Type="pwtext">s3cret</wsse:Password>' +
      '<wsse:Username>gary</wsse:Username></soapenv:Envelope>';
    const out = redactXmlString(soap);
    expect(out).toContain(`<wsse:Password Type="pwtext">${REDACTED_PLACEHOLDER}</wsse:Password>`);
    expect(out).toContain('<wsse:Username>gary</wsse:Username>');
  });

  it('masks double- and single-quoted attribute values', () => {
    expect(redactXmlString('<call token="abc123" id="7"/>')).toBe(
      `<call token="${REDACTED_PLACEHOLDER}" id="7"/>`,
    );
    expect(redactXmlString("<call apikey='k-1'/>")).toBe(
      `<call apikey='${REDACTED_PLACEHOLDER}'/>`,
    );
  });

  it('bounds names: auth rules never touch <author> or coauth=', () => {
    const xml = '<author>jane</author><doc coauth="jim"/>';
    expect(redactXmlString(xml)).toBe(xml);
  });

  it('handles multiline element content', () => {
    const xml = '<secret>\nline1\nline2\n</secret>';
    expect(redactXmlString(xml)).toBe(`<secret>${REDACTED_PLACEHOLDER}</secret>`);
  });
});

describe('redactJson string routing', () => {
  it('THE GAP: a top-level XML body string is now redacted', () => {
    const out = redactJson('<req><password>hunter2</password></req>');
    expect(out).toBe(`<req><password>${REDACTED_PLACEHOLDER}</password></req>`);
  });

  it('an XML string nested INSIDE a JSON body is redacted too', () => {
    const out = redactJson({
      payload: '<req><token>t-1</token></req>',
      note: 'plain',
    }) as Record<string, unknown>;
    expect(out.payload).toBe(`<req><token>${REDACTED_PLACEHOLDER}</token></req>`);
    expect(out.note).toBe('plain');
  });

  it('non-markup strings pass through verbatim (pre-fix behaviour preserved)', () => {
    expect(redactJson('just a plain string with password word')).toBe(
      'just a plain string with password word',
    );
    expect(redactJson('a < b and b > c')).toBe('a < b and b > c');
  });

  it('object-field redaction is unchanged', () => {
    const out = redactJson({ password: 'x', name: 'y' }) as Record<string, unknown>;
    expect(out.password).toBe(REDACTED_PLACEHOLDER);
    expect(out.name).toBe('y');
  });
});
