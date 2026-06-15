/**
 * jQuery adapter smoke test.
 *
 * Migrated to V3 invocation in V3 Pack Migration Batch (Task Group 9,
 * task 9.11). Source map → `javascriptLangPack.extract(files, hints)`
 * → `jqueryFrameworkPack.adapt(irMap, runId, hints)`. All assertions
 * preserved verbatim from the V2 invocation shape so that smoke-test
 * parity is exact across the migration.
 *
 * Note: the V2 test used `extractJavaScriptES5IR` directly (which
 * re-tagged IR's `language` field as `'javascript-es5'`). The V3
 * `javascriptLangPack` uses `extractJavaScriptIR` (re-tagged as
 * `'javascript'`) — identical AST extraction underneath; the language
 * tag does NOT affect the jquery adapter's behaviour because the
 * adapter keys off call-expression callee shapes (`$.ajax`,
 * `$.widget`, etc.), not the IR's language field. See
 * `jqueryFrameworkPack/index.ts` for the parity rationale.
 */
import { javascriptLangPack } from '../services/extensionPacks/languagePacks/javascriptLangPack';
import { jqueryFrameworkPack } from '../services/extensionPacks/frameworkPacks/jqueryFrameworkPack';
import type { TechHints } from '../services/extensionPacks';

const JQ_SRC = `
function loadUsers() {
  $.ajax({ url: '/api/users', method: 'GET' });
}

function createItem(data) {
  $.post('/api/items', data);
}

// Widget registration inside an IIFE — realistic jQuery plugin pattern
function registerMyWidget() {
  $.widget('ui.mywidget', {
    options: {},
    _create: function() {}
  });
}
`;

const HINTS: TechHints = {
  '0': { language: 'JavaScript' },
  '1': { technology: 'jQuery' },
};

describe('jQuery adapter smoke tests', () => {
  it('emits endpoints from $.ajax / $.post calls and ui_component from $.widget', () => {
    const sourceFiles = new Map<string, string>([
      ['public/js/app.js', JQ_SRC],
    ]);
    const irMap = javascriptLangPack.extract(sourceFiles, HINTS);
    if (irMap.size === 0) throw new Error('parse fail');
    const c = jqueryFrameworkPack.adapt(irMap, 'jq-smoke', HINTS);
    const eps = c.filter((x) => x.candidateType === 'endpoints').map((e) => e.name);
    expect(eps).toContain('GET /api/users');
    expect(eps).toContain('POST /api/items');
    const comps = c.filter((x) => x.candidateType === 'ui_components').map((m) => m.name);
    expect(comps).toContain('ui.mywidget');
  });
});
