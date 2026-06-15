/**
 * Contract-format detection for the capture wizard's step-1 source upload.
 *
 * Spec: 2026-06-03 OAS-YAML + WADL/XSD Contract Support for the API Behaviour
 * capture harness, Task Groups 1 + 2.
 *
 * Classifies an uploaded / fetched contract file into one of:
 *   - `'oas'`   : OpenAPI JSON or YAML (REST) -- parsed by `oasParser`.
 *   - `'wadl'`  : WADL document (REST endpoints) -- parsed by `wadlParser`,
 *                 with sibling `.xsd` grammars supplying body field structure.
 *   - `'xsd'`   : a bare XSD schema (types only -- NO endpoints). On its own
 *                 this cannot drive capture; the route asks the user to also
 *                 upload the WADL.
 *   - `'wsdl'`  : an actual WSDL / SOAP definition. The SOAP-envelope execution
 *                 path is a planned follow-on; the route returns a clear 400.
 *   - `'unknown'`: nothing matched -- treated as OAS for back-compat (the OAS
 *                 parser then emits the canonical "invalid spec" 400).
 *
 * Detection is by file extension first, then by a lightweight content sniff
 * (root element / namespace markers) so extension-less uploads still classify.
 * Pure: operates on the file name + a UTF-8 string snippet. No I/O.
 */

export type ContractFormat = 'oas' | 'wadl' | 'xsd' | 'wsdl' | 'unknown';

const WADL_NAMESPACE = 'http://wadl.dev.java.net/2009/02';

/** Lower-cased file extension (without the dot), or '' when none. */
function extOf(fileName: string | null | undefined): string {
  if (!fileName) return '';
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return '';
  return lower.slice(dot + 1);
}

/**
 * Detect SOAP/WSDL from content markers. True ONLY for an actual SOAP/WSDL
 * definition -- NOT for a plain XSD schema (which is the WADL's grammar and is
 * fully supported). Markers:
 *   - a `<...definitions` root in the WSDL namespace, or a `wsdl:` prefix, OR
 *   - any `<soap:` / SOAP-envelope element.
 */
function looksLikeWsdlSoap(content: string): boolean {
  const head = content.slice(0, 4000);
  // `<wsdl:definitions` or a bare `<definitions ... xmlns=".../wsdl/">`.
  if (/<\s*(?:[A-Za-z0-9_]+:)?definitions\b/.test(head)) {
    if (/schemas\.xmlsoap\.org\/wsdl/.test(head) || /<\s*wsdl:/.test(head)) {
      return true;
    }
    // A `<definitions>` root with WSDL-ish children is still WSDL even without
    // the canonical namespace string present in the first 4 KB.
    if (/<\s*definitions\b/.test(head)) return true;
  }
  if (/<\s*wsdl:/.test(head)) return true;
  if (/<\s*soap(?:env)?:/i.test(head)) return true;
  if (/schemas\.xmlsoap\.org\/soap/.test(head)) return true;
  return false;
}

/** True when the content root is a WADL `<application>` in the WADL namespace. */
function looksLikeWadl(content: string): boolean {
  const head = content.slice(0, 4000);
  if (head.includes(WADL_NAMESPACE)) return true;
  // `<application ...>` root with the WADL namespace declared.
  if (/<\s*application\b/.test(head) && head.includes('wadl.dev.java.net')) {
    return true;
  }
  return false;
}

/** True when the content root is an `<xs:schema>` / `<schema>` XSD document. */
function looksLikeXsd(content: string): boolean {
  const head = content.slice(0, 4000);
  if (/<\s*(?:[A-Za-z0-9_]+:)?schema\b/.test(head)) {
    if (/XMLSchema/.test(head) || /<\s*xs:/.test(head) || /<\s*xsd:/.test(head)) {
      return true;
    }
  }
  return false;
}

/**
 * Classify a single contract file by name + content. WSDL/SOAP is detected
 * BEFORE XSD/WADL so an actual SOAP definition is never mistaken for a grammar.
 */
export function detectContractFormat(
  fileName: string | null | undefined,
  content: string,
): ContractFormat {
  const ext = extOf(fileName);

  // Extension is the strongest signal.
  if (ext === 'wsdl') return 'wsdl';
  if (ext === 'wadl') return 'wadl';
  if (ext === 'xsd') return 'xsd';
  if (ext === 'json' || ext === 'yaml' || ext === 'yml') {
    // A `.yaml`/`.json` could still be an OAS doc; content sniff for the rare
    // case someone names an XML file `.json` is not worth it. Trust the ext.
    return 'oas';
  }

  // No (recognised) extension -- sniff the content. Order matters: WSDL/SOAP
  // first so it is never swallowed by the XSD/WADL checks.
  if (looksLikeWsdlSoap(content)) return 'wsdl';
  if (looksLikeWadl(content)) return 'wadl';
  if (looksLikeXsd(content)) return 'xsd';

  const trimmed = content.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'oas';
  // YAML OAS commonly starts with `openapi:` / `swagger:`.
  if (/^\s*(openapi|swagger)\s*:/m.test(content.slice(0, 2000))) return 'oas';

  return 'unknown';
}

/**
 * Among a set of uploaded files, identify the single contract file and the
 * accompanying grammar (`.xsd`) files. The contract is the first WADL (or OAS
 * or WSDL) found; everything classified `'xsd'` becomes a grammar sibling.
 *
 * Returns the contract's format + name + content, plus a name->content map of
 * the XSD grammars. When no contract file is present but XSDs are, the contract
 * is reported as `'xsd'` (the lone-XSD case the route turns into a friendly
 * 400 asking for the WADL).
 */
export interface ClassifiedUpload {
  contractFormat: ContractFormat;
  contractName: string | null;
  contractContent: string | null;
  /** name -> contents of every `.xsd` grammar uploaded alongside the contract. */
  xsdGrammars: Map<string, string>;
  /** True when at least one `.xsd` was uploaded. */
  hasXsd: boolean;
}

export function classifyUploadedFiles(
  files: Array<{ name: string; content: string }>,
): ClassifiedUpload {
  const xsdGrammars = new Map<string, string>();
  let contractFormat: ContractFormat = 'unknown';
  let contractName: string | null = null;
  let contractContent: string | null = null;

  // First pass: collect every XSD grammar.
  const perFileFormat = files.map((f) => ({
    file: f,
    fmt: detectContractFormat(f.name, f.content),
  }));
  for (const { file, fmt } of perFileFormat) {
    if (fmt === 'xsd') {
      xsdGrammars.set(file.name, file.content);
    }
  }

  // Second pass: pick the contract. Priority: wsdl (so we can 400 it), then
  // wadl, then oas. A lone XSD with no contract yields contractFormat='xsd'.
  const priority: ContractFormat[] = ['wsdl', 'wadl', 'oas', 'unknown'];
  for (const wanted of priority) {
    const hit = perFileFormat.find((p) => p.fmt === wanted);
    if (hit) {
      contractFormat = hit.fmt;
      contractName = hit.file.name;
      contractContent = hit.file.content;
      break;
    }
  }

  // If the only files are XSDs (no contract matched above), surface 'xsd' so
  // the route can return the "upload the WADL too" message.
  if (contractFormat === 'unknown' && xsdGrammars.size > 0) {
    const firstXsd = perFileFormat.find((p) => p.fmt === 'xsd');
    contractFormat = 'xsd';
    contractName = firstXsd?.file.name ?? null;
    contractContent = firstXsd?.file.content ?? null;
  }

  return {
    contractFormat,
    contractName,
    contractContent,
    xsdGrammars,
    hasXsd: xsdGrammars.size > 0,
  };
}
