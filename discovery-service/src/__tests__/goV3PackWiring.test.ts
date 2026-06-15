/**
 * Focused V3-wiring tests for the Go stack migration.
 *
 * Spec: V3 Pack Migration Batch (Task Group 7, task 7.1)
 *
 * Scope: verify the structural wiring of the V3 Go stack — the
 * LanguagePack extracts IR, the FrameworkPack produces candidates off
 * that IR, and registration does not collide with other language /
 * framework packs. Full adapter-behaviour coverage lives in the
 * migrated smoke test (`kratosAdapter.smoke.test.ts`) and in the
 * per-pack 98% evaluation gate.
 */
import { goLangPack } from '../services/extensionPacks/languagePacks/goLangPack';
import { kratosFrameworkPack } from '../services/extensionPacks/frameworkPacks/kratosFrameworkPack';
import { javaLangPack } from '../services/extensionPacks/languagePacks/javaLangPack';
import { typescriptLangPack } from '../services/extensionPacks/languagePacks/typescriptLangPack';
import { pythonLangPack } from '../services/extensionPacks/languagePacks/pythonLangPack';
import { rubyLangPack } from '../services/extensionPacks/languagePacks/rubyLangPack';
import { phpLangPack } from '../services/extensionPacks/languagePacks/phpLangPack';
import type { TechHints } from '../services/extensionPacks';

const KRATOS_HINTS: TechHints = {
  '0': { language: 'Go' },
  '1': { technology: 'Kratos' },
};

describe('Go V3 pack wiring', () => {
  it('goLangPack.extract produces IR for a seeded .go file', () => {
    const files = new Map<string, string>([
      [
        'internal/domain/user.go',
        `package domain

type User struct {
  ID   int    \`gorm:"primaryKey" json:"id"\`
  Name string \`json:"name"\`
}
`,
      ],
    ]);
    const irMap = goLangPack.extract(files, KRATOS_HINTS);
    expect(irMap.size).toBe(1);
    const ir = irMap.get('internal/domain/user.go')!;
    expect(ir.language).toBe('go');
    expect(ir.classes.map((c) => c.name)).toContain('User');
  });

  it('goLangPack skips _test.go and /vendor/ files', () => {
    // Note: the filter's vendor check looks for `/vendor/` substring
    // (slashes on both sides) so nested vendor paths are excluded.
    // Leaf-level `vendor/...` without a leading slash is handled at
    // the harness walker level (SKIP_DIRS in run-pack-local.ts). The
    // extractor filter is the second line of defence.
    const files = new Map<string, string>([
      [
        'internal/service/foo.go',
        `package service\n\ntype Foo struct { Name string \`json:"name"\` }\n`,
      ],
      [
        'internal/service/foo_test.go',
        `package service\n\nimport "testing"\n\nfunc TestFoo(t *testing.T) {}\n`,
      ],
      [
        'app/vendor/github.com/example/lib/lib.go',
        `package lib\n\ntype Dep struct { X int }\n`,
      ],
    ]);
    const irMap = goLangPack.extract(files, KRATOS_HINTS);
    expect([...irMap.keys()]).toEqual(['internal/service/foo.go']);
  });

  it('kratosFrameworkPack.adapt produces candidates off seeded IR', () => {
    const files = new Map<string, string>([
      [
        'internal/domain/order.go',
        `package domain

type Order struct {
  ID     int64  \`gorm:"primaryKey;column:id" json:"id"\`
  Status string \`gorm:"column:status" json:"status"\`
}

type CreateOrderReq struct {
  Status string \`json:"status"\`
}
`,
      ],
      [
        'internal/service/order.go',
        `package service

type OrderServiceServer interface {
  GetOrder(ctx context.Context, id int64) (*Order, error)
}
`,
      ],
    ]);
    const irMap = goLangPack.extract(files, KRATOS_HINTS);
    const candidates = kratosFrameworkPack.adapt(
      irMap,
      'wiring-test',
      KRATOS_HINTS,
    );

    // Physical entity for the gorm-tagged struct.
    const entities = candidates.filter((c) => c.candidateType === 'physical_data_entities');
    expect(entities.map((e) => e.name)).toContain('Order');

    // Logical entity for the json-only DTO struct.
    const logicals = candidates.filter((c) => c.candidateType === 'logical_data_entities');
    expect(logicals.map((l) => l.name)).toContain('CreateOrderReq');

    // Interface for the service-suffixed interface type.
    const ifaces = candidates.filter((c) => c.candidateType === 'interfaces');
    expect(ifaces.map((i) => i.name)).toContain('OrderServiceServer');

    // `_addedBy` tag preserved from V2 (kratos-adapter).
    expect(entities[0].data._addedBy).toBe('kratos-adapter');
  });

  it('pack ids are distinct and do not collide with other LanguagePacks / FrameworkPacks', () => {
    // LanguagePack ids must be globally unique so the registry does not
    // double-register. FrameworkPack id must be unique across packs.
    expect(goLangPack.id).toBe('go-lang');
    expect(javaLangPack.id).toBe('java-lang');
    expect(typescriptLangPack.id).toBe('typescript-lang');
    expect(pythonLangPack.id).toBe('python-lang');
    expect(rubyLangPack.id).toBe('ruby-lang');
    expect(phpLangPack.id).toBe('php-lang');
    const langIds = new Set([
      goLangPack.id,
      javaLangPack.id,
      typescriptLangPack.id,
      pythonLangPack.id,
      rubyLangPack.id,
      phpLangPack.id,
    ]);
    expect(langIds.size).toBe(6);

    expect(kratosFrameworkPack.id).toBe('kratos');
  });

  it('goLangPack does NOT match .java or other non-Go source files (extension filter)', () => {
    // A file map containing only a .java file and a .py file should yield
    // an empty IR map even when the Go hint is present — the language
    // pack filters by extension first.
    const files = new Map<string, string>([
      ['src/Foo.java', 'package foo; public class Foo {}'],
      ['src/bar.py', 'class Bar: pass'],
      ['src/baz.rb', 'class Baz; end'],
    ]);
    const irMap = goLangPack.extract(files, KRATOS_HINTS);
    expect(irMap.size).toBe(0);
  });

  it('kratosFrameworkPack predicate requires both Go + Kratos', () => {
    expect(kratosFrameworkPack.when).toEqual({
      language: 'Go',
      technology: 'Kratos',
    });
  });
});
