/**
 * jQuery Framework Adapter — STUB.
 *
 * jQuery is neither MVC nor data-layer; it's a DOM-manipulation library.
 * Architectural signals in a jQuery codebase are sparse. What we DO detect:
 *
 *   $.fn.foo = function() {}                    → ui_component (jQuery plugin)
 *   $.widget('ui.widgetName', {})               → ui_component (jQuery UI widget)
 *   $.ajax({url: '/api/foo', method: 'POST'})   → endpoint (consumer-side AJAX)
 *   $.get/post/getJSON/put('/api/x', ...)       → endpoint
 *
 * This base pack walks call expressions inside function bodies and looks for
 * these patterns. It emits very few candidates for most jQuery codebases.
 */
import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { SourceFileIR, FunctionIR, CallIR } from '../../languageIR';

function makeCandidate(
  type: DiscoveryCandidate['candidateType'],
  name: string, filePath: string, data: Record<string, unknown>, runId: string,
): DiscoveryCandidate {
  return {
    id: uuidv4(), runId, candidateType: type, name, confidence: 0.75,
    status: 'proposed', sourceClusterIds: [filePath],
    data: { ...data, _addedBy: 'jquery-adapter' },
    synthesizedAt: new Date().toISOString(),
  };
}

function cleanString(s: string): string | null {
  const t = s.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) return t.slice(1, -1);
  return null;
}

function extractAjaxOpts(argText: string): { url: string | null; method: string } | null {
  // Options object like `{url: '/api/foo', method: 'POST'}` — very loose parsing
  const urlM = argText.match(/url\s*:\s*['"`]([^'"`]+)['"`]/);
  const methodM = argText.match(/(?:type|method)\s*:\s*['"`](GET|POST|PUT|DELETE|PATCH)['"`]/i);
  if (!urlM) return null;
  return { url: urlM[1], method: methodM ? methodM[1].toUpperCase() : 'GET' };
}

function processCalls(calls: CallIR[], callerName: string, file: SourceFileIR, runId: string, out: DiscoveryCandidate[]): void {
  for (const call of calls) {
    const c = call.callee;
    // $.ajax({...})
    if (c === '$.ajax' || c === 'jQuery.ajax') {
      const opts = extractAjaxOpts(call.args[0] || '');
      if (opts) {
        out.push(makeCandidate('endpoints', `${opts.method} ${opts.url}`, file.filePath, {
          httpMethod: opts.method, url: opts.url, apiLibrary: 'jQuery',
          callingFunction: callerName, endpoint_subtype: 'api_call',
        }, runId));
      }
      continue;
    }
    // $.get / $.post / $.put / $.delete / $.getJSON
    const mShortM = c.match(/^(?:\$|jQuery)\.(get|post|put|delete|patch|getJSON)$/i);
    if (mShortM) {
      const url = cleanString(call.args[0] || '');
      if (url) {
        const method = mShortM[1].toLowerCase() === 'getjson' ? 'GET' : mShortM[1].toUpperCase();
        out.push(makeCandidate('endpoints', `${method} ${url}`, file.filePath, {
          httpMethod: method, url, apiLibrary: 'jQuery',
          callingFunction: callerName, endpoint_subtype: 'api_call',
        }, runId));
      }
      continue;
    }
    // $.widget('namespace.name', prototype)
    if (c === '$.widget' || c === 'jQuery.widget') {
      const widgetName = cleanString(call.args[0] || '');
      if (widgetName) {
        out.push(makeCandidate('ui_components', widgetName, file.filePath, {
          component_type: 'other', jqueryWidget: true,
          callingFunction: callerName,
        }, runId));
      }
    }
  }
}

export function runJqueryAdapter(files: SourceFileIR[], runId: string): DiscoveryCandidate[] {
  const out: DiscoveryCandidate[] = [];
  for (const file of files) {
    // Top-level functions
    for (const fn of file.functions) {
      if (fn.calls) processCalls(fn.calls, fn.name, file, runId, out);
    }
    // Class methods (rare in ES5 but handle gracefully)
    for (const cls of file.classes) {
      for (const m of cls.methods) {
        if (m.calls) processCalls(m.calls, `${cls.name}.${m.name}`, file, runId, out);
      }
    }
  }
  return out;
}
