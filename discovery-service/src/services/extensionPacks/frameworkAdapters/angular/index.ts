/**
 * Angular (2+) Framework Adapter
 *
 * Consumes TypeScript SourceFileIR and emits DiscoveryCandidates for an
 * Angular frontend codebase.
 *
 * Detection:
 *   @Component(...)                                → ui_component (or ui_screen if page-like)
 *   @NgModule(...)                                 → (skipped — modules are structural)
 *   @Injectable(...)                               → service → business_logic methods
 *   @Directive(...) / @Pipe(...)                   → ui_component (component-adjacent)
 *   HttpClient methods (this.http.get/post/etc.)   → endpoint (consumer side)
 *   interface / type alias with fields             → logical_entity + logical_data_attribute
 *
 * Out of scope for this base pack:
 *   - Angular Router config (Routes array in routing module) — would need
 *     module-level expression support in the IR.
 *   - Signal / standalone component metadata
 *   - Template-file analysis (.component.html)
 */
import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { SourceFileIR, ClassIR, FunctionIR, FieldIR, CallIR, ParameterIR } from '../../languageIR';
import { hasAnnotation, findAnnotation, annotationArg } from '../../languageIR';

const HTTP_METHOD_NAMES = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'options']);
const SCREEN_NAME_SUFFIX = /(Page|Screen|View)$/;
const BUSINESS_LOGIC_EXCLUDE_PREFIXES = [
  'get', 'set', 'is', 'has', 'use', 'render', 'format', 'map', 'to',
  'create', 'update', 'delete', 'save', 'find', 'fetch', 'load', 'list', 'add', 'remove',
];

function makeCandidate(
  type: DiscoveryCandidate['candidateType'],
  name: string,
  filePath: string,
  data: Record<string, unknown>,
  runId: string,
  parentCandidateId?: string,
): DiscoveryCandidate {
  const c: DiscoveryCandidate = {
    id: uuidv4(),
    runId, candidateType: type, name, confidence: 0.9,
    status: 'proposed', sourceClusterIds: [filePath],
    data: { ...data, _addedBy: 'angular-adapter' },
    synthesizedAt: new Date().toISOString(),
  };
  if (parentCandidateId) c.parentCandidateId = parentCandidateId;
  return c;
}

function inferComponentType(name: string): string {
  const lower = name.toLowerCase();
  if (/button$/i.test(name)) return 'button';
  if (/form$/i.test(name) || /edit(or)?$/i.test(name)) return 'form';
  if (/modal$|dialog$/i.test(name)) return 'modal';
  if (/table$|grid$|list$/i.test(name)) return 'table';
  if (/card$|item$|tile$/i.test(name)) return 'card';
  if (/header$|footer$|sidebar$|nav(bar)?$|layout$|shell$/i.test(name)) return 'layout';
  if (/input$|field$|select$/i.test(name)) return 'input';
  return 'other';
}

function parseUrlLiteral(text: string): { url: string | null; urlVariable: string | null } {
  if (!text) return { url: null, urlVariable: null };
  const t = text.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return { url: t.slice(1, -1), urlVariable: null };
  }
  if (t.startsWith('`') && t.endsWith('`')) return { url: t.slice(1, -1), urlVariable: null };
  if (/^[A-Za-z_$][A-Za-z0-9_$]*(\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(t)) {
    return { url: null, urlVariable: t };
  }
  return { url: null, urlVariable: null };
}

function stripTypeWrappers(type: string): string {
  if (!type) return type;
  let t = type.trim().replace(/\[\]$/, '').trim();
  const gen = t.match(/^[A-Za-z_$][A-Za-z0-9_$]*\s*<\s*(.+)\s*>$/);
  if (gen) return stripTypeWrappers(gen[1]);
  if (t.includes('|')) return stripTypeWrappers(t.split('|')[0].trim());
  return t;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function processAngularComponent(cls: ClassIR, file: SourceFileIR, runId: string, out: AdapterOutput): void {
  const component = findAnnotation(cls.annotations, 'Component');
  const directive = findAnnotation(cls.annotations, 'Directive');
  const pipe = findAnnotation(cls.annotations, 'Pipe');
  const ann = component || directive || pipe;
  if (!ann) return;

  const isScreen = SCREEN_NAME_SUFFIX.test(cls.name);
  if (isScreen) {
    out.candidates.push(
      makeCandidate('ui_screens', cls.name, file.filePath, {
        className: cls.name,
        selector: annotationArg(ann, 'selector') || null,
        templateUrl: annotationArg(ann, 'templateUrl') || null,
      }, runId),
    );
  } else {
    out.candidates.push(
      makeCandidate('ui_components', cls.name, file.filePath, {
        className: cls.name,
        component_type: inferComponentType(cls.name),
        selector: annotationArg(ann, 'selector') || null,
        templateUrl: annotationArg(ann, 'templateUrl') || null,
        isDirective: !!directive,
        isPipe: !!pipe,
      }, runId),
    );
  }
}

function processAngularService(cls: ClassIR, file: SourceFileIR, runId: string, out: AdapterOutput): void {
  if (!hasAnnotation(cls.annotations, 'Injectable')) return;
  // Angular services ARE the business-logic layer. Emit non-CRUD public methods.
  for (const method of cls.methods) {
    if (method.name === 'constructor') continue;
    if (method.modifiers.includes('private')) continue;
    const lower = method.name.replace(/^_/, '');
    let skip = false;
    for (const pfx of BUSINESS_LOGIC_EXCLUDE_PREFIXES) {
      if (lower.startsWith(pfx)) {
        const rem = lower.slice(pfx.length);
        if (rem === '' || /^[A-Z]/.test(rem)) { skip = true; break; }
      }
    }
    if (skip) continue;
    out.candidates.push(
      makeCandidate('business_logics', method.name, file.filePath, {
        className: cls.name,
        returnType: method.returnType,
        parameterCount: method.parameters.length,
      }, runId),
    );
  }
}

function processHttpCalls(cls: ClassIR, file: SourceFileIR, runId: string, out: AdapterOutput): void {
  // Look for `this.http.get(...)`, `this.httpClient.post(...)`, etc. inside
  // service method bodies. The IR captures these as CallIR on FunctionIR.calls.
  for (const method of cls.methods) {
    if (!method.calls || method.calls.length === 0) continue;
    for (const call of method.calls) {
      const parsed = classifyHttpCall(call);
      if (!parsed) continue;
      const { httpMethod, url, urlVariable } = parsed;
      let urlPart: string;
      if (url) urlPart = url;
      else if (urlVariable) urlPart = `$${urlVariable}`;
      else urlPart = '?';
      out.candidates.push(
        makeCandidate('endpoints', `${httpMethod} ${urlPart}`, file.filePath, {
          httpMethod, url, urlVariable,
          apiLibrary: 'HttpClient',
          callingFunction: `${cls.name}.${method.name}`,
          endpoint_subtype: 'api_call',
          responseType: call.typeArgs,
          line: call.line,
        }, runId),
      );
    }
  }
}

function classifyHttpCall(call: CallIR): { httpMethod: string; url: string | null; urlVariable: string | null } | null {
  // Look for `*.get(...)`, `*.post(...)` etc. on this.http / this.httpClient / apiClient
  const dot = call.callee.lastIndexOf('.');
  if (dot === -1) return null;
  const method = call.callee.slice(dot + 1);
  if (!HTTP_METHOD_NAMES.has(method)) return null;
  // Heuristic: the receiver must be something http-ish
  const receiver = call.callee.slice(0, dot).toLowerCase();
  if (!/http|api|service|client/i.test(receiver)) return null;
  const { url, urlVariable } = parseUrlLiteral(call.args[0] || '');
  return { httpMethod: method.toUpperCase(), url, urlVariable };
}

// ---------------------------------------------------------------------------
// Logical entity (TypeScript interfaces / types referenced in this file's
// models.ts / *.model.ts / *.interface.ts)
// ---------------------------------------------------------------------------

function processLogicalEntity(cls: ClassIR, file: SourceFileIR, runId: string, out: AdapterOutput): void {
  if (!cls.isInterface) return;
  if (cls.fields.length === 0) return;
  const logical = makeCandidate('logical_data_entities', cls.name, file.filePath, {
    className: cls.name, isInterface: true,
  }, runId);
  out.candidates.push(logical);
  for (const field of cls.fields) {
    if (field.modifiers.includes('static')) continue;
    out.candidates.push(
      makeCandidate('logical_data_attributes', field.name, file.filePath, {
        fieldName: field.name, dataType: field.type, logicalEntityName: cls.name,
      }, runId, logical.id),
    );
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

interface AdapterOutput { candidates: DiscoveryCandidate[]; }

export function runAngularAdapter(files: SourceFileIR[], runId: string): DiscoveryCandidate[] {
  const out: AdapterOutput = { candidates: [] };
  for (const file of files) {
    for (const cls of file.classes) {
      processAngularComponent(cls, file, runId, out);
      processAngularService(cls, file, runId, out);
      processHttpCalls(cls, file, runId, out);
      processLogicalEntity(cls, file, runId, out);
    }
  }
  return out.candidates;
}
