/**
 * Smoke test for the V3 Kratos pack pair.
 *
 * Spec: V3 Pack Migration Batch (Task Group 7)
 *
 * Migrated from direct `extractGoIR` + `runKratosAdapter` invocation
 * to the V3 pack shape: `goLangPack.extract` +
 * `kratosFrameworkPack.adapt`. All assertions are preserved verbatim —
 * only the invocation shape changes (find-and-replace pattern
 * established in Task Group 2's `springBootAdapter.smoke.test.ts` and
 * re-used in Task Group 4's `djangoAdapter.smoke.test.ts`, Task Group
 * 5's `railsAdapter.smoke.test.ts`, and Task Group 6's PHP smoke
 * tests).
 */
import { goLangPack } from '../services/extensionPacks/languagePacks/goLangPack';
import { kratosFrameworkPack } from '../services/extensionPacks/frameworkPacks/kratosFrameworkPack';
import type { TechHints } from '../services/extensionPacks';

const KRATOS_HINTS: TechHints = {
  '0': { language: 'Go' },
  '1': { technology: 'Kratos' },
};

const STRUCT_SRC = `package domain

type User struct {
  ID        int    \`gorm:"primaryKey;column:id" json:"id"\`
  Username  string \`gorm:"column:username" json:"username"\`
  Email     string \`json:"email"\`
}

type CreateUserRequest struct {
  Username string \`json:"username"\`
  Email    string \`json:"email"\`
}
`;

const IFACE_SRC = `package service

type UserServiceServer interface {
  GetUser(ctx context.Context, id int) (*User, error)
  CreateUser(ctx context.Context, req *CreateUserRequest) (*User, error)
}
`;

/**
 * Helper: run the full V3 pipeline (extract + adapt) for a set of file
 * sources. Mirrors the earlier "build IR list, then run adapter" two-step
 * shape but goes through `goLangPack` + `kratosFrameworkPack`.
 */
function runV3Pipeline(files: Map<string, string>, runId: string) {
  const irFiles = goLangPack.extract(files, KRATOS_HINTS);
  return kratosFrameworkPack.adapt(irFiles, runId, KRATOS_HINTS);
}

describe('Kratos V3 pack pair smoke tests', () => {
  it('emits physical_entity for gorm-tagged struct, logical_entity for json-only struct', () => {
    const files = new Map<string, string>([
      ['internal/domain/user.go', STRUCT_SRC],
      ['internal/service/user_service.go', IFACE_SRC],
    ]);
    const c = runV3Pipeline(files, 'kr-smoke');

    const phys = c.filter((x) => x.candidateType === 'physical_data_entities').map((e) => e.name);
    expect(phys).toContain('User');

    const attrs = c.filter((x) => x.candidateType === 'physical_data_attributes' && x.data.entityClassName === 'User');
    expect(attrs.length).toBeGreaterThanOrEqual(2);
    const idAttr = attrs.find((a) => a.name === 'ID');
    expect(idAttr?.data.isPrimaryKey).toBe(true);

    const logs = c.filter((x) => x.candidateType === 'logical_data_entities').map((l) => l.name);
    expect(logs).toContain('CreateUserRequest');
  });

  it('emits interface for service-named interface types', () => {
    const files = new Map<string, string>([
      ['internal/service/user.go', IFACE_SRC],
    ]);
    const c = runV3Pipeline(files, 'kr-smoke');
    const ifaces = c.filter((x) => x.candidateType === 'interfaces').map((i) => i.name);
    expect(ifaces).toContain('UserServiceServer');
  });
});
