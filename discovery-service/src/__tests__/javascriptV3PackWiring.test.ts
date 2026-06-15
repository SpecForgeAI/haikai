/**
 * Focused V3-wiring tests for the JavaScript stack migration.
 *
 * Spec: V3 Pack Migration Batch (Task Group 9, task 9.1)
 *
 * Scope: verify the structural wiring of the V3 JavaScript stack — the
 * LanguagePack extracts IR, both FrameworkPacks (react-javascript +
 * jquery) produce candidates off that IR, registration does not
 * collide with other language / framework packs, and most importantly
 * `javascriptLangPack` and `typescriptLangPack` do NOT compete on file
 * selection. Full adapter-behaviour coverage lives in the migrated
 * smoke tests (`reactJavascript.smoke.test.ts`,
 * `jqueryAdapter.smoke.test.ts`) and in the per-pack 98% evaluation
 * gate.
 */
import { javascriptLangPack } from '../services/extensionPacks/languagePacks/javascriptLangPack';
import { reactJavascriptFrameworkPack } from '../services/extensionPacks/frameworkPacks/reactJavascriptFrameworkPack';
import { jqueryFrameworkPack } from '../services/extensionPacks/frameworkPacks/jqueryFrameworkPack';
import { javaLangPack } from '../services/extensionPacks/languagePacks/javaLangPack';
import { typescriptLangPack } from '../services/extensionPacks/languagePacks/typescriptLangPack';
import { pythonLangPack } from '../services/extensionPacks/languagePacks/pythonLangPack';
import { rubyLangPack } from '../services/extensionPacks/languagePacks/rubyLangPack';
import { phpLangPack } from '../services/extensionPacks/languagePacks/phpLangPack';
import { goLangPack } from '../services/extensionPacks/languagePacks/goLangPack';
import { csharpLangPack } from '../services/extensionPacks/languagePacks/csharpLangPack';
import type { TechHints } from '../services/extensionPacks';

const REACT_JS_HINTS: TechHints = {
  '0': { language: 'JavaScript' },
  '1': { technology: 'React' },
};

const JQUERY_HINTS: TechHints = {
  '0': { language: 'JavaScript' },
  '1': { technology: 'jQuery' },
};

describe('JavaScript V3 pack wiring', () => {
  it('javascriptLangPack.extract produces IR for a seeded .jsx file', () => {
    const files = new Map<string, string>([
      [
        'src/components/HelloButton.jsx',
        `import React from 'react';

export function HelloButton({ label }) {
  return <button>{label}</button>;
}
`,
      ],
    ]);
    const irMap = javascriptLangPack.extract(files, REACT_JS_HINTS);
    expect(irMap.size).toBe(1);
    const ir = irMap.get('src/components/HelloButton.jsx')!;
    // The extractor re-tags IR's language field as 'javascript' even
    // though the underlying parser used the TS grammar.
    expect(ir.language).toBe('javascript');
    // The exported function is surfaced.
    expect(ir.functions.map((f) => f.name)).toContain('HelloButton');
  });

  it('javascriptLangPack skips test files, .min.js, and node_modules', () => {
    const files = new Map<string, string>([
      ['src/lib/foo.js', 'export function foo() { return 1; }'],
      // Test file (filtered by isJsTestFile).
      ['src/lib/foo.test.js', 'test("foo", () => {});'],
      // __tests__ directory (filtered by isJsTestFile).
      ['src/__tests__/bar.js', 'test("bar", () => {});'],
      // .min.js (filtered by filterJsFiles).
      ['public/vendor/jquery.min.js', '!function(){}();'],
      // node_modules (filtered by filterJsFiles).
      ['src/node_modules/lodash/index.js', 'module.exports = {};'],
    ]);
    const irMap = javascriptLangPack.extract(files, REACT_JS_HINTS);
    // Only the non-test, non-min, non-node_modules file should survive.
    expect([...irMap.keys()]).toEqual(['src/lib/foo.js']);
  });

  it('reactJavascriptFrameworkPack.adapt produces ui_screen / ui_component / endpoint candidates off seeded IR', () => {
    const files = new Map<string, string>([
      [
        'src/pages/HomePage.jsx',
        `import React from 'react';

export function HomePage() {
  return <div>Home</div>;
}
`,
      ],
      [
        'src/components/Card.jsx',
        `import React from 'react';

export function Card({ children }) {
  return <div className="card">{children}</div>;
}
`,
      ],
      [
        'src/api/userClient.js',
        `import axios from 'axios';

export async function callList() {
  return axios.get('/api/users');
}
`,
      ],
    ]);
    const irMap = javascriptLangPack.extract(files, REACT_JS_HINTS);
    const candidates = reactJavascriptFrameworkPack.adapt(
      irMap,
      'wiring-test',
      REACT_JS_HINTS,
    );

    // ui_screen for *Page in pages/ directory.
    const screens = candidates.filter((c) => c.candidateType === 'ui_screens');
    expect(screens.map((s) => s.name)).toContain('HomePage');

    // ui_component for plain widget.
    const comps = candidates.filter((c) => c.candidateType === 'ui_components');
    expect(comps.map((c) => c.name)).toContain('Card');

    // endpoint for axios.get call.
    const eps = candidates.filter((c) => c.candidateType === 'endpoints');
    expect(eps.map((e) => e.name)).toContain('GET /api/users');

    // `_addedBy` tag preserved from V2 (react-axios-adapter, intentionally
    // shared with reactTypescriptFrameworkPack since the producing logic
    // is shared).
    expect(screens[0]!.data._addedBy).toBe('react-axios-adapter');
  });

  it('jqueryFrameworkPack.adapt produces endpoint + ui_component candidates off seeded IR', () => {
    const files = new Map<string, string>([
      [
        'public/js/app.js',
        `function loadUsers() {
  $.ajax({ url: '/api/users', method: 'GET' });
}

function registerWidget() {
  $.widget('ui.mywidget', { _create: function() {} });
}
`,
      ],
    ]);
    const irMap = javascriptLangPack.extract(files, JQUERY_HINTS);
    const candidates = jqueryFrameworkPack.adapt(
      irMap,
      'wiring-test',
      JQUERY_HINTS,
    );

    const eps = candidates.filter((c) => c.candidateType === 'endpoints');
    expect(eps.map((e) => e.name)).toContain('GET /api/users');

    const comps = candidates.filter((c) => c.candidateType === 'ui_components');
    expect(comps.map((c) => c.name)).toContain('ui.mywidget');

    // `_addedBy` tag preserved from V2 (jquery-adapter).
    expect(eps[0]!.data._addedBy).toBe('jquery-adapter');
  });

  it('javascriptLangPack and typescriptLangPack do NOT collide on file selection', () => {
    // typescriptLangPack picks .ts / .tsx; javascriptLangPack picks .js /
    // .jsx / .mjs / .cjs. Mixed-language repos must route each file
    // exactly once — no double-IR risk.
    const files = new Map<string, string>([
      ['src/types.ts', 'export interface Foo { bar: string; }'],
      ['src/util.js', 'export function foo() { return 1; }'],
      ['src/Comp.tsx', 'export function Comp(): any { return null; }'],
      ['src/Comp.jsx', 'export function Comp() { return null; }'],
    ]);

    const tsIr = typescriptLangPack.extract(files, {
      '0': { language: 'TypeScript' },
      '1': { technology: 'React' },
    });
    const jsIr = javascriptLangPack.extract(files, REACT_JS_HINTS);

    const tsKeys = [...tsIr.keys()].sort();
    const jsKeys = [...jsIr.keys()].sort();

    // TS pack picks only .ts / .tsx.
    expect(tsKeys).toEqual(['src/Comp.tsx', 'src/types.ts']);
    // JS pack picks only .js / .jsx.
    expect(jsKeys).toEqual(['src/Comp.jsx', 'src/util.js']);

    // No file is in both sets.
    const intersection = tsKeys.filter((k) => jsKeys.includes(k));
    expect(intersection).toEqual([]);
  });

  it('pack ids are distinct and do not collide with other LanguagePacks / FrameworkPacks', () => {
    // LanguagePack ids must be globally unique so the registry does not
    // double-register. FrameworkPack ids must be unique across packs.
    expect(javascriptLangPack.id).toBe('javascript-lang');
    expect(typescriptLangPack.id).toBe('typescript-lang');
    expect(javaLangPack.id).toBe('java-lang');
    expect(pythonLangPack.id).toBe('python-lang');
    expect(rubyLangPack.id).toBe('ruby-lang');
    expect(phpLangPack.id).toBe('php-lang');
    expect(goLangPack.id).toBe('go-lang');
    expect(csharpLangPack.id).toBe('csharp-lang');
    const langIds = new Set([
      javascriptLangPack.id,
      javaLangPack.id,
      typescriptLangPack.id,
      pythonLangPack.id,
      rubyLangPack.id,
      phpLangPack.id,
      goLangPack.id,
      csharpLangPack.id,
    ]);
    expect(langIds.size).toBe(8);

    expect(reactJavascriptFrameworkPack.id).toBe('react-javascript');
    expect(jqueryFrameworkPack.id).toBe('jquery');
    expect(reactJavascriptFrameworkPack.id).not.toBe(jqueryFrameworkPack.id);
  });

  it('reactJavascriptFrameworkPack predicate requires both JavaScript + React; jqueryFrameworkPack predicate requires both JavaScript + jQuery', () => {
    expect(reactJavascriptFrameworkPack.when).toEqual({
      language: 'JavaScript',
      technology: 'React',
    });
    expect(jqueryFrameworkPack.when).toEqual({
      language: 'JavaScript',
      technology: 'jQuery',
    });
    // Predicates differ — the two JS framework packs must NOT both match
    // the same techHints set.
    expect(reactJavascriptFrameworkPack.when.technology).not.toBe(
      jqueryFrameworkPack.when.technology,
    );
  });
});
