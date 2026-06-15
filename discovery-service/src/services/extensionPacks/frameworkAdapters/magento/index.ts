/**
 * Magento Framework Adapter — BASE/stub for Magento 1 (LTS) and Magento 2.
 *
 * Magento is notoriously convention-over-annotation. Most architectural
 * signals come from XML config files (config.xml, di.xml, routes.xml,
 * layout XML) which this pack does NOT parse. Class-level signals we do
 * detect:
 *
 *   class X extends Mage_Core_Controller_Front_Action         → interface (M1)
 *   class X extends \\Magento\\Framework\\App\\Action\\Action    → interface (M2)
 *   class X extends Mage_Core_Model_Abstract                  → physical_entity (M1 models)
 *   class X extends \\Magento\\Framework\\Model\\AbstractModel  → physical_entity (M2 models)
 *   class X implements BlockInterface / AbstractBlock         → ui_component (M2 blocks)
 *
 * GAPS: XML routing, etc/config.xml / etc/adminhtml.xml, module registration,
 * layout handles, dependency injection configuration all uncovered.
 */
import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { SourceFileIR, ClassIR } from '../../languageIR';

function makeCandidate(
  type: DiscoveryCandidate['candidateType'],
  name: string, filePath: string, data: Record<string, unknown>,
  runId: string,
): DiscoveryCandidate {
  return {
    id: uuidv4(), runId, candidateType: type, name, confidence: 0.7,
    status: 'proposed', sourceClusterIds: [filePath],
    data: { ...data, _addedBy: 'magento-adapter' },
    synthesizedAt: new Date().toISOString(),
  };
}

// PHP `use` imports resolve base-class names to short form at class-level
// (e.g. `use Magento\\Framework\\Model\\AbstractModel;` → extends `AbstractModel`).
// Match both fully-qualified and short-name variants.
const CONTROLLER_BASE_RE = /Mage_Core_Controller_|^Action$|Action\\Action$|AbstractAction$/;
const MODEL_BASE_RE = /^Mage_Core_Model_Abstract$|^AbstractModel$|^Framework.*AbstractModel$/;
const BLOCK_BASE_RE = /Mage_Core_Block_|^AbstractBlock$|^Template$/;

function classifyMagentoClass(cls: ClassIR, file: SourceFileIR, runId: string): DiscoveryCandidate | null {
  if (!cls.extends) return null;
  if (CONTROLLER_BASE_RE.test(cls.extends)) {
    return makeCandidate('interfaces', cls.name, file.filePath, {
      className: cls.name, controllerType: 'MagentoController',
    }, runId);
  }
  if (MODEL_BASE_RE.test(cls.extends)) {
    return makeCandidate('physical_data_entities', cls.name, file.filePath, {
      entityClassName: cls.name, tableName: cls.name.toLowerCase(),
    }, runId);
  }
  if (BLOCK_BASE_RE.test(cls.extends)) {
    return makeCandidate('ui_components', cls.name, file.filePath, {
      className: cls.name, component_type: 'other', magentoBlock: true,
    }, runId);
  }
  return null;
}

export function runMagentoAdapter(files: SourceFileIR[], runId: string): DiscoveryCandidate[] {
  const candidates: DiscoveryCandidate[] = [];
  for (const f of files) for (const cls of f.classes) {
    const c = classifyMagentoClass(cls, f, runId);
    if (c) candidates.push(c);
  }
  return candidates;
}
