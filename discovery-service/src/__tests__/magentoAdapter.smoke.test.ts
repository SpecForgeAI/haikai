/**
 * Smoke test for the V3 Magento pack pair.
 *
 * Spec: V3 Pack Migration Batch (Task Group 6)
 *
 * Migrated from direct `extractPhpLegacyIR` + `runMagentoAdapter`
 * invocation to the V3 pack shape: `phpLangPack.extract` +
 * `magentoFrameworkPack.adapt`. All assertions are preserved
 * verbatim — only the invocation shape changes.
 *
 * Note on `php-legacy` IR tag: the V2 smoke test used
 * `extractPhpLegacyIR` (which re-tagged the IR's `language` field as
 * `'php-legacy'`). The magento adapter does NOT inspect the
 * `language` field — it keys off `cls.extends` pattern matches — so
 * the single shared `phpLangPack` (producing `language: 'php'` IR) is
 * functionally equivalent.
 */
import { phpLangPack } from '../services/extensionPacks/languagePacks/phpLangPack';
import { magentoFrameworkPack } from '../services/extensionPacks/frameworkPacks/magentoFrameworkPack';
import type { TechHints } from '../services/extensionPacks';

const MAG_HINTS: TechHints = {
  '0': { language: 'PHP' },
  '1': { technology: 'Magento' },
};

const M1_CTRL = `<?php
class MyModule_IndexController extends Mage_Core_Controller_Front_Action {
  public function indexAction() {}
}
`;

const M2_MODEL = `<?php
namespace MyVendor\\MyModule\\Model;

use Magento\\Framework\\Model\\AbstractModel;

class Product extends AbstractModel {
}
`;

/**
 * Helper: run the full V3 pipeline (extract + adapt) for a set of file
 * sources. Mirrors the earlier "build IR list, then run adapter" two-step
 * shape but goes through `phpLangPack` + `magentoFrameworkPack`.
 */
function runV3Pipeline(files: Map<string, string>, runId: string) {
  const irFiles = phpLangPack.extract(files, MAG_HINTS);
  return magentoFrameworkPack.adapt(irFiles, runId, MAG_HINTS);
}

describe('Magento adapter smoke tests', () => {
  it('classifies Magento classes by base type', () => {
    const files = new Map<string, string>([
      ['app/code/MyModule/controllers/IndexController.php', M1_CTRL],
      ['app/code/MyVendor/MyModule/Model/Product.php', M2_MODEL],
    ]);
    const c = runV3Pipeline(files, 'mag-smoke');
    expect(c.find((x) => x.candidateType === 'interfaces' && x.name === 'MyModule_IndexController')).toBeDefined();
    expect(c.find((x) => x.candidateType === 'physical_data_entities' && x.name === 'Product')).toBeDefined();
  });
});
