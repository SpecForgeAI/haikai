/**
 * Focused V3-wiring tests for the PHP stack migration.
 *
 * Spec: V3 Pack Migration Batch (Task Group 6, task 6.1)
 *
 * Scope: verify the structural wiring of the V3 PHP stack — the
 * LanguagePack extracts IR, each of the three FrameworkPacks produces
 * candidates off that IR, and registration does not collide with other
 * language / framework packs. Full adapter-behaviour coverage lives
 * in the migrated smoke tests (`wordpressAdapter.smoke.test.ts`,
 * `symfonyAdapter.smoke.test.ts`, `magentoAdapter.smoke.test.ts`) and
 * in the per-pack 98% evaluation gate.
 */
import { phpLangPack } from '../services/extensionPacks/languagePacks/phpLangPack';
import { wordpressFrameworkPack } from '../services/extensionPacks/frameworkPacks/wordpressFrameworkPack';
import { symfonyFrameworkPack } from '../services/extensionPacks/frameworkPacks/symfonyFrameworkPack';
import { magentoFrameworkPack } from '../services/extensionPacks/frameworkPacks/magentoFrameworkPack';
import { javaLangPack } from '../services/extensionPacks/languagePacks/javaLangPack';
import { typescriptLangPack } from '../services/extensionPacks/languagePacks/typescriptLangPack';
import { pythonLangPack } from '../services/extensionPacks/languagePacks/pythonLangPack';
import { rubyLangPack } from '../services/extensionPacks/languagePacks/rubyLangPack';
import type { TechHints } from '../services/extensionPacks';

const WP_HINTS: TechHints = {
  '0': { language: 'PHP' },
  '1': { technology: 'WordPress' },
};
const SYMFONY_HINTS: TechHints = {
  '0': { language: 'PHP' },
  '1': { technology: 'Symfony' },
};
const MAGENTO_HINTS: TechHints = {
  '0': { language: 'PHP' },
  '1': { technology: 'Magento' },
};

describe('PHP V3 pack wiring', () => {
  it('phpLangPack.extract produces IR for a seeded .php file', () => {
    const files = new Map<string, string>([
      [
        'src/Controller/FooController.php',
        `<?php
namespace App\\Controller;

class FooController {
  public function list(): array { return []; }
}
`,
      ],
    ]);
    const irMap = phpLangPack.extract(files, SYMFONY_HINTS);
    expect(irMap.size).toBe(1);
    const ir = irMap.get('src/Controller/FooController.php')!;
    expect(ir.language).toBe('php');
    expect(ir.classes.map((c) => c.name)).toEqual(['FooController']);
    expect(ir.packageOrNamespace).toBe('App\\Controller');
  });

  it('phpLangPack skips test/vendor files (lifted V2 filter semantics)', () => {
    // The V2 `filterPhpFiles` skips paths containing `/vendor/` or
    // `/node_modules/`. `isPhpTestFile` skips paths containing `/tests?/`
    // (leading slash required) OR files whose basename ends with
    // `Test.php` / `Spec.php`. Preserve those exact semantics on V3.
    const files = new Map<string, string>([
      ['src/App.php', '<?php class App {}'],
      // /tests/ path segment → skipped
      ['pkg/tests/AppTest.php', '<?php class AppTest {}'],
      // ends with Test.php → skipped even in src/
      ['src/FooTest.php', '<?php class FooTest {}'],
      // ends with Spec.php → skipped
      ['src/BarSpec.php', '<?php class BarSpec {}'],
      // /vendor/ segment → skipped by filterPhpFiles
      ['pkg/vendor/acme/Foo.php', '<?php class Foo {}'],
      // /node_modules/ segment → skipped by filterPhpFiles
      ['pkg/node_modules/js-pkg/file.php', '<?php class Pkg {}'],
    ]);
    const irMap = phpLangPack.extract(files, SYMFONY_HINTS);
    expect([...irMap.keys()]).toEqual(['src/App.php']);
  });

  it('wordpressFrameworkPack.adapt produces candidates off seeded IR', () => {
    const files = new Map<string, string>([
      [
        'wp-content/plugins/example/plugin.php',
        `<?php
function example_init() {
  register_rest_route('example/v1', '/items', array('methods' => 'GET'));
  register_post_type('widget', array('label' => 'Widgets'));
}

class Example_REST_Controller extends WP_REST_Controller {
  public function register_routes() {}
}
`,
      ],
    ]);
    const irMap = phpLangPack.extract(files, WP_HINTS);
    const candidates = wordpressFrameworkPack.adapt(
      irMap,
      'wiring-test',
      WP_HINTS,
    );
    const eps = candidates.filter((c) => c.candidateType === 'endpoints');
    expect(eps.length).toBeGreaterThanOrEqual(1);
    const entities = candidates.filter((c) => c.candidateType === 'physical_data_entities');
    expect(entities.map((e) => e.name)).toContain('widget');
    const ifaces = candidates.filter((c) => c.candidateType === 'interfaces');
    expect(ifaces.map((i) => i.name)).toContain('Example_REST_Controller');
    expect(candidates[0].data._addedBy).toBe('wordpress-adapter');
  });

  it('symfonyFrameworkPack.adapt produces candidates off seeded IR', () => {
    const files = new Map<string, string>([
      [
        'src/Controller/ArticleController.php',
        `<?php
namespace App\\Controller;

use Symfony\\Bundle\\FrameworkBundle\\Controller\\AbstractController;
use Symfony\\Component\\Routing\\Annotation\\Route;

#[Route('/articles')]
class ArticleController extends AbstractController {
  #[Route('/', methods: ['GET'])]
  public function list() { return null; }
}
`,
      ],
    ]);
    const irMap = phpLangPack.extract(files, SYMFONY_HINTS);
    const candidates = symfonyFrameworkPack.adapt(
      irMap,
      'wiring-test',
      SYMFONY_HINTS,
    );
    const ifaces = candidates.filter((c) => c.candidateType === 'interfaces');
    expect(ifaces.map((i) => i.name)).toContain('ArticleController');
    expect(candidates[0].data._addedBy).toBe('symfony-adapter');
  });

  it('magentoFrameworkPack.adapt produces candidates off seeded IR', () => {
    const files = new Map<string, string>([
      [
        'app/code/core/Mage/MyModule/Model/Product.php',
        `<?php
class MyModule_Model_Product extends Mage_Core_Model_Abstract {
  public function getName() { return ''; }
}
`,
      ],
      [
        'app/code/core/Mage/MyModule/controllers/IndexController.php',
        `<?php
class MyModule_IndexController extends Mage_Core_Controller_Front_Action {
  public function indexAction() {}
}
`,
      ],
    ]);
    const irMap = phpLangPack.extract(files, MAGENTO_HINTS);
    const candidates = magentoFrameworkPack.adapt(
      irMap,
      'wiring-test',
      MAGENTO_HINTS,
    );
    expect(candidates.find((c) => c.candidateType === 'physical_data_entities' && c.name === 'MyModule_Model_Product')).toBeDefined();
    expect(candidates.find((c) => c.candidateType === 'interfaces' && c.name === 'MyModule_IndexController')).toBeDefined();
    expect(candidates[0].data._addedBy).toBe('magento-adapter');
  });

  it('pack ids are distinct and do not collide with other LanguagePacks / FrameworkPacks', () => {
    // LanguagePack ids must be globally unique so the registry does not
    // double-register. FrameworkPack ids must be unique across packs.
    expect(phpLangPack.id).toBe('php-lang');
    expect(javaLangPack.id).toBe('java-lang');
    expect(typescriptLangPack.id).toBe('typescript-lang');
    expect(pythonLangPack.id).toBe('python-lang');
    expect(rubyLangPack.id).toBe('ruby-lang');
    const langIds = new Set([
      phpLangPack.id,
      javaLangPack.id,
      typescriptLangPack.id,
      pythonLangPack.id,
      rubyLangPack.id,
    ]);
    expect(langIds.size).toBe(5);

    expect(wordpressFrameworkPack.id).toBe('wordpress');
    expect(symfonyFrameworkPack.id).toBe('symfony');
    expect(magentoFrameworkPack.id).toBe('magento');
    const fwIds = new Set([
      wordpressFrameworkPack.id,
      symfonyFrameworkPack.id,
      magentoFrameworkPack.id,
    ]);
    expect(fwIds.size).toBe(3);
  });

  it('framework packs require both PHP + their technology predicate', () => {
    expect(wordpressFrameworkPack.when).toEqual({
      language: 'PHP',
      technology: 'WordPress',
    });
    expect(symfonyFrameworkPack.when).toEqual({
      language: 'PHP',
      technology: 'Symfony',
    });
    expect(magentoFrameworkPack.when).toEqual({
      language: 'PHP',
      technology: 'Magento',
    });
  });

  it('phpLangPack does NOT match non-PHP source files (extension filter)', () => {
    // Non-.php / non-.phtml files must be filtered out even when the PHP
    // hint is present — the language pack filters by extension first.
    const files = new Map<string, string>([
      ['src/Foo.java', 'package foo; public class Foo {}'],
      ['src/bar.py', 'class Bar: pass'],
      ['src/baz.rb', 'class Baz; end'],
    ]);
    const irMap = phpLangPack.extract(files, SYMFONY_HINTS);
    expect(irMap.size).toBe(0);
  });
});
