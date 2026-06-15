/**
 * Extension Pack Startup Registration
 *
 * Imports all available extension packs and registers them with the
 * extension pack registry at module load time (side-effect import).
 *
 * Architecture note — V3-only world (Spec: V3 Pack Migration Batch,
 * Task Groups 1 + 11):
 * - Every framework pack now lives in the V3 `LanguagePack` +
 *   `FrameworkPack` shape. Group 11 atomically deleted the V2 packs,
 *   the V2 registry surface (`packs[]`, `registerPack`, `runPacks`,
 *   `getApplicablePacks`), the legacy `ExtensionPack` type, and the
 *   `<framework>PackV2/` directories. Group 1 deleted the legacy v1
 *   directories (`extensionPacks/javaSpringBoot/`,
 *   `extensionPacks/reactTypescript/`).
 * - The `LanguagePack` + `FrameworkPack` registrations below are the
 *   only runtime extension-pack surface. Adding a new pack means
 *   appending another `registerLanguagePack` or `registerFrameworkPack`
 *   call here.
 *
 * Coverage by stack:
 * - Java: javaLangPack + springClassicFrameworkPack +
 *   springBootFrameworkPack.
 * - TypeScript: typescriptLangPack + reactTypescriptFrameworkPack +
 *   nestjsFrameworkPack + angularFrameworkPack.
 * - Python: pythonLangPack + djangoFrameworkPack + flaskFrameworkPack.
 * - Ruby: rubyLangPack + railsFrameworkPack.
 * - PHP: phpLangPack + wordpressFrameworkPack + symfonyFrameworkPack +
 *   magentoFrameworkPack.
 * - Go: goLangPack + kratosFrameworkPack.
 * - C#: csharpLangPack + aspNetCoreFrameworkPack +
 *   aspNetFrameworkFrameworkPack.
 * - JavaScript: javascriptLangPack + reactJavascriptFrameworkPack +
 *   jqueryFrameworkPack. Separate from typescriptLangPack because the
 *   extractors differ (filename rewrite + language re-tag, distinct
 *   file filter).
 * - C++: cppLangPack + wxwidgetsFrameworkPack + oatppFrameworkPack.
 *   Oatpp's adapter requires raw source text (for ENDPOINT-macro regex
 *   detection) — see `languagePacks/cppLangPack/rawSourceCache.ts` for
 *   the rationale.
 */

import {
  registerLanguagePack,
  registerFrameworkPack,
} from '../extensionPackRegistry';

// Java stack.
import { javaLangPack } from './languagePacks/javaLangPack/index';
import { springClassicFrameworkPack } from './frameworkPacks/springClassicFrameworkPack/index';
import { springBootFrameworkPack } from './frameworkPacks/springBootFrameworkPack/index';
// TypeScript stack.
import { typescriptLangPack } from './languagePacks/typescriptLangPack/index';
import { reactTypescriptFrameworkPack } from './frameworkPacks/reactTypescriptFrameworkPack/index';
import { nestjsFrameworkPack } from './frameworkPacks/nestjsFrameworkPack/index';
import { angularFrameworkPack } from './frameworkPacks/angularFrameworkPack/index';
// Python stack.
import { pythonLangPack } from './languagePacks/pythonLangPack/index';
import { djangoFrameworkPack } from './frameworkPacks/djangoFrameworkPack/index';
import { flaskFrameworkPack } from './frameworkPacks/flaskFrameworkPack/index';
// Ruby stack.
import { rubyLangPack } from './languagePacks/rubyLangPack/index';
import { railsFrameworkPack } from './frameworkPacks/railsFrameworkPack/index';
// PHP stack.
import { phpLangPack } from './languagePacks/phpLangPack/index';
import { wordpressFrameworkPack } from './frameworkPacks/wordpressFrameworkPack/index';
import { symfonyFrameworkPack } from './frameworkPacks/symfonyFrameworkPack/index';
import { magentoFrameworkPack } from './frameworkPacks/magentoFrameworkPack/index';
// Go stack.
import { goLangPack } from './languagePacks/goLangPack/index';
import { kratosFrameworkPack } from './frameworkPacks/kratosFrameworkPack/index';
// C# stack.
import { csharpLangPack } from './languagePacks/csharpLangPack/index';
import { aspNetCoreFrameworkPack } from './frameworkPacks/aspNetCoreFrameworkPack/index';
import { aspNetFrameworkFrameworkPack } from './frameworkPacks/aspNetFrameworkFrameworkPack/index';
// JavaScript stack.
import { javascriptLangPack } from './languagePacks/javascriptLangPack/index';
import { reactJavascriptFrameworkPack } from './frameworkPacks/reactJavascriptFrameworkPack/index';
import { jqueryFrameworkPack } from './frameworkPacks/jqueryFrameworkPack/index';
import { angularJsClassicFrameworkPack } from './frameworkPacks/angularJsClassicFrameworkPack/index';
// C++ stack.
import { cppLangPack } from './languagePacks/cppLangPack/index';
import { wxwidgetsFrameworkPack } from './frameworkPacks/wxwidgetsFrameworkPack/index';
import { oatppFrameworkPack } from './frameworkPacks/oatppFrameworkPack/index';

// Language pack registrations.
registerLanguagePack(javaLangPack);
registerLanguagePack(typescriptLangPack);
registerLanguagePack(pythonLangPack);
registerLanguagePack(rubyLangPack);
registerLanguagePack(phpLangPack);
registerLanguagePack(goLangPack);
registerLanguagePack(csharpLangPack);
registerLanguagePack(javascriptLangPack);
registerLanguagePack(cppLangPack);

// Framework pack registrations.
registerFrameworkPack(springClassicFrameworkPack);
registerFrameworkPack(springBootFrameworkPack);
registerFrameworkPack(reactTypescriptFrameworkPack);
registerFrameworkPack(nestjsFrameworkPack);
registerFrameworkPack(angularFrameworkPack);
registerFrameworkPack(djangoFrameworkPack);
registerFrameworkPack(flaskFrameworkPack);
registerFrameworkPack(railsFrameworkPack);
registerFrameworkPack(wordpressFrameworkPack);
registerFrameworkPack(symfonyFrameworkPack);
registerFrameworkPack(magentoFrameworkPack);
registerFrameworkPack(kratosFrameworkPack);
registerFrameworkPack(aspNetCoreFrameworkPack);
registerFrameworkPack(aspNetFrameworkFrameworkPack);
registerFrameworkPack(reactJavascriptFrameworkPack);
registerFrameworkPack(jqueryFrameworkPack);
registerFrameworkPack(angularJsClassicFrameworkPack);
registerFrameworkPack(wxwidgetsFrameworkPack);
registerFrameworkPack(oatppFrameworkPack);
