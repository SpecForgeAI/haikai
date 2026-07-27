/**
 * Tests for the git-provider derivation helper.
 */

import { describe, it, expect } from 'vitest';
import { deriveGitProvider, GIT_PROVIDERS } from './gitProvider';

describe('deriveGitProvider', () => {
  it('derives github from github.com URLs', () => {
    expect(deriveGitProvider('https://github.com/acme/backend.git')).toBe('github');
  });

  it('derives gitlab from gitlab.com URLs', () => {
    expect(deriveGitProvider('https://gitlab.com/acme/backend.git')).toBe('gitlab');
  });

  it('derives gitlab from self-hosted / dedicated gitlab hosts', () => {
    expect(
      deriveGitProvider('https://example.gitlab-dedicated.com/examplegroup/platform/backend'),
    ).toBe('gitlab');
  });

  it('derives bitbucket from bitbucket.org URLs', () => {
    expect(deriveGitProvider('https://bitbucket.org/acme/backend.git')).toBe('bitbucket');
  });

  it('derives github from self-hosted github enterprise hosts', () => {
    expect(deriveGitProvider('git@github.acme.internal:team/repo.git')).toBe('github');
  });

  it('returns null when no provider can be inferred', () => {
    expect(deriveGitProvider('https://git.acme.internal/team/repo.git')).toBeNull();
    expect(deriveGitProvider('')).toBeNull();
    expect(deriveGitProvider('   ')).toBeNull();
  });

  it('only ever derives one of the three accepted providers', () => {
    const result = deriveGitProvider('https://gitlab.example.com/x.git');
    expect(result === null || GIT_PROVIDERS.includes(result)).toBe(true);
  });
});
