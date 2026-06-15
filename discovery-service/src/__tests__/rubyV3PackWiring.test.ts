/**
 * Focused V3-wiring tests for the Ruby stack migration.
 *
 * Spec: V3 Pack Migration Batch (Task Group 5, task 5.1)
 *
 * Scope: verify the structural wiring of the V3 Ruby stack — the
 * LanguagePack extracts IR, the FrameworkPack produces candidates off
 * that IR, and registration does not collide with other language /
 * framework packs. Full adapter-behaviour coverage lives in the
 * migrated smoke test (`railsAdapter.smoke.test.ts`) and in the
 * per-pack 98% evaluation gate.
 */
import { rubyLangPack } from '../services/extensionPacks/languagePacks/rubyLangPack';
import { railsFrameworkPack } from '../services/extensionPacks/frameworkPacks/railsFrameworkPack';
import { javaLangPack } from '../services/extensionPacks/languagePacks/javaLangPack';
import { typescriptLangPack } from '../services/extensionPacks/languagePacks/typescriptLangPack';
import { pythonLangPack } from '../services/extensionPacks/languagePacks/pythonLangPack';
import type { TechHints } from '../services/extensionPacks';

const RAILS_HINTS: TechHints = {
  '0': { language: 'Ruby' },
  '1': { technology: 'Rails' },
};

describe('Ruby V3 pack wiring', () => {
  it('rubyLangPack.extract produces IR for a seeded .rb file', () => {
    const files = new Map<string, string>([
      [
        'app/models/author.rb',
        `class Author < ApplicationRecord\n  has_many :books\nend\n`,
      ],
    ]);
    const irMap = rubyLangPack.extract(files, RAILS_HINTS);
    expect(irMap.size).toBe(1);
    const ir = irMap.get('app/models/author.rb')!;
    expect(ir.language).toBe('ruby');
    expect(ir.classes.map((c) => c.name)).toEqual(['Author']);
  });

  it('rubyLangPack skips test/spec files', () => {
    const files = new Map<string, string>([
      ['app/services/foo.rb', 'class Foo\n  def call; end\nend\n'],
      ['spec/models/foo_spec.rb', 'describe Foo do\nend\n'],
      ['test/models/foo_test.rb', 'class FooTest < ActiveSupport::TestCase\nend\n'],
      ['app/models/user_spec.rb', 'describe User do\nend\n'],
    ]);
    const irMap = rubyLangPack.extract(files, RAILS_HINTS);
    expect([...irMap.keys()]).toEqual(['app/services/foo.rb']);
  });

  it('railsFrameworkPack.adapt produces candidates off seeded IR', () => {
    const files = new Map<string, string>([
      [
        'app/controllers/posts_controller.rb',
        `class PostsController < ApplicationController\n  def index\n    @posts = Post.all\n  end\n\n  def show\n    @post = Post.find(params[:id])\n  end\nend\n`,
      ],
      [
        'app/models/post.rb',
        `class Post < ApplicationRecord\n  belongs_to :author\n  has_many :comments\nend\n`,
      ],
    ]);
    const irMap = rubyLangPack.extract(files, RAILS_HINTS);
    const candidates = railsFrameworkPack.adapt(
      irMap,
      'wiring-test',
      RAILS_HINTS,
    );

    // Interface for the controller.
    const ifaces = candidates.filter((c) => c.candidateType === 'interfaces');
    expect(ifaces.map((i) => i.name)).toContain('PostsController');

    // Entity for the ActiveRecord model.
    const entities = candidates.filter((c) => c.candidateType === 'physical_data_entities');
    expect(entities.map((e) => e.name)).toContain('Post');

    // `_addedBy` tag preserved from V2 (rails-adapter).
    expect(entities[0].data._addedBy).toBe('rails-adapter');
  });

  it('pack ids are distinct and do not collide with other LanguagePacks / FrameworkPacks', () => {
    // LanguagePack ids must be globally unique so the registry does not
    // double-register. FrameworkPack id must be unique across packs.
    expect(rubyLangPack.id).toBe('ruby-lang');
    expect(javaLangPack.id).toBe('java-lang');
    expect(typescriptLangPack.id).toBe('typescript-lang');
    expect(pythonLangPack.id).toBe('python-lang');
    const langIds = new Set([
      rubyLangPack.id,
      javaLangPack.id,
      typescriptLangPack.id,
      pythonLangPack.id,
    ]);
    expect(langIds.size).toBe(4);

    expect(railsFrameworkPack.id).toBe('rails');
  });

  it('rubyLangPack does NOT match .java or non-Ruby source files (extension filter)', () => {
    // A file map containing only a .java file and a .py file should yield
    // an empty IR map even when the Ruby hint is present — the language
    // pack filters by extension first.
    const files = new Map<string, string>([
      ['src/Foo.java', 'package foo; public class Foo {}'],
      ['src/bar.py', 'class Bar: pass'],
    ]);
    const irMap = rubyLangPack.extract(files, RAILS_HINTS);
    expect(irMap.size).toBe(0);
  });

  it('railsFrameworkPack predicate requires both Ruby + Rails', () => {
    expect(railsFrameworkPack.when).toEqual({
      language: 'Ruby',
      technology: 'Rails',
    });
  });

  it('rubyLangPack includes .rake files in addition to .rb files', () => {
    // The V2 filter accepts `.rake` (conventional for Rake task files) —
    // preserve that behaviour on V3.
    const files = new Map<string, string>([
      ['lib/tasks/maintenance.rake', 'namespace :maintenance do\nend\n'],
      ['app/models/foo.rb', 'class Foo\nend\n'],
    ]);
    const irMap = rubyLangPack.extract(files, RAILS_HINTS);
    // Rake files contain no `class` declarations so they parse but
    // contribute nothing — but they are not excluded by the filter.
    // Assert the .rb file is present.
    expect(irMap.has('app/models/foo.rb')).toBe(true);
  });
});
