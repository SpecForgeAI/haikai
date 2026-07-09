/**
 * WSDL -> capture inventory (Spec 2026-07-06-j — Parity Exactness &
 * First-Class SOAP).
 *
 * Replaces the previous hard 400 on WSDL upload: a WSDL 1.1 document parses
 * into inventory operation rows shaped like the SOAP-prepop path's output —
 * `POST` operations whose OAS stub carries the `x-amvs-soap` block
 * (soap_action / request_root_element / request_namespace /
 * response_root_element / wsdl_source), so the capture loop, the
 * deterministic envelope builder (`soapEnvelope.ts`), and the XML comparer
 * all read ONE metadata shape regardless of whether the operations came from
 * the committed model or a WSDL upload.
 *
 * Deliberately WSDL 1.1 essentials only (document/literal estates):
 * operations from the first portType, soapAction + address from the first
 * binding/service that references them. Anything unparseable yields [] and
 * the route surfaces the standard invalid-spec 400 — never a guess.
 */

import { XMLParser } from 'fast-xml-parser';

export interface WsdlOperationRow {
  operationId: string;
  /** SOAP is always an HTTP POST (lowercase per the OAS HttpMethod union). */
  method: 'post';
  path: string;
  summary: string;
  soap: {
    soap_action: string | null;
    request_root_element: string | null;
    request_namespace: string | null;
    response_root_element: string | null;
    wsdl_source: string;
  };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function stripPrefix(name: string | undefined): string | null {
  if (!name) return null;
  const idx = name.indexOf(':');
  return idx >= 0 ? name.slice(idx + 1) : name;
}

export function parseWsdlToInventory(
  wsdlXml: string,
  sourceLabel: string,
): WsdlOperationRow[] {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(wsdlXml) as Record<string, unknown>;
  } catch {
    return [];
  }
  const definitions = doc.definitions as Record<string, unknown> | undefined;
  if (!definitions) return [];

  const targetNamespace = (definitions['@_targetNamespace'] as string | undefined) ?? null;

  // message name -> first part element local name (doc/literal wrapper).
  const messageElement = new Map<string, string | null>();
  for (const message of asArray(definitions.message as never)) {
    const m = message as Record<string, unknown>;
    const name = m['@_name'] as string | undefined;
    if (!name) continue;
    const part = asArray(m.part as never)[0] as Record<string, unknown> | undefined;
    messageElement.set(name, stripPrefix(part?.['@_element'] as string | undefined));
  }

  // portType operations: name -> {input message, output message}.
  const portType = asArray(definitions.portType as never)[0] as
    | Record<string, unknown>
    | undefined;
  if (!portType) return [];
  const operations = asArray(portType.operation as never).map(
    (op) => op as Record<string, unknown>,
  );

  // binding soapActions: operation name -> soapAction.
  const soapActionByOp = new Map<string, string | null>();
  for (const binding of asArray(definitions.binding as never)) {
    const b = binding as Record<string, unknown>;
    for (const op of asArray(b.operation as never)) {
      const o = op as Record<string, unknown>;
      const name = o['@_name'] as string | undefined;
      if (!name || soapActionByOp.has(name)) continue;
      const soapOp = o.operation as Record<string, unknown> | undefined;
      soapActionByOp.set(name, (soapOp?.['@_soapAction'] as string | undefined) ?? null);
    }
  }

  // service address: the first soap:address location's PATH.
  let addressPath = '/';
  const service = asArray(definitions.service as never)[0] as
    | Record<string, unknown>
    | undefined;
  const port = service
    ? (asArray(service.port as never)[0] as Record<string, unknown> | undefined)
    : undefined;
  const address = port?.address as Record<string, unknown> | undefined;
  const location = address?.['@_location'] as string | undefined;
  if (location) {
    const m = /^[a-z]+:\/\/[^/]+(\/.*)?$/i.exec(location);
    addressPath = m?.[1] && m[1].length > 0 ? m[1] : '/';
  }

  const rows: WsdlOperationRow[] = [];
  for (const op of operations) {
    const name = op['@_name'] as string | undefined;
    if (!name) continue;
    const inputMessage = stripPrefix(
      (op.input as Record<string, unknown> | undefined)?.['@_message'] as string | undefined,
    );
    const outputMessage = stripPrefix(
      (op.output as Record<string, unknown> | undefined)?.['@_message'] as string | undefined,
    );
    rows.push({
      operationId: name,
      method: 'post',
      path: addressPath,
      summary: name,
      soap: {
        soap_action: soapActionByOp.get(name) ?? null,
        request_root_element: inputMessage ? (messageElement.get(inputMessage) ?? name) : name,
        request_namespace: targetNamespace,
        response_root_element: outputMessage
          ? (messageElement.get(outputMessage) ?? `${name}Response`)
          : `${name}Response`,
        wsdl_source: sourceLabel,
      },
    });
  }
  return rows;
}
