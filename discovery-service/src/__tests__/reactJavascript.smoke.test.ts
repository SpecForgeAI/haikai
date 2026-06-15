/**
 * Smoke test for React + plain JavaScript (not TypeScript).
 *
 * Migrated to V3 invocation in V3 Pack Migration Batch (Task Group 9,
 * task 9.11). Source map → `javascriptLangPack.extract(files, hints)`
 * → `reactJavascriptFrameworkPack.adapt(irMap, runId, hints)`. All
 * assertions preserved verbatim from the V2 invocation shape so that
 * smoke-test parity is exact across the migration.
 *
 * Verifies the JS extractor path emits the same kinds of candidates as
 * TS via the shared `runReactAxiosAdapter`.
 */
import { javascriptLangPack } from '../services/extensionPacks/languagePacks/javascriptLangPack';
import { reactJavascriptFrameworkPack } from '../services/extensionPacks/frameworkPacks/reactJavascriptFrameworkPack';
import type { TechHints } from '../services/extensionPacks';

const PAGE_JSX = `
import React from 'react';

export function OwnersPage() {
  return <div>Owners</div>;
}
`;

const WIDGET_JSX = `
import React from 'react';

export function SubmitButton() {
  return <button>Submit</button>;
}
`;

const API_JS = `
import axios from 'axios';

export async function fetchUsers() {
  const res = await axios.get('/api/users');
  return res.data;
}

export async function createUser(data) {
  return axios.post('/api/users', data);
}

export function evaluateDiscountPolicy(user) {
  return 0;
}
`;

const HINTS: TechHints = {
  '0': { language: 'JavaScript' },
  '1': { technology: 'React' },
};

describe('React + plain JavaScript smoke test', () => {
  let irMap: ReturnType<typeof javascriptLangPack.extract>;

  beforeAll(() => {
    const sourceFiles = new Map<string, string>([
      ['src/pages/OwnersPage.jsx', PAGE_JSX],
      ['src/components/SubmitButton.jsx', WIDGET_JSX],
      ['src/api/userClient.js', API_JS],
    ]);
    irMap = javascriptLangPack.extract(sourceFiles, HINTS);
    if (irMap.size !== 3) throw new Error(`expected 3 IR files, got ${irMap.size}`);
  });

  it('IR language tag is "javascript" for JS files', () => {
    const ir = irMap.get('src/pages/OwnersPage.jsx');
    expect(ir).toBeDefined();
    expect(ir!.language).toBe('javascript');
  });

  it('emits ui_screen for *Page components', () => {
    const c = reactJavascriptFrameworkPack.adapt(irMap, 'js-smoke', HINTS);
    const screens = c.filter((x) => x.candidateType === 'ui_screens').map((s) => s.name);
    expect(screens).toContain('OwnersPage');
  });

  it('emits ui_component for reusable widgets', () => {
    const c = reactJavascriptFrameworkPack.adapt(irMap, 'js-smoke', HINTS);
    const comps = c.filter((x) => x.candidateType === 'ui_components').map((s) => s.name);
    expect(comps).toContain('SubmitButton');
  });

  it('emits endpoint candidates for axios calls in .js source', () => {
    const c = reactJavascriptFrameworkPack.adapt(irMap, 'js-smoke', HINTS);
    const eps = c.filter((x) => x.candidateType === 'endpoints').map((e) => e.name).sort();
    expect(eps).toContain('GET /api/users');
    expect(eps).toContain('POST /api/users');
  });

  it('emits business_logic for domain-named exported functions', () => {
    const c = reactJavascriptFrameworkPack.adapt(irMap, 'js-smoke', HINTS);
    const bl = c.filter((x) => x.candidateType === 'business_logics').map((b) => b.name);
    expect(bl).toContain('evaluateDiscountPolicy');
  });
});
