/**
 * Smoke test for the V3 Symfony pack pair.
 *
 * Spec: V3 Pack Migration Batch (Task Group 6)
 *
 * Migrated from direct `extractPhpIR` + `runSymfonyAdapter` invocation
 * to the V3 pack shape: `phpLangPack.extract` +
 * `symfonyFrameworkPack.adapt`. All assertions are preserved verbatim —
 * only the invocation shape changes (find-and-replace pattern
 * established in Task Group 2's `springBootAdapter.smoke.test.ts` and
 * re-used in later groups' smoke tests).
 */
import { phpLangPack } from '../services/extensionPacks/languagePacks/phpLangPack';
import { symfonyFrameworkPack } from '../services/extensionPacks/frameworkPacks/symfonyFrameworkPack';
import type { TechHints } from '../services/extensionPacks';

const SY_HINTS: TechHints = {
  '0': { language: 'PHP' },
  '1': { technology: 'Symfony' },
};

const CONTROLLER_SRC = `<?php
namespace App\\Controller;

use Symfony\\Bundle\\FrameworkBundle\\Controller\\AbstractController;
use Symfony\\Component\\Routing\\Annotation\\Route;

#[Route('/articles')]
class ArticleController extends AbstractController {
    #[Route('/', methods: ['GET'])]
    public function list() { return null; }

    #[Route('/{id}', methods: ['GET'])]
    public function show(int $id) { return null; }

    #[Route('/', methods: ['POST'])]
    public function create() { return null; }
}
`;

const ENTITY_SRC = `<?php
namespace App\\Entity;

use Doctrine\\ORM\\Mapping as ORM;

#[ORM\\Entity]
#[ORM\\Table(name: 'articles')]
class Article {
    #[ORM\\Id]
    #[ORM\\Column(type: 'integer')]
    private int $id;

    #[ORM\\Column(type: 'string')]
    private string $title;

    #[ORM\\ManyToOne(targetEntity: User::class)]
    private User $author;
}
`;

/**
 * Helper: run the full V3 pipeline (extract + adapt) for a set of file
 * sources. Mirrors the earlier "build IR list, then run adapter" two-step
 * shape but goes through `phpLangPack` + `symfonyFrameworkPack`.
 */
function runV3Pipeline(files: Map<string, string>, runId: string) {
  const irFiles = phpLangPack.extract(files, SY_HINTS);
  return symfonyFrameworkPack.adapt(irFiles, runId, SY_HINTS);
}

describe('Symfony adapter smoke tests', () => {
  it('emits interface + endpoints from #[Route] attributes', () => {
    const files = new Map<string, string>([
      ['src/Controller/ArticleController.php', CONTROLLER_SRC],
    ]);
    const c = runV3Pipeline(files, 'sy-smoke');
    expect(c.filter((x) => x.candidateType === 'interfaces').map((i) => i.name)).toContain('ArticleController');
    const eps = c.filter((x) => x.candidateType === 'endpoints').map((e) => e.name).sort();
    expect(eps).toContain('GET /articles/');
    expect(eps).toContain('GET /articles/{id}');
    expect(eps).toContain('POST /articles/');
  });

  it('emits physical_entity + physical_attribute from Doctrine ORM attributes', () => {
    const files = new Map<string, string>([
      ['src/Entity/Article.php', ENTITY_SRC],
    ]);
    const c = runV3Pipeline(files, 'sy-smoke');
    expect(c.filter((x) => x.candidateType === 'physical_data_entities').map((e) => e.name)).toContain('Article');
    const attrs = c.filter((x) => x.candidateType === 'physical_data_attributes').map((a) => a.name).sort();
    expect(attrs).toEqual(['id', 'title']);
    const rels = c.filter((x) => x.candidateType === 'logical_data_entity_relationships').map((r) => r.name);
    expect(rels).toContain('Article → User');
  });
});
