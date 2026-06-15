/**
 * Pure unit tests for codeDetectionMappers.ts
 *
 * Spec 2 (2026-05-10): Code Detection Detail Mappers — Task Group 1.1
 *
 * Strict scope: pure module tests over the mapper layer. No React, no
 * rendering, no mocks (`vi.mock`). The module has no React, CSS, or API
 * imports, so test seams are not required.
 */

import { describe, it, expect } from 'vitest';
import type { DiscoveryCandidateDto } from '../../../api/discoveryApi';
import {
  buildEndpointCodeDetails,
  buildInterfaceCodeDetails,
  buildLogicalDataEntityCodeDetails,
  buildInterfaceLogicalEntityCodeDetails,
  buildCodeDetectionDetails,
  formatAdapterDisplayName,
} from '../codeDetectionMappers';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeCandidate(
  candidateType: string,
  data: Record<string, unknown>,
  sourceClusterIds: string[] = ['src/main/java/Sample.java']
): DiscoveryCandidateDto {
  return {
    id: 'cand-1',
    run_id: 'run-1',
    candidate_type: candidateType,
    name: 'Sample',
    confidence: 0.9,
    status: 'proposed',
    source_cluster_ids: sourceClusterIds,
    data,
    synthesized_at: '2026-05-10T00:00:00Z',
    parent_candidate_id: null,
    review_status: 'pending_review',
    reviewed_by: null,
    reviewed_at: null,
    previous_review_status: null,
  };
}

function fieldLabels(display: { fields: { label: string }[] }): string[] {
  return display.fields.map((f) => f.label);
}

function fieldByLabel(
  display: { fields: { label: string; value: string | string[] }[] },
  label: string
): { label: string; value: string | string[] } | undefined {
  return display.fields.find((f) => f.label === label);
}

// ---------------------------------------------------------------------------
// buildEndpointCodeDetails
// ---------------------------------------------------------------------------

describe('buildEndpointCodeDetails', () => {
  it('server-shape Spring Boot happy path emits ordered server fields and the controller reason string', () => {
    const candidate = makeCandidate('endpoints', {
      _addedBy: 'spring-boot-adapter',
      httpMethod: 'GET',
      fullPath: '/owners/{ownerId}',
      controllerClassName: 'OwnerController',
      methodName: 'getOwner',
      requestBodyType: 'OwnerCreateDto',
      responseType: 'OwnerDto',
      pathVariables: [{ name: 'ownerId', type: 'int' }],
      requestParams: [{ name: 'petId', type: 'int', required: true, defaultValue: '1' }],
      security: { annotation: '@PreAuthorize', expression: "hasRole('USER')" },
      openApiOperation: { operationId: 'getOwner', summary: 'Get an owner' },
      transactional: { declared: true, propagation: 'REQUIRED' },
    });

    const display = buildEndpointCodeDetails(candidate);

    expect(display.reason).toBe(
      'Detected as a controller method exposed through framework route annotations.'
    );
    expect(fieldLabels(display)).toEqual([
      'HTTP method',
      'Path',
      'Controller',
      'Handler method',
      'Request body type',
      'Response type',
      'Path variables',
      'Request parameters',
      'Security',
      'OpenAPI operation',
      'Transactional',
    ]);
    expect(fieldByLabel(display, 'HTTP method')?.value).toBe('GET');
    expect(fieldByLabel(display, 'Path')?.value).toBe('/owners/{ownerId}');
    expect(fieldByLabel(display, 'Controller')?.value).toBe('OwnerController');
    expect(fieldByLabel(display, 'Handler method')?.value).toBe('getOwner');
    expect(fieldByLabel(display, 'Response type')?.value).toBe('OwnerDto');
    expect(fieldByLabel(display, 'Path variables')?.value).toEqual(['ownerId: int']);
    expect(fieldByLabel(display, 'Request parameters')?.value).toEqual([
      'petId: int (required, default=1)',
    ]);
    expect(fieldByLabel(display, 'Security')?.value).toBe('@PreAuthorize');
    expect(fieldByLabel(display, 'OpenAPI operation')?.value).toBe('getOwner');
    expect(fieldByLabel(display, 'Transactional')?.value).toBe('REQUIRED');
  });

  it('client-shape React/axios happy path switches reason text and emits URL/Calling function/API library/Response type', () => {
    const candidate = makeCandidate('endpoints', {
      _addedBy: 'react-axios-adapter',
      httpMethod: 'GET',
      url: '/api/owners/${id}',
      canonicalUrl: '/api/owners/{id}',
      apiLibrary: 'axios',
      callingFunction: 'OwnerService.fetch',
      responseType: 'OwnerDto',
    });

    const display = buildEndpointCodeDetails(candidate);

    expect(display.reason).toBe(
      'Detected as an HTTP call from frontend code making framework HTTP-client calls.'
    );
    expect(fieldLabels(display)).toEqual([
      'HTTP method',
      'URL',
      'Calling function',
      'API library',
      'Response type',
    ]);
    expect(fieldByLabel(display, 'URL')?.value).toBe('/api/owners/{id}');
    expect(fieldByLabel(display, 'Calling function')?.value).toBe('OwnerService.fetch');
    expect(fieldByLabel(display, 'API library')?.value).toBe('axios');
    expect(fieldByLabel(display, 'Response type')?.value).toBe('OwnerDto');
  });

  it('drops absent optional server fields silently (no requestBodyType, no pathVariables, no security)', () => {
    const candidate = makeCandidate('endpoints', {
      _addedBy: 'spring-classic-adapter',
      httpMethod: 'POST',
      fullPath: '/owners',
      controllerClassName: 'OwnerController',
      methodName: 'createOwner',
      returnType: 'OwnerDto',
    });

    const display = buildEndpointCodeDetails(candidate);

    expect(fieldLabels(display)).toEqual([
      'HTTP method',
      'Path',
      'Controller',
      'Handler method',
      'Response type',
    ]);
    // No empty labels at all
    for (const f of display.fields) {
      expect(f.label).not.toBe('');
      expect(f.value).not.toEqual('');
      expect(f.value).not.toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// buildInterfaceCodeDetails
// ---------------------------------------------------------------------------

describe('buildInterfaceCodeDetails', () => {
  it('selects the bean reason and emits Bean name / Bean return type / Configuration class on a spring-bean-definition', () => {
    const candidate = makeCandidate('interfaces', {
      _addedBy: 'spring-boot-adapter',
      interfaceSubtype: 'spring-bean-definition',
      beanName: 'dataSource',
      beanReturnType: 'javax.sql.DataSource',
      configurationClassName: 'AppConfig',
      packageName: 'com.example.config',
      scope: 'singleton',
      isPrimary: true,
      isLazy: false,
    });

    const display = buildInterfaceCodeDetails(candidate);

    expect(display.reason).toBe(
      'Detected as a Spring bean definition from a @Configuration class.'
    );
    expect(fieldLabels(display)).toEqual([
      'Bean name',
      'Bean return type',
      'Configuration class',
      'Package',
      'Scope',
      'Primary',
    ]);
    expect(fieldByLabel(display, 'Bean name')?.value).toBe('dataSource');
    expect(fieldByLabel(display, 'Bean return type')?.value).toBe('javax.sql.DataSource');
    expect(fieldByLabel(display, 'Configuration class')?.value).toBe('AppConfig');
    expect(fieldByLabel(display, 'Primary')?.value).toBe('true');
    // Lazy is false -> dropped
    expect(fieldByLabel(display, 'Lazy')).toBeUndefined();
  });

  it('selects the controller reason and emits Class / Interface type / Base path / Package on a standard Spring controller shape', () => {
    const candidate = makeCandidate('interfaces', {
      _addedBy: 'spring-boot-adapter',
      className: 'OwnerController',
      controllerType: 'RestController',
      basePath: '/owners',
      packageName: 'com.example.owners',
    });

    const display = buildInterfaceCodeDetails(candidate);

    expect(display.reason).toBe(
      'Detected as an interface/API surface from framework controller metadata.'
    );
    expect(fieldLabels(display)).toEqual(['Class', 'Interface type', 'Base path', 'Package']);
    expect(fieldByLabel(display, 'Class')?.value).toBe('OwnerController');
    expect(fieldByLabel(display, 'Interface type')?.value).toBe('RestController');
    expect(fieldByLabel(display, 'Base path')?.value).toBe('/owners');
    expect(fieldByLabel(display, 'Package')?.value).toBe('com.example.owners');
  });
});

// ---------------------------------------------------------------------------
// buildLogicalDataEntityCodeDetails
// ---------------------------------------------------------------------------

describe('buildLogicalDataEntityCodeDetails', () => {
  it('on a spring-* candidate emits only Type + Package and is NOT flagged as isMostlyEmpty', () => {
    const candidate = makeCandidate('logical_data_entities', {
      _addedBy: 'spring-boot-adapter',
      className: 'OwnerDto',
      packageName: 'com.example.owners.dto',
    });

    const display = buildLogicalDataEntityCodeDetails(candidate);

    expect(display.reason).toBe(
      'Detected as a logical data shape referenced by interface or endpoint code.'
    );
    expect(fieldLabels(display)).toEqual(['Type', 'Package']);
    expect(fieldByLabel(display, 'Type')?.value).toBe('OwnerDto');
    expect(fieldByLabel(display, 'Package')?.value).toBe('com.example.owners.dto');
  });

  it('on a reactAxios candidate with isInterface=true and extends emits TS-flavoured reason plus Kind + Extends', () => {
    const candidate = makeCandidate('logical_data_entities', {
      _addedBy: 'react-axios-adapter',
      className: 'OwnerDto',
      isInterface: true,
      extends: 'BaseDto',
    });

    const display = buildLogicalDataEntityCodeDetails(candidate);

    expect(display.reason).toBe(
      'Detected as a logical data shape from TypeScript or JavaScript model/type metadata.'
    );
    expect(fieldLabels(display)).toEqual(['Type', 'Kind', 'Extends']);
    expect(fieldByLabel(display, 'Type')?.value).toBe('OwnerDto');
    expect(fieldByLabel(display, 'Kind')?.value).toBe('interface');
    expect(fieldByLabel(display, 'Extends')?.value).toBe('BaseDto');
  });
});

// ---------------------------------------------------------------------------
// buildInterfaceLogicalEntityCodeDetails
// ---------------------------------------------------------------------------

describe('buildInterfaceLogicalEntityCodeDetails', () => {
  it('emits Interface + Logical data entity and the always-fallback reason string', () => {
    const candidate = makeCandidate('interface_logical_entities', {
      _addedBy: 'spring-boot-adapter',
      interfaceClassName: 'OwnerController',
      logicalEntityName: 'OwnerDto',
    });

    const display = buildInterfaceLogicalEntityCodeDetails(candidate);

    expect(display.reason).toBe(
      'Detected because interface code references this logical data entity.'
    );
    expect(fieldLabels(display)).toEqual(['Interface', 'Logical data entity']);
    expect(fieldByLabel(display, 'Interface')?.value).toBe('OwnerController');
    expect(fieldByLabel(display, 'Logical data entity')?.value).toBe('OwnerDto');
  });
});

// ---------------------------------------------------------------------------
// formatAdapterDisplayName
// ---------------------------------------------------------------------------

describe('formatAdapterDisplayName', () => {
  // Parameterised: all 18 known adapter values map to their explicit display names
  const KNOWN_ADAPTERS: Array<[string, string]> = [
    ['spring-boot-adapter', 'Spring Boot Adapter'],
    ['spring-classic-adapter', 'Spring Classic Adapter'],
    ['angular-adapter', 'Angular Adapter'],
    ['angularjs-classic-adapter', 'AngularJS Classic Adapter'],
    ['react-axios-adapter', 'React (axios/fetch) Adapter'],
    ['aspnetcore-adapter', 'ASP.NET Core Adapter'],
    ['aspnet-framework-adapter', 'ASP.NET Framework Adapter'],
    ['django-adapter', 'Django Adapter'],
    ['flask-adapter', 'Flask Adapter'],
    ['jquery-adapter', 'jQuery Adapter'],
    ['kratos-adapter', 'Kratos Adapter'],
    ['magento-adapter', 'Magento Adapter'],
    ['nestjs-adapter', 'NestJS Adapter'],
    ['oatpp-adapter', 'Oat++ Adapter'],
    ['rails-adapter', 'Rails Adapter'],
    ['symfony-adapter', 'Symfony Adapter'],
    ['wordpress-adapter', 'WordPress Adapter'],
    ['wxwidgets-adapter', 'wxWidgets Adapter'],
  ];

  it.each(KNOWN_ADAPTERS)('maps known adapter id %s to %s', (input, expected) => {
    expect(formatAdapterDisplayName(input)).toBe(expected);
  });

  it('falls back to title-cased segments + Adapter for unknown values', () => {
    expect(formatAdapterDisplayName('some-new-adapter')).toBe('Some New Adapter');
    expect(formatAdapterDisplayName('foo-bar-baz-adapter')).toBe('Foo Bar Baz Adapter');
    // No -adapter suffix still appends Adapter
    expect(formatAdapterDisplayName('plain-thing')).toBe('Plain Thing Adapter');
  });

  it('returns "deterministic code analysis" for null, undefined, and empty-string input', () => {
    expect(formatAdapterDisplayName(null)).toBe('deterministic code analysis');
    expect(formatAdapterDisplayName(undefined)).toBe('deterministic code analysis');
    expect(formatAdapterDisplayName('')).toBe('deterministic code analysis');
  });
});

// ---------------------------------------------------------------------------
// Source-file truncation (via the dispatcher to exercise the helper)
// ---------------------------------------------------------------------------

describe('source-file truncation', () => {
  it('with 7 paths plus a duplicate, returns 5 unique paths followed by "…and 3 more"', () => {
    const sources = [
      'a/1.java',
      'a/2.java',
      'a/3.java',
      'a/4.java',
      'a/5.java',
      'a/6.java',
      'a/7.java',
      'a/1.java', // duplicate of the first
    ];
    const candidate = makeCandidate(
      'endpoints',
      {
        _addedBy: 'spring-boot-adapter',
        httpMethod: 'GET',
        fullPath: '/x',
        controllerClassName: 'X',
        methodName: 'x',
      },
      sources
    );

    const display = buildCodeDetectionDetails(candidate);

    // 7 unique paths -> first 5 unique + "…and 3 more" (because original
    // length 8 exceeded 5; remaining unique after the 5 cap is 7-5 = 2 plus
    // we say "…and 3 more" per spec example which counts originalLen - cap).
    // Per spec wording: "with 7 source paths plus a duplicate, the mapper
    // output contains 5 unique paths followed by `…and 3 more`."
    expect(display.sourceFiles).toEqual([
      'a/1.java',
      'a/2.java',
      'a/3.java',
      'a/4.java',
      'a/5.java',
      '…and 3 more',
    ]);
  });
});
