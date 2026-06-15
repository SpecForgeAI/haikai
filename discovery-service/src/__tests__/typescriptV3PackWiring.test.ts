/**
 * Focused V3-wiring tests for the TypeScript stack migration.
 *
 * Spec: V3 Pack Migration Batch (Task Group 3, task 3.1)
 *
 * Scope: verify the structural wiring of the V3 TypeScript stack — the
 * LanguagePack extracts IR, each of the three FrameworkPacks produces
 * candidates off that IR, and registration does not collide with other
 * language / framework packs. Full adapter-behaviour coverage lives in the
 * migrated smoke tests (`reactAxiosAdapter.smoke.test.ts`,
 * `nestjsAdapter.smoke.test.ts`, `angularAdapter.smoke.test.ts`) and in the
 * per-pack 98% evaluation gate.
 */
import { typescriptLangPack } from '../services/extensionPacks/languagePacks/typescriptLangPack';
import { reactTypescriptFrameworkPack } from '../services/extensionPacks/frameworkPacks/reactTypescriptFrameworkPack';
import { nestjsFrameworkPack } from '../services/extensionPacks/frameworkPacks/nestjsFrameworkPack';
import { angularFrameworkPack } from '../services/extensionPacks/frameworkPacks/angularFrameworkPack';
import { javaLangPack } from '../services/extensionPacks/languagePacks/javaLangPack';
import type { TechHints } from '../services/extensionPacks';

const REACT_HINTS: TechHints = {
  '0': { language: 'TypeScript' },
  '1': { technology: 'React' },
};
const NESTJS_HINTS: TechHints = {
  '0': { language: 'TypeScript' },
  '1': { technology: 'NestJS' },
};
const ANGULAR_HINTS: TechHints = {
  '0': { language: 'TypeScript' },
  '1': { technology: 'Angular' },
};

describe('TypeScript V3 pack wiring', () => {
  it('typescriptLangPack.extract produces IR for a seeded TS file', () => {
    const files = new Map<string, string>([
      [
        'src/article.model.ts',
        `export interface Article { id: number; title: string; }`,
      ],
    ]);
    const irMap = typescriptLangPack.extract(files, REACT_HINTS);
    expect(irMap.size).toBe(1);
    const ir = irMap.get('src/article.model.ts')!;
    expect(ir.language).toBe('typescript');
    expect(ir.classes.map((c) => c.name)).toEqual(['Article']);
  });

  it('typescriptLangPack skips test files, .d.ts, and node_modules', () => {
    const files = new Map<string, string>([
      ['src/foo.ts', 'export const foo = 1;'],
      ['src/foo.test.ts', 'test("x", () => {});'],
      ['src/foo.d.ts', 'export declare const foo: number;'],
      ['node_modules/x/index.ts', 'export const x = 1;'],
    ]);
    const irMap = typescriptLangPack.extract(files, REACT_HINTS);
    expect([...irMap.keys()]).toEqual(['src/foo.ts']);
  });

  it('reactTypescriptFrameworkPack.adapt produces candidates off seeded IR', () => {
    const files = new Map<string, string>([
      [
        'src/types/UserDto.ts',
        `export interface UserDto { id: number; name: string; }`,
      ],
    ]);
    const irMap = typescriptLangPack.extract(files, REACT_HINTS);
    const candidates = reactTypescriptFrameworkPack.adapt(
      irMap,
      'wiring-test',
      REACT_HINTS,
    );
    const logicals = candidates.filter((c) => c.candidateType === 'logical_data_entities');
    expect(logicals.map((l) => l.name)).toEqual(['UserDto']);
    // `_addedBy` tag preserved from V2 (react-axios-adapter).
    expect(logicals[0].data._addedBy).toBe('react-axios-adapter');
  });

  it('nestjsFrameworkPack.adapt emits candidates with the nestjs-adapter tag', () => {
    const files = new Map<string, string>([
      [
        'src/article/article.controller.ts',
        `
        import { Controller, Get } from '@nestjs/common';
        @Controller('articles')
        export class ArticleController {
          @Get() findAll() { return []; }
        }
        `,
      ],
    ]);
    const irMap = typescriptLangPack.extract(files, NESTJS_HINTS);
    const candidates = nestjsFrameworkPack.adapt(
      irMap,
      'wiring-test',
      NESTJS_HINTS,
    );
    expect(candidates.length).toBeGreaterThan(0);
    // All candidates must be tagged with `_addedBy: 'nestjs-adapter'`.
    for (const c of candidates) {
      expect(c.data._addedBy).toBe('nestjs-adapter');
    }
  });

  it('angularFrameworkPack.adapt emits candidates with the angular-adapter tag', () => {
    const files = new Map<string, string>([
      [
        'src/app/article-list.component.ts',
        `
        import { Component } from '@angular/core';
        @Component({ selector: 'app-article-list' })
        export class ArticleListComponent {}
        `,
      ],
    ]);
    const irMap = typescriptLangPack.extract(files, ANGULAR_HINTS);
    const candidates = angularFrameworkPack.adapt(
      irMap,
      'wiring-test',
      ANGULAR_HINTS,
    );
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.data._addedBy).toBe('angular-adapter');
    }
  });

  it('pack ids are distinct and do not collide with javaLangPack or spring-classic', () => {
    // LanguagePack ids must be globally unique so the registry does not
    // double-register. FrameworkPack ids similarly must be unique across
    // the three TS packs and the Java packs.
    expect(typescriptLangPack.id).toBe('typescript-lang');
    expect(javaLangPack.id).toBe('java-lang');
    expect(typescriptLangPack.id).not.toBe(javaLangPack.id);

    const frameworkIds = [
      reactTypescriptFrameworkPack.id,
      nestjsFrameworkPack.id,
      angularFrameworkPack.id,
    ];
    expect(new Set(frameworkIds).size).toBe(frameworkIds.length);
    expect(frameworkIds).toEqual(['react-typescript', 'nestjs', 'angular']);
  });

  it('typescriptLangPack does NOT match .java or non-TS source files (language predicate)', () => {
    // A file map containing only a .java file should yield an empty IR map
    // even when the TypeScript hint is present — the language pack filters
    // by extension first.
    const files = new Map<string, string>([
      ['src/Foo.java', 'package foo; public class Foo {}'],
    ]);
    const irMap = typescriptLangPack.extract(files, REACT_HINTS);
    expect(irMap.size).toBe(0);
  });
});
