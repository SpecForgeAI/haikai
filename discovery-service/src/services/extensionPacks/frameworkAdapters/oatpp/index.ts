/**
 * Oatpp Framework Adapter — STUB.
 *
 * Oatpp uses heavy macro-based code generation. REST controllers look like:
 *   class UserController : public oatpp::web::server::api::ApiController {
 *     ENDPOINT("GET", "/users/{id}", getUser, PATH(Int32, id)) { ... }
 *   };
 *
 * The ENDPOINT(...) macro is preprocessed at compile time. tree-sitter sees
 * it as a generic function-like macro invocation. We detect classes deriving
 * from ApiController and emit an interface candidate, plus scan the class
 * body for ENDPOINT macro tokens to extract endpoint candidates.
 */
import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { SourceFileIR, ClassIR } from '../../languageIR';

function makeCandidate(
  type: DiscoveryCandidate['candidateType'],
  name: string, filePath: string, data: Record<string, unknown>, runId: string,
): DiscoveryCandidate {
  return {
    id: uuidv4(), runId, candidateType: type, name, confidence: 0.7,
    status: 'proposed', sourceClusterIds: [filePath],
    data: { ...data, _addedBy: 'oatpp-adapter' },
    synthesizedAt: new Date().toISOString(),
  };
}

const API_CONTROLLER_RE = /ApiController/;

/**
 * Scan raw source for `ENDPOINT(...)` macro invocations. IR-level detection
 * would miss these because tree-sitter sees the macro body as unparsed tokens.
 * This regex-based fallback covers the base case:
 *   ENDPOINT("GET", "/users/{id}", getUser, ...)
 * Returns an array of {httpMethod, url, handlerName}.
 */
function scanEndpointMacros(source: string): Array<{ httpMethod: string; url: string; handlerName: string }> {
  const out: Array<{ httpMethod: string; url: string; handlerName: string }> = [];
  const re = /ENDPOINT\s*\(\s*["']([A-Z]+)["']\s*,\s*["']([^"']+)["']\s*,\s*(\w+)/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    out.push({ httpMethod: m[1].toUpperCase(), url: m[2], handlerName: m[3] });
  }
  return out;
}

export function runOatppAdapter(files: SourceFileIR[], runId: string, rawSources: Map<string, string>): DiscoveryCandidate[] {
  const out: DiscoveryCandidate[] = [];
  // IR-based class detection is unreliable for Oatpp: nested macro args like
  // `PATH(Int32, id)` inside ENDPOINT(...) cause tree-sitter-cpp to give up
  // and emit zero class_specifier nodes. Fall back to pure regex detection
  // on the raw source.
  const controllerClassRe = /class\s+(\w+)\s*:\s*public\s+[\w:]*ApiController/g;
  for (const [filePath, src] of rawSources) {
    controllerClassRe.lastIndex = 0;
    let m;
    const controllersInFile: string[] = [];
    while ((m = controllerClassRe.exec(src)) !== null) controllersInFile.push(m[1]);
    for (const className of controllersInFile) {
      out.push(makeCandidate('interfaces', className, filePath, {
        className, controllerType: 'OatppController',
      }, runId));
    }
    if (controllersInFile.length > 0) {
      for (const ep of scanEndpointMacros(src)) {
        out.push(makeCandidate('endpoints', `${ep.httpMethod} ${ep.url}`, filePath, {
          httpMethod: ep.httpMethod, fullPath: ep.url, methodName: ep.handlerName,
          controllerClassName: controllersInFile[0],
        }, runId));
      }
    }
  }
  return out;
}
