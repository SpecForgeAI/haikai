/**
 * Foundation tests for endpointPathNormalizer.
 *
 * Per Spec 5 Task 1.1, kept to a tight focused set covering the
 * critical behaviours: the three normalization tiers, slug-only
 * pass-through, and query-string stripping.
 */

import { normalizePath, canonicalEndpointPath } from '../endpointPathNormalizer';

describe('endpointPathNormalizer.normalizePath', () => {
  it('replaces a numeric segment with {id}', () => {
    expect(normalizePath('/users/123')).toBe('/users/{id}');
  });

  it('replaces a UUID segment with {id} (case-insensitive)', () => {
    expect(normalizePath('/orders/550e8400-e29b-41d4-a716-446655440000')).toBe('/orders/{id}');
    expect(normalizePath('/orders/550E8400-E29B-41D4-A716-446655440000')).toBe('/orders/{id}');
  });

  it('replaces a 16+ char token containing a digit with {id}', () => {
    expect(normalizePath('/objects/a1b2c3d4e5f6g7h8')).toBe('/objects/{id}');
  });

  it('leaves slug-only segments (no digits) unchanged', () => {
    expect(normalizePath('/products/my-product-name')).toBe('/products/my-product-name');
  });

  it('strips the query string before per-segment normalization', () => {
    expect(normalizePath('/users/123?x=1')).toBe('/users/{id}');
  });
});

describe('endpointPathNormalizer.canonicalEndpointPath — malformed-brace collapse', () => {
  // Root cause: a Java 8 / Spring-Classic + SOAP scan emitted the SAME logical
  // endpoint twice with DIFFERENT path strings — a well-formed `{businessDate}`
  // template (from the WADL pack) and a MALFORMED `businessDate}` template (the
  // opening `{` lost during upstream string assembly). With the old
  // balanced-only placeholder rule the two produced different canonical paths,
  // different Spec-0 identity keys, and the merge kept both. The hardened
  // canonicalizer collapses any partial/unbalanced-brace segment to the same
  // positional token as its well-formed twin so they share an identity key.

  it('collapses a missing-OPENING-brace twin to the well-formed canonical path', () => {
    // `businessDate}` is missing its leading `{`.
    const malformed = canonicalEndpointPath('/hierarchy/businessDate}/{grdOrgId}');
    const wellFormed = canonicalEndpointPath('/hierarchy/{businessDate}/{grdOrgId}');
    expect(malformed).toBe(wellFormed);
    expect(malformed).toBe('/hierarchy/{p}/{p}');
  });

  it('collapses the /hierarchynodes missing-brace twin with its well-formed form', () => {
    const malformed = canonicalEndpointPath('/hierarchynodes/businessDate}/{grdOrgId}');
    const wellFormed = canonicalEndpointPath('/hierarchynodes/{businessDate}/{grdOrgId}');
    expect(malformed).toBe(wellFormed);
    expect(malformed).toBe('/hierarchynodes/{p}/{p}');
  });

  it('collapses a missing-CLOSING-brace segment too', () => {
    // `{businessDate` is missing its trailing `}`.
    expect(canonicalEndpointPath('/hierarchy/{businessDate/{grdOrgId}')).toBe(
      canonicalEndpointPath('/hierarchy/{businessDate}/{grdOrgId}'),
    );
  });

  it('leaves a fully well-formed templated path unchanged in shape', () => {
    expect(canonicalEndpointPath('/owners/{ownerId}/pets/{petId}')).toBe(
      '/owners/{p}/pets/{p}',
    );
  });

  it('does NOT collapse a brace-LESS static path (real static segments preserved)', () => {
    // No `{`/`}` anywhere: every segment is static and must survive verbatim, so
    // a genuinely different static route stays a DISTINCT key.
    expect(canonicalEndpointPath('/hierarchy/lookup/active')).toBe(
      '/hierarchy/lookup/active',
    );
    expect(
      canonicalEndpointPath('/hierarchy/lookup/active') ===
        canonicalEndpointPath('/hierarchy/{businessDate}/{grdOrgId}'),
    ).toBe(false);
  });
});
