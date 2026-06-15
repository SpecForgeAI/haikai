/**
 * Smoke tests for the V3 Angular pack pair.
 *
 * Spec: V3 Pack Migration Batch (Task Group 3)
 *
 * Migrated from direct `extractTypeScriptIR` + `runAngularAdapter` invocation
 * to the V3 pack shape: `typescriptLangPack.extract` +
 * `angularFrameworkPack.adapt`. All assertions are preserved verbatim — only
 * the invocation shape changes.
 */
import { typescriptLangPack } from '../services/extensionPacks/languagePacks/typescriptLangPack';
import { angularFrameworkPack } from '../services/extensionPacks/frameworkPacks/angularFrameworkPack';
import type { TechHints } from '../services/extensionPacks';

const ANGULAR_HINTS: TechHints = {
  '0': { language: 'TypeScript' },
  '1': { technology: 'Angular' },
};

function runV3Pipeline(files: Map<string, string>, runId: string) {
  const irFiles = typescriptLangPack.extract(files, ANGULAR_HINTS);
  return angularFrameworkPack.adapt(irFiles, runId, ANGULAR_HINTS);
}

const COMPONENT_SRC = `
import { Component } from '@angular/core';

@Component({
  selector: 'app-article-list',
  templateUrl: './article-list.component.html'
})
export class ArticleListComponent {
  constructor() {}
}

@Component({ selector: 'app-settings-page' })
export class SettingsPage {
}

@Component({ selector: 'app-submit-button' })
export class SubmitButton {
}
`;

const SERVICE_SRC = `
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class ArticleService {
  constructor(private http: HttpClient) {}

  getArticles() {
    return this.http.get('/api/articles');
  }

  createArticle(payload: any) {
    return this.http.post('/api/articles', payload);
  }

  evaluateArticleScore(article: any) {
    return 0;
  }

  deleteArticle(slug: string) {
    return this.http.delete(\`/api/articles/\${slug}\`);
  }
}
`;

const MODEL_SRC = `
export interface Article {
  slug: string;
  title: string;
  body: string;
  author: string;
}

export interface User {
  id: number;
  name: string;
}
`;

describe('Angular V3 pack pair smoke tests', () => {
  const files = new Map<string, string>([
    ['src/app/article/article-list.component.ts', COMPONENT_SRC],
    ['src/app/services/article.service.ts', SERVICE_SRC],
    ['src/app/models/article.model.ts', MODEL_SRC],
  ]);

  it('emits ui_screen for @Component classes with *Page suffix', () => {
    const c = runV3Pipeline(files, 'ng-smoke');
    const screens = c.filter((x) => x.candidateType === 'ui_screens').map((s) => s.name);
    expect(screens).toContain('SettingsPage');
  });

  it('emits ui_component for @Component classes without screen suffix', () => {
    const c = runV3Pipeline(files, 'ng-smoke');
    const comps = c.filter((x) => x.candidateType === 'ui_components').map((s) => s.name).sort();
    expect(comps).toEqual(['ArticleListComponent', 'SubmitButton']);
  });

  it('emits business_logic for non-CRUD methods on @Injectable services', () => {
    const c = runV3Pipeline(files, 'ng-smoke');
    const bl = c.filter((x) => x.candidateType === 'business_logics').map((b) => b.name);
    expect(bl).toContain('evaluateArticleScore');
    // getArticles/createArticle/deleteArticle are CRUD-prefixed — excluded
    expect(bl).not.toContain('getArticles');
    expect(bl).not.toContain('createArticle');
    expect(bl).not.toContain('deleteArticle');
  });

  it('emits endpoint candidates for HttpClient calls', () => {
    const c = runV3Pipeline(files, 'ng-smoke');
    const eps = c.filter((x) => x.candidateType === 'endpoints').map((e) => e.name).sort();
    expect(eps).toContain('GET /api/articles');
    expect(eps).toContain('POST /api/articles');
    expect(eps).toContain('DELETE /api/articles/${slug}');
  });

  it('emits logical_entity + logical_data_attribute for TS interfaces', () => {
    const c = runV3Pipeline(files, 'ng-smoke');
    const logs = c.filter((x) => x.candidateType === 'logical_data_entities').map((l) => l.name).sort();
    expect(logs).toEqual(['Article', 'User']);
    const attrs = c.filter((x) => x.candidateType === 'logical_data_attributes');
    expect(attrs.length).toBe(6); // Article(4) + User(2)
  });
});
