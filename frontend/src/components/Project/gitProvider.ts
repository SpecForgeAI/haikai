/**
 * Git provider selection helpers.
 *
 * The implementation/verification service's `POST /projects/init` needs to know
 * which git provider backs the workspace (it picks the matching auth strategy +
 * token). The upstream accepts exactly three values; this module is the single
 * source of that vocabulary on the frontend plus a best-effort URL -> provider
 * derivation so the modal can pre-select the obvious choice.
 */

/** The three providers the IV service `/projects/init` endpoint accepts. */
export type GitProvider = 'github' | 'gitlab' | 'bitbucket';

/** Ordered list for rendering the dropdown (label derived per-option). */
export const GIT_PROVIDERS: GitProvider[] = ['github', 'gitlab', 'bitbucket'];

/** Human-readable labels for the dropdown options. */
export const GIT_PROVIDER_LABELS: Record<GitProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
};

/** Fallback when a URL matches none of the known providers. */
export const DEFAULT_GIT_PROVIDER: GitProvider = 'github';

/**
 * Best-effort derivation of the git provider from a repo URL. Matches on the
 * provider name appearing anywhere in the host/path (covers SaaS hosts like
 * `github.com` / `gitlab.com` / `bitbucket.org` AND self-hosted / dedicated
 * hosts like `natwest.gitlab-dedicated.com` or `github.acme.internal`).
 *
 * Returns `null` when no provider can be inferred so the caller can decide
 * whether to leave a prior manual choice intact or fall back to a default.
 */
export function deriveGitProvider(url: string): GitProvider | null {
  const u = (url || '').toLowerCase();
  if (!u.trim()) return null;
  // gitlab / bitbucket are checked before github because they are unambiguous;
  // ordering only matters for pathological URLs that name two providers.
  if (u.includes('gitlab')) return 'gitlab';
  if (u.includes('bitbucket')) return 'bitbucket';
  if (u.includes('github')) return 'github';
  return null;
}
