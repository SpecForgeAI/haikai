/**
 * Focused V3-wiring tests for the Python stack migration.
 *
 * Spec: V3 Pack Migration Batch (Task Group 4, task 4.1)
 *
 * Scope: verify the structural wiring of the V3 Python stack — the
 * LanguagePack extracts IR, each of the two FrameworkPacks produces
 * candidates off that IR, and registration does not collide with other
 * language / framework packs. Full adapter-behaviour coverage lives in the
 * migrated smoke tests (`djangoAdapter.smoke.test.ts`,
 * `flaskAdapter.smoke.test.ts`) and in the per-pack 98% evaluation gate.
 */
import { pythonLangPack } from '../services/extensionPacks/languagePacks/pythonLangPack';
import { djangoFrameworkPack } from '../services/extensionPacks/frameworkPacks/djangoFrameworkPack';
import { flaskFrameworkPack } from '../services/extensionPacks/frameworkPacks/flaskFrameworkPack';
import { javaLangPack } from '../services/extensionPacks/languagePacks/javaLangPack';
import { typescriptLangPack } from '../services/extensionPacks/languagePacks/typescriptLangPack';
import type { TechHints } from '../services/extensionPacks';

const DJANGO_HINTS: TechHints = {
  '0': { language: 'Python' },
  '1': { technology: 'Django' },
};
const FLASK_HINTS: TechHints = {
  '0': { language: 'Python' },
  '1': { technology: 'Flask' },
};

describe('Python V3 pack wiring', () => {
  it('pythonLangPack.extract produces IR for a seeded .py file', () => {
    const files = new Map<string, string>([
      [
        'shop/models.py',
        `from django.db import models\n\nclass Book(models.Model):\n    title = models.CharField(max_length=200)\n`,
      ],
    ]);
    const irMap = pythonLangPack.extract(files, DJANGO_HINTS);
    expect(irMap.size).toBe(1);
    const ir = irMap.get('shop/models.py')!;
    expect(ir.language).toBe('python');
    expect(ir.classes.map((c) => c.name)).toEqual(['Book']);
  });

  it('pythonLangPack skips test files', () => {
    const files = new Map<string, string>([
      ['app/services.py', 'def calculate_total(): return 0\n'],
      ['app/tests/test_services.py', 'def test_it(): pass\n'],
      ['app/test_services.py', 'def test_it(): pass\n'],
      ['app/services_test.py', 'def test_it(): pass\n'],
      ['app/conftest.py', 'import pytest\n'],
    ]);
    const irMap = pythonLangPack.extract(files, DJANGO_HINTS);
    expect([...irMap.keys()]).toEqual(['app/services.py']);
  });

  it('djangoFrameworkPack.adapt produces candidates off seeded IR', () => {
    const files = new Map<string, string>([
      [
        'shop/models.py',
        `from django.db import models\n\nclass Author(models.Model):\n    name = models.CharField(max_length=100)\n    email = models.EmailField()\n`,
      ],
    ]);
    const irMap = pythonLangPack.extract(files, DJANGO_HINTS);
    const candidates = djangoFrameworkPack.adapt(
      irMap,
      'wiring-test',
      DJANGO_HINTS,
    );
    const entities = candidates.filter((c) => c.candidateType === 'physical_data_entities');
    expect(entities.map((e) => e.name)).toEqual(['Author']);
    // `_addedBy` tag preserved from V2 (django-adapter).
    expect(entities[0].data._addedBy).toBe('django-adapter');
  });

  it('flaskFrameworkPack.adapt emits candidates with the flask-adapter tag', () => {
    const files = new Map<string, string>([
      [
        'app/routes.py',
        `from flask import Flask\n\napp = Flask(__name__)\n\n@app.route('/')\ndef index():\n    return 'hello'\n\n@app.route('/users', methods=['GET', 'POST'])\ndef users():\n    return []\n`,
      ],
    ]);
    const irMap = pythonLangPack.extract(files, FLASK_HINTS);
    const candidates = flaskFrameworkPack.adapt(
      irMap,
      'wiring-test',
      FLASK_HINTS,
    );
    expect(candidates.length).toBeGreaterThan(0);
    // All candidates must be tagged with `_addedBy: 'flask-adapter'`.
    for (const c of candidates) {
      expect(c.data._addedBy).toBe('flask-adapter');
    }
  });

  it('pack ids are distinct and do not collide with other LanguagePacks / FrameworkPacks', () => {
    // LanguagePack ids must be globally unique so the registry does not
    // double-register. FrameworkPack ids similarly must be unique across
    // the two Python packs and the other language/framework packs.
    expect(pythonLangPack.id).toBe('python-lang');
    expect(javaLangPack.id).toBe('java-lang');
    expect(typescriptLangPack.id).toBe('typescript-lang');
    const langIds = new Set([
      pythonLangPack.id,
      javaLangPack.id,
      typescriptLangPack.id,
    ]);
    expect(langIds.size).toBe(3);

    const frameworkIds = [djangoFrameworkPack.id, flaskFrameworkPack.id];
    expect(new Set(frameworkIds).size).toBe(frameworkIds.length);
    expect(frameworkIds).toEqual(['django', 'flask']);
  });

  it('pythonLangPack does NOT match .java or non-Python source files (extension filter)', () => {
    // A file map containing only a .java file should yield an empty IR map
    // even when the Python hint is present — the language pack filters by
    // extension first.
    const files = new Map<string, string>([
      ['src/Foo.java', 'package foo; public class Foo {}'],
      ['src/bar.ts', 'export const bar = 1;'],
    ]);
    const irMap = pythonLangPack.extract(files, DJANGO_HINTS);
    expect(irMap.size).toBe(0);
  });

  it('django and flask framework packs have distinct technology predicates', () => {
    // The per-field AND predicate on `when` must distinguish Django vs Flask
    // — Django techHints (`{technology:'Django'}`) should not match the
    // flask pack, and vice-versa.
    expect(djangoFrameworkPack.when).toEqual({
      language: 'Python',
      technology: 'Django',
    });
    expect(flaskFrameworkPack.when).toEqual({
      language: 'Python',
      technology: 'Flask',
    });
  });
});
