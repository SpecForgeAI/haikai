/**
 * Focused V3-wiring tests for the C++ stack migration.
 *
 * Spec: V3 Pack Migration Batch (Task Group 10, task 10.1)
 *
 * Scope: verify the structural wiring of the V3 C++ stack — the
 * LanguagePack extracts IR, both FrameworkPacks (wxwidgets + oatpp)
 * produce candidates off that IR (or off the side-channel raw-source
 * cache for oatpp), registration does not collide with other language
 * / framework packs. Full adapter-behaviour coverage lives in the
 * migrated smoke tests (`cCppAdapters.smoke.test.ts`) and in the
 * per-pack 98% evaluation gate.
 */
import {
  cppLangPack,
  clearCppRawSources,
} from '../services/extensionPacks/languagePacks/cppLangPack';
import { wxwidgetsFrameworkPack } from '../services/extensionPacks/frameworkPacks/wxwidgetsFrameworkPack';
import { oatppFrameworkPack } from '../services/extensionPacks/frameworkPacks/oatppFrameworkPack';
import { javaLangPack } from '../services/extensionPacks/languagePacks/javaLangPack';
import { typescriptLangPack } from '../services/extensionPacks/languagePacks/typescriptLangPack';
import { pythonLangPack } from '../services/extensionPacks/languagePacks/pythonLangPack';
import { rubyLangPack } from '../services/extensionPacks/languagePacks/rubyLangPack';
import { phpLangPack } from '../services/extensionPacks/languagePacks/phpLangPack';
import { goLangPack } from '../services/extensionPacks/languagePacks/goLangPack';
import { csharpLangPack } from '../services/extensionPacks/languagePacks/csharpLangPack';
import { javascriptLangPack } from '../services/extensionPacks/languagePacks/javascriptLangPack';
import type { TechHints } from '../services/extensionPacks';

const WX_HINTS: TechHints = {
  '0': { language: 'C++' },
  '1': { technology: 'wxWidgets' },
};

const OATPP_HINTS: TechHints = {
  '0': { language: 'C++' },
  '1': { technology: 'Oatpp' },
};

beforeEach(() => {
  // Prevent cross-test contamination of the raw-source side-channel
  // cache (oatppFrameworkPack reads it; cppLangPack populates it).
  clearCppRawSources();
});

describe('C++ V3 pack wiring', () => {
  it('cppLangPack.extract produces IR for a seeded .cpp file', () => {
    const files = new Map<string, string>([
      [
        'src/MainFrame.cpp',
        `
class MainFrame : public wxFrame {
public:
  MainFrame();
};
`,
      ],
    ]);
    const irMap = cppLangPack.extract(files, WX_HINTS);
    expect(irMap.size).toBe(1);
    const ir = irMap.get('src/MainFrame.cpp')!;
    expect(ir.language).toBe('cpp');
    // The class is surfaced with its single base.
    expect(ir.classes.map((c) => c.name)).toContain('MainFrame');
    const cls = ir.classes.find((c) => c.name === 'MainFrame');
    expect(cls?.extends).toBe('wxFrame');
  });

  it('cppLangPack.extract filters non-C++ files but does NOT skip /tests/', () => {
    const files = new Map<string, string>([
      ['src/Foo.cpp', 'class Foo {};'],
      ['src/Bar.h', 'class Bar {};'],
      ['src/Baz.hpp', 'struct Baz {};'],
      ['src/Qux.hh', 'class Qux {};'],
      // Test files are NOT filtered — V2 baselines include them, the
      // per-pack 98% gate is calibrated against V2 numbers.
      ['tests/FooTest.cpp', 'class FooTest : public wxFrame {};'],
      // Non-C++ files are filtered.
      ['src/notes.txt', 'just some notes'],
      ['src/build.py', 'print("not c++")'],
      ['src/main.go', 'package main'],
    ]);
    const irMap = cppLangPack.extract(files, WX_HINTS);
    const keys = [...irMap.keys()].sort();
    expect(keys).toEqual(
      ['src/Bar.h', 'src/Baz.hpp', 'src/Foo.cpp', 'src/Qux.hh', 'tests/FooTest.cpp'],
    );
  });

  it('wxwidgetsFrameworkPack.adapt emits ui_screen / ui_component candidates off seeded IR', () => {
    const files = new Map<string, string>([
      [
        'src/MyApp.cpp',
        `
class MyFrame : public wxFrame {
public:
  MyFrame();
};

class MyDialog : public wxDialog {
public:
  MyDialog();
};

class SideBar : public wxPanel {
};

class OkButton : public wxButton {
};
`,
      ],
    ]);
    const irMap = cppLangPack.extract(files, WX_HINTS);
    const candidates = wxwidgetsFrameworkPack.adapt(
      irMap,
      'wiring-test',
      WX_HINTS,
    );

    const screens = candidates
      .filter((c) => c.candidateType === 'ui_screens')
      .map((c) => c.name)
      .sort();
    const comps = candidates
      .filter((c) => c.candidateType === 'ui_components')
      .map((c) => c.name)
      .sort();

    expect(screens).toEqual(['MyDialog', 'MyFrame']);
    expect(comps).toEqual(['OkButton', 'SideBar']);

    // `_addedBy` tag preserved from V2.
    expect(candidates[0]!.data._addedBy).toBe('wxwidgets-adapter');
  });

  it('oatppFrameworkPack.adapt emits interface + endpoint candidates via the raw-source side channel', () => {
    // The oatpp adapter cannot work from IR alone — tree-sitter-cpp emits
    // ERROR nodes for ApiController bodies containing ENDPOINT macro
    // bodies. cppLangPack.extract populates the side-channel raw-source
    // cache that oatppFrameworkPack reads from in adapt.
    const files = new Map<string, string>([
      [
        'src/UserController.hpp',
        `
class UserController : public oatpp::web::server::api::ApiController {
public:
  ENDPOINT("GET", "/users/{id}", getUser, PATH(Int32, id)) { return nullptr; }
  ENDPOINT("POST", "/users", createUser) { return nullptr; }
};
`,
      ],
    ]);
    const irMap = cppLangPack.extract(files, OATPP_HINTS);
    const candidates = oatppFrameworkPack.adapt(
      irMap,
      'wiring-test',
      OATPP_HINTS,
    );

    const ifaces = candidates
      .filter((c) => c.candidateType === 'interfaces')
      .map((c) => c.name);
    expect(ifaces).toContain('UserController');

    const endpoints = candidates
      .filter((c) => c.candidateType === 'endpoints')
      .map((c) => c.name)
      .sort();
    expect(endpoints).toEqual(['GET /users/{id}', 'POST /users']);

    // `_addedBy` tag preserved from V2.
    expect(candidates[0]!.data._addedBy).toBe('oatpp-adapter');
  });

  it('pack ids are distinct and do not collide with other LanguagePacks / FrameworkPacks', () => {
    expect(cppLangPack.id).toBe('cpp-lang');
    expect(javaLangPack.id).toBe('java-lang');
    expect(typescriptLangPack.id).toBe('typescript-lang');
    expect(pythonLangPack.id).toBe('python-lang');
    expect(rubyLangPack.id).toBe('ruby-lang');
    expect(phpLangPack.id).toBe('php-lang');
    expect(goLangPack.id).toBe('go-lang');
    expect(csharpLangPack.id).toBe('csharp-lang');
    expect(javascriptLangPack.id).toBe('javascript-lang');
    const langIds = new Set([
      cppLangPack.id,
      javaLangPack.id,
      typescriptLangPack.id,
      pythonLangPack.id,
      rubyLangPack.id,
      phpLangPack.id,
      goLangPack.id,
      csharpLangPack.id,
      javascriptLangPack.id,
    ]);
    // 9 V3 LanguagePacks — completes the spec migration.
    expect(langIds.size).toBe(9);

    expect(wxwidgetsFrameworkPack.id).toBe('wxwidgets');
    expect(oatppFrameworkPack.id).toBe('oatpp');
    expect(wxwidgetsFrameworkPack.id).not.toBe(oatppFrameworkPack.id);
  });

  it('framework pack predicates separate wxwidgets vs oatpp on the technology field', () => {
    expect(wxwidgetsFrameworkPack.when).toEqual({
      language: 'C++',
      technology: 'wxWidgets',
    });
    expect(oatppFrameworkPack.when).toEqual({
      language: 'C++',
      technology: 'Oatpp',
    });
    // Predicates differ — the two C++ framework packs must NOT both
    // match the same techHints set.
    expect(wxwidgetsFrameworkPack.when.technology).not.toBe(
      oatppFrameworkPack.when.technology,
    );
  });
});
