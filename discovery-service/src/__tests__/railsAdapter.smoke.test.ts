/**
 * Smoke test for the V3 Rails pack pair.
 *
 * Spec: V3 Pack Migration Batch (Task Group 5)
 *
 * Migrated from direct `extractRubyIR` + `runRailsAdapter` invocation
 * to the V3 pack shape: `rubyLangPack.extract` +
 * `railsFrameworkPack.adapt`. All assertions are preserved verbatim —
 * only the invocation shape changes (find-and-replace pattern
 * established in Task Group 2's `springBootAdapter.smoke.test.ts` and
 * re-used in Task Group 4's `djangoAdapter.smoke.test.ts`).
 */
import { rubyLangPack } from '../services/extensionPacks/languagePacks/rubyLangPack';
import { railsFrameworkPack } from '../services/extensionPacks/frameworkPacks/railsFrameworkPack';
import type { TechHints } from '../services/extensionPacks';

const RAILS_HINTS: TechHints = {
  '0': { language: 'Ruby' },
  '1': { technology: 'Rails' },
};

const CONTROLLER_SRC = `
class UsersController < ApplicationController
  def index
    @users = User.all
  end

  def show
    @user = User.find(params[:id])
  end

  def create
    @user = User.new(user_params)
  end

  def update
  end

  def destroy
  end

  private

  def user_params
    params.require(:user).permit(:email, :name)
  end
end
`;

const MODEL_SRC = `
class User < ApplicationRecord
  has_many :posts
  has_many :comments, through: :posts
  has_one :profile
  belongs_to :team

  validates :email, presence: true
end
`;

/**
 * Helper: run the full V3 pipeline (extract + adapt) for a set of file
 * sources. Mirrors the earlier "build IR list, then run adapter" two-step
 * shape but goes through `rubyLangPack` + `railsFrameworkPack`.
 */
function runV3Pipeline(files: Map<string, string>, runId: string) {
  const irFiles = rubyLangPack.extract(files, RAILS_HINTS);
  return railsFrameworkPack.adapt(irFiles, runId, RAILS_HINTS);
}

describe('Rails V3 pack pair smoke tests', () => {
  const files = new Map<string, string>([
    ['app/controllers/users_controller.rb', CONTROLLER_SRC],
    ['app/models/user.rb', MODEL_SRC],
  ]);

  it('emits interface for *Controller classes', () => {
    const c = runV3Pipeline(files, 'rl-smoke');
    const ifaces = c.filter((x) => x.candidateType === 'interfaces').map((i) => i.name);
    expect(ifaces).toContain('UsersController');
  });

  it('emits endpoints for conventional REST action methods', () => {
    const c = runV3Pipeline(files, 'rl-smoke');
    const eps = c.filter((x) => x.candidateType === 'endpoints').map((e) => e.name).sort();
    expect(eps).toContain('GET /users');
    expect(eps).toContain('GET /users/:id');
    expect(eps).toContain('POST /users');
    expect(eps).toContain('PUT /users/:id');
    expect(eps).toContain('DELETE /users/:id');
  });

  it('emits physical_entity for ApplicationRecord subclass', () => {
    const c = runV3Pipeline(files, 'rl-smoke');
    const ents = c.filter((x) => x.candidateType === 'physical_data_entities').map((e) => e.name);
    expect(ents).toContain('User');
  });

  it('emits entity_relationship for has_many / has_one / belongs_to', () => {
    const c = runV3Pipeline(files, 'rl-smoke');
    const rels = c.filter((x) => x.candidateType === 'logical_data_entity_relationships').map((r) => r.name).sort();
    expect(rels).toContain('User → Post');
    expect(rels).toContain('User → Profile');
    expect(rels).toContain('User → Team');
  });
});
