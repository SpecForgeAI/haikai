/**
 * Deterministic SOAP 1.1 envelope builder (Spec 2026-07-06-j — Parity
 * Exactness & First-Class SOAP).
 *
 * The capture LLM fills VALUES only, never structure: given the committed
 * SOAP metadata (request root element + namespace — the `x-amvs-soap` block
 * the model-seeded prepop already carries) and an ordered parameter list,
 * this builder produces a BYTE-STABLE envelope. Target replay never calls
 * it — replay resends the CAPTURED raw request body verbatim.
 */

export interface SoapEnvelopeArgs {
  requestRootElement: string;
  requestNamespace: string;
  /** Ordered (name, value) pairs — order is caller-controlled and stable. */
  params: Array<[string, string]>;
  /** Optional literal XML for the Header block (omitted when absent). */
  headerXml?: string | null;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** SOAP 1.1 envelope, deterministic byte-for-byte for identical inputs. */
export function buildSoapEnvelope(args: SoapEnvelopeArgs): string {
  const body = args.params
    .map(([name, value]) => `      <req:${name}>${escapeXml(value)}</req:${name}>`)
    .join('\n');
  const header = args.headerXml
    ? `  <soapenv:Header>${args.headerXml}</soapenv:Header>\n`
    : '  <soapenv:Header/>\n';
  return (
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `xmlns:req="${escapeXml(args.requestNamespace)}">\n` +
    header +
    `  <soapenv:Body>\n` +
    `    <req:${args.requestRootElement}>\n` +
    `${body}\n` +
    `    </req:${args.requestRootElement}>\n` +
    `  </soapenv:Body>\n` +
    `</soapenv:Envelope>`
  );
}
