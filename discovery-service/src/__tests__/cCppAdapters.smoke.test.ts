/**
 * C / C++ adapter smoke tests.
 *
 * Migrated to V3 invocation in V3 Pack Migration Batch (Task Group 10,
 * task 10.10). Source map → `cppLangPack.extract(files, hints)` →
 * `wxwidgetsFrameworkPack.adapt` / `oatppFrameworkPack.adapt`. All
 * assertions preserved verbatim from the V2 invocation shape so smoke-
 * test parity is exact across the migration.
 *
 * The C language extractor smoke test is preserved verbatim — there is
 * no V3 C-classic LanguagePack (Spec spec-4 follow-up). The `extractCIR`
 * symbol is exercised directly here as it was under V2.
 *
 * Oatpp note: the V2 test passed a separately-constructed `Map<string,
 * string>` raw-source map directly to `runOatppAdapter`. The V3 path
 * routes raw source through the side-channel cache that
 * `cppLangPack.extract` populates before `oatppFrameworkPack.adapt`
 * runs. See `services/extensionPacks/languagePacks/cppLangPack/
 * rawSourceCache.ts` for the rationale on why Oatpp is the one
 * outlier in the V3 migration.
 */
import { extractCIR } from '../services/extensionPacks/languageExtractors/c';
import { cppLangPack } from '../services/extensionPacks/languagePacks/cppLangPack';
import { wxwidgetsFrameworkPack } from '../services/extensionPacks/frameworkPacks/wxwidgetsFrameworkPack';
import { oatppFrameworkPack } from '../services/extensionPacks/frameworkPacks/oatppFrameworkPack';
import type { TechHints } from '../services/extensionPacks';

const WX_HINTS: TechHints = {
  '0': { language: 'C++' },
  '1': { technology: 'wxWidgets' },
};

const OATPP_HINTS: TechHints = {
  '0': { language: 'C++' },
  '1': { technology: 'Oatpp' },
};

describe('C language extractor', () => {
  it('extracts structs and functions', () => {
    const SRC = `
#include <stdio.h>
struct Point { int x; int y; };
int add(int a, int b) { return a + b; }
`;
    const ir = extractCIR('foo.c', SRC);
    expect(ir).not.toBeNull();
    expect(ir!.classes.some((c) => c.name === 'Point')).toBe(true);
    expect(ir!.functions.some((f) => f.name === 'add')).toBe(true);
  });
});

describe('C++ language extractor + wxwidgets adapter', () => {
  it('emits ui_screen for wxFrame and ui_component for wxPanel', () => {
    const SRC = `
class MainWindow : public wxFrame {
public:
  MainWindow();
};
class SideBar : public wxPanel {
};
`;
    const sourceFiles = new Map<string, string>([['main.cpp', SRC]]);
    const irMap = cppLangPack.extract(sourceFiles, WX_HINTS);
    if (irMap.size === 0) throw new Error('parse fail');
    const c = wxwidgetsFrameworkPack.adapt(irMap, 'wx-smoke', WX_HINTS);
    expect(c.find((x) => x.candidateType === 'ui_screens' && x.name === 'MainWindow')).toBeDefined();
    expect(c.find((x) => x.candidateType === 'ui_components' && x.name === 'SideBar')).toBeDefined();
  });
});

describe('Oatpp adapter', () => {
  it('emits interface + endpoints via ENDPOINT macro regex', () => {
    const SRC = `
class UserController : public oatpp::web::server::api::ApiController {
public:
  ENDPOINT("GET", "/users/{id}", getUser, PATH(Int32, id)) { return nullptr; }
  ENDPOINT("POST", "/users", createUser) { return nullptr; }
};
`;
    const sourceFiles = new Map<string, string>([['user.cpp', SRC]]);
    // cppLangPack.extract populates the side-channel raw-source cache
    // that oatppFrameworkPack.adapt reads from for ENDPOINT-macro
    // regex scanning. tree-sitter-cpp is expected to fail on the
    // ENDPOINT macro bodies and emit no class_specifier nodes — that is
    // exactly the case the regex fallback was designed to cover.
    const irMap = cppLangPack.extract(sourceFiles, OATPP_HINTS);
    const c = oatppFrameworkPack.adapt(irMap, 'oa-smoke', OATPP_HINTS);
    expect(c.find((x) => x.candidateType === 'interfaces' && x.name === 'UserController')).toBeDefined();
    const eps = c.filter((x) => x.candidateType === 'endpoints').map((e) => e.name).sort();
    expect(eps).toContain('GET /users/{id}');
    expect(eps).toContain('POST /users');
  });
});
