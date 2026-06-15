/**
 * Unit tests for `deriveHierarchySuggestions` — the Create Product modal's
 * Product Hierarchy autocomplete (Spec 2026-06-06).
 *
 * Pure logic, no DOM: the distinct, non-empty hierarchy values of the products
 * in the organisation whose name matches, sorted; `[]` until an organisation is
 * identified.
 */
import { describe, it, expect } from 'vitest';
import { deriveHierarchySuggestions } from './createProjectHierarchy';
import type { ProjectDto } from '../../api/projectsApi';
import type { OrganisationDto } from '../../api/organisationsApi';

let seq = 0;
const product = (
  organisationId: string | null,
  projectHierarchy: string | null,
): ProjectDto =>
  ({
    id: `p${(seq += 1)}`,
    organisationId,
    projectHierarchy,
  }) as unknown as ProjectDto;

const org = (id: string, name: string): OrganisationDto =>
  ({ id, name }) as unknown as OrganisationDto;

const ORGS = [org('o1', 'Acme'), org('o2', 'Globex')];

describe('deriveHierarchySuggestions', () => {
  it('returns [] when no organisation name matches (or is blank)', () => {
    const projects = [product('o1', 'ClientA')];
    expect(deriveHierarchySuggestions(projects, ORGS, '')).toEqual([]);
    expect(deriveHierarchySuggestions(projects, ORGS, 'Unknown')).toEqual([]);
  });

  it('returns the distinct hierarchies of the MATCHED organisation only, sorted', () => {
    const projects = [
      product('o1', 'Internal'),
      product('o1', 'ClientA'),
      product('o2', 'OtherOrgHierarchy'), // different org — excluded
      product('o1', 'ClientA'), // duplicate within o1 — collapsed
    ];
    expect(deriveHierarchySuggestions(projects, ORGS, 'Acme')).toEqual([
      'ClientA',
      'Internal',
    ]);
  });

  it('excludes null, empty, and whitespace-only hierarchies', () => {
    const projects = [
      product('o1', 'ClientA'),
      product('o1', null),
      product('o1', '   '),
      product('o1', ''),
    ];
    expect(deriveHierarchySuggestions(projects, ORGS, 'Acme')).toEqual([
      'ClientA',
    ]);
  });

  it('matches the organisation name after trimming surrounding whitespace', () => {
    const projects = [product('o1', 'ClientA')];
    expect(deriveHierarchySuggestions(projects, ORGS, '  Acme  ')).toEqual([
      'ClientA',
    ]);
  });

  it('returns [] when the matched organisation has no products with a hierarchy', () => {
    const projects = [product('o2', 'GlobexHierarchy')];
    expect(deriveHierarchySuggestions(projects, ORGS, 'Acme')).toEqual([]);
  });
});
