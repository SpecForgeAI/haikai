/**
 * Smoke test for the V3 WordPress pack pair.
 *
 * Spec: V3 Pack Migration Batch (Task Group 6)
 *
 * Migrated from direct `extractPhpIR` + `runWordpressAdapter`
 * invocation to the V3 pack shape: `phpLangPack.extract` +
 * `wordpressFrameworkPack.adapt`. All assertions are preserved
 * verbatim — only the invocation shape changes (find-and-replace
 * pattern established in Task Group 2's
 * `springBootAdapter.smoke.test.ts` and re-used in later groups'
 * smoke tests).
 */
import { phpLangPack } from '../services/extensionPacks/languagePacks/phpLangPack';
import { wordpressFrameworkPack } from '../services/extensionPacks/frameworkPacks/wordpressFrameworkPack';
import type { TechHints } from '../services/extensionPacks';

const WP_HINTS: TechHints = {
  '0': { language: 'PHP' },
  '1': { technology: 'WordPress' },
};

const PLUGIN_SRC = `<?php
function my_plugin_init() {
  register_rest_route('myplugin/v1', '/items', array(
    'methods' => 'GET',
    'callback' => 'get_items'
  ));

  register_rest_route('myplugin/v1', '/items/(?P<id>\\d+)', array(
    'methods' => 'POST',
    'callback' => 'update_item'
  ));

  register_post_type('book', array('label' => 'Books'));
  register_taxonomy('genre', 'book', array());
}
add_action('init', 'my_plugin_init');

class My_Book_REST_Controller extends WP_REST_Controller {
  public function register_routes() {}
}

class My_Dashboard_Widget extends WP_Widget {
  public function widget($args, $instance) {}
}
`;

/**
 * Helper: run the full V3 pipeline (extract + adapt) for a set of file
 * sources. Mirrors the earlier "build IR list, then run adapter" two-step
 * shape but goes through `phpLangPack` + `wordpressFrameworkPack`.
 */
function runV3Pipeline(files: Map<string, string>, runId: string) {
  const irFiles = phpLangPack.extract(files, WP_HINTS);
  return wordpressFrameworkPack.adapt(irFiles, runId, WP_HINTS);
}

describe('WordPress adapter smoke tests', () => {
  const files = new Map<string, string>([
    ['wp-content/plugins/myplugin/myplugin.php', PLUGIN_SRC],
  ]);

  it('emits endpoint candidates from register_rest_route calls', () => {
    const c = runV3Pipeline(files, 'wp-smoke');
    const eps = c.filter((x) => x.candidateType === 'endpoints').map((e) => e.name).sort();
    expect(eps.length).toBe(2);
    expect(eps.some((n) => n.includes('myplugin/v1/items'))).toBe(true);
  });

  it('emits physical_entity for custom post type + taxonomy', () => {
    const c = runV3Pipeline(files, 'wp-smoke');
    const names = c.filter((x) => x.candidateType === 'physical_data_entities').map((e) => e.name).sort();
    expect(names).toEqual(['book', 'genre']);
  });

  it('emits interface for classes extending WP_REST_Controller', () => {
    const c = runV3Pipeline(files, 'wp-smoke');
    const ifaces = c.filter((x) => x.candidateType === 'interfaces').map((i) => i.name);
    expect(ifaces).toContain('My_Book_REST_Controller');
  });

  it('emits ui_component for classes extending WP_Widget', () => {
    const c = runV3Pipeline(files, 'wp-smoke');
    const comps = c.filter((x) => x.candidateType === 'ui_components').map((i) => i.name);
    expect(comps).toContain('My_Dashboard_Widget');
  });
});
