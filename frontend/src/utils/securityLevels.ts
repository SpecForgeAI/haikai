/**
 * Security association levels + value matching (Security health dashboard,
 * service-level association, 2026-07-19, Spec B of 3).
 *
 * The upload wizard associates findings at one of three hierarchy levels
 * (Application -> Application Component -> Service) and lets the user choose
 * which levels the Security Summary DISPLAYS (any non-empty subset of the
 * chain; multiple levels render nested). This module centralizes:
 *
 *   - the level + display-levels vocabulary;
 *   - per-level auto-resolution indexes for the wizard's value matcher
 *     (applications by id/name/abbreviation; components by id/name; services
 *     by id/name AND normalized repo URL -- service-level GitLab exports link
 *     by repo path, so `https://gitlab.x.com/grh/payments.git`,
 *     `git@gitlab.x.com:grh/payments` and `grh/payments` all collide);
 *   - picker options with parent context (service names collide across apps).
 */

import type { MetaModel } from '../types/model';

export type SecurityAssociationLevel = 'application' | 'application_component' | 'service';

export const ASSOCIATION_LEVELS: { value: SecurityAssociationLevel; label: string }[] = [
  { value: 'application', label: 'Application' },
  { value: 'application_component', label: 'Application component' },
  { value: 'service', label: 'Service / repo' },
];

export const DEFAULT_DISPLAY_LEVELS: SecurityAssociationLevel[] = ['application'];

/** Chain order, outermost first — display subsets nest in this order. */
export const LEVEL_ORDER: SecurityAssociationLevel[] = [
  'application',
  'application_component',
  'service',
];

/**
 * Normalize a repo URL/path to a comparable key: strips protocol, credentials,
 * the `git@host:` SSH form, a trailing `.git` and trailing slashes;
 * lowercases. `https://GitLab.x.com/GRH/Payments.git` ==
 * `git@gitlab.x.com:grh/payments` == `gitlab.x.com/grh/payments`.
 */
export function normalizeRepoUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim().toLowerCase();
  if (value.length === 0) return null;
  value = value.replace(/^[a-z+]+:\/\//, '');           // https:// ssh:// git+ssh://
  value = value.replace(/^([^@/]+)@([^:/]+)[:/]/, '$2/'); // git@host: -> host/
  value = value.replace(/\.git$/, '');
  value = value.replace(/\/+$/, '');
  return value.length === 0 ? null : value;
}

export interface LevelEntityOption {
  id: string;
  name: string;
  /** Parent context for disambiguation, e.g. "MRX / Core". Empty for apps. */
  contextLabel: string;
}

/**
 * Picker options for one association level, sorted by name, with parent
 * context resolved from the model ancestry.
 */
export function entityOptionsForLevel(
  metaModel: MetaModel,
  level: SecurityAssociationLevel,
): LevelEntityOption[] {
  const appName = new Map(metaModel.entities.applications.map((a) => [a.id, a.name]));
  const compById = new Map(metaModel.entities.app_components.map((c) => [c.id, c]));
  let options: LevelEntityOption[];
  if (level === 'application') {
    options = metaModel.entities.applications.map((a) => ({
      id: a.id,
      name: a.name,
      contextLabel: '',
    }));
  } else if (level === 'application_component') {
    options = metaModel.entities.app_components.map((c) => ({
      id: c.id,
      name: c.name,
      contextLabel: appName.get(c.application_id) ?? '',
    }));
  } else {
    options = metaModel.entities.services.map((s) => {
      const comp = s.app_component_id ? compById.get(s.app_component_id) : undefined;
      const app = appName.get(s.application_id) ?? (comp ? appName.get(comp.application_id) : undefined);
      const context = [app, comp?.name].filter(Boolean).join(' / ');
      return { id: s.id, name: s.name, contextLabel: context };
    });
  }
  return options.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Exact-match index for one level's auto-resolution: lowercased key ->
 * entity id. Applications key by id/name/abbreviation; components by id/name;
 * services by id/name AND their normalized repo URL (+ repo/subfolder).
 * First-registered key wins on collisions (ambiguity falls to manual pick).
 */
export function buildLevelMatchIndex(
  metaModel: MetaModel,
  level: SecurityAssociationLevel,
): Map<string, string> {
  const index = new Map<string, string>();
  const put = (key: string | null | undefined, id: string) => {
    if (!key) return;
    const normalized = key.trim().toLowerCase();
    if (normalized.length === 0) return;
    if (!index.has(normalized)) index.set(normalized, id);
  };
  if (level === 'application') {
    for (const app of metaModel.entities.applications) {
      put(app.id, app.id);
      put(app.name, app.id);
      put(app.abbreviation, app.id);
    }
  } else if (level === 'application_component') {
    for (const comp of metaModel.entities.app_components) {
      put(comp.id, comp.id);
      put(comp.name, comp.id);
    }
  } else {
    for (const service of metaModel.entities.services) {
      put(service.id, service.id);
      put(service.name, service.id);
      const repo = normalizeRepoUrl(service.repo_location);
      put(repo, service.id);
      if (repo && service.repo_subfolder) {
        put(`${repo}/${service.repo_subfolder.trim().toLowerCase().replace(/^\/+|\/+$/g, '')}`, service.id);
      }
    }
  }
  return index;
}

/**
 * Auto-resolve one linking value against the level index. Service-level
 * values ALSO try their repo-normalized form, so a file value like
 * `https://gitlab.x.com/grh/payments.git` matches a service whose
 * repo_location is `git@gitlab.x.com:grh/payments`.
 */
export function resolveAgainstIndex(
  index: Map<string, string>,
  level: SecurityAssociationLevel,
  value: string,
): string | null {
  const direct = index.get(value.trim().toLowerCase());
  if (direct) return direct;
  if (level === 'service') {
    const repoKey = normalizeRepoUrl(value);
    if (repoKey) {
      const byRepo = index.get(repoKey);
      if (byRepo) return byRepo;
    }
  }
  return null;
}
