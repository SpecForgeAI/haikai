/**
 * Tests for Fix #6a: pre-save hook that ensures every Service has a derived
 * ApplicationPoint (target_type='SERVICE', target_ref_id=service.id).
 *
 * The hook is the front-end half of the "Service-without-save" UX fix:
 * a Service created in the Grid must carry a derived AP after the next save
 * so the discovery-service Service-rooted run can resolve a real AP UUID
 * via the by-target endpoint (Fix #5) without falling through to the
 * self-heal create branch.
 */

import { describe, it, expect } from 'vitest';
import {
  ensureDerivedApplicationPointForService,
  ensureDerivedApplicationPointsForServices,
  generateDerivedApplicationPointId,
} from '../applicationPointDerivation';
import type { ApplicationPoint, MetaModelEntities, Service } from '../../types/model';

function svc(id: string, name = id): Service {
  return {
    id,
    name,
    application_id: 'app-1',
  } as unknown as Service;
}

function emptyEntities(): MetaModelEntities {
  return {
    applications: [],
    app_components: [],
    services: [],
    classes: [],
    methods: [],
    libraries: [],
    application_points: [],
  } as unknown as MetaModelEntities;
}

describe('ensureDerivedApplicationPointForService (Fix #6a)', () => {
  it('returns a new derived AP when none exists', () => {
    const service = svc('svc-1', 'OrderService');
    const result = ensureDerivedApplicationPointForService(service, []);

    expect(result.isNew).toBe(true);
    expect(result.applicationPoint.id).toBe(
      generateDerivedApplicationPointId('SERVICE', 'svc-1')
    );
    expect(result.applicationPoint.target_type).toBe('SERVICE');
    expect(result.applicationPoint.target_ref_id).toBe('svc-1');
    expect(result.applicationPoint.kind).toBe('SERVICE');
  });

  it('returns the existing AP (isNew=false) when one matches by id', () => {
    const service = svc('svc-1');
    const existingId = generateDerivedApplicationPointId('SERVICE', 'svc-1');
    const existing: ApplicationPoint = {
      id: existingId,
      name: 'OrderService (Service)',
      description: '',
      kind: 'SERVICE',
      application_id: 'app-1',
      service_id: 'svc-1',
      target_type: 'SERVICE',
      target_ref_id: 'svc-1',
      point_type: '',
      tags: '',
    };

    const result = ensureDerivedApplicationPointForService(service, [existing]);
    expect(result.isNew).toBe(false);
    expect(result.applicationPoint.id).toBe(existingId);
  });

  it('returns the existing AP (isNew=false) when one matches by (target_type, target_ref_id) tuple even with non-conventional id', () => {
    const service = svc('svc-1');
    // Server-allocated UUID id rather than the convention `ap_derived_service_svc-1`.
    const existing: ApplicationPoint = {
      id: 'ap-server-allocated-uuid',
      name: 'OrderService',
      description: '',
      kind: 'SERVICE',
      application_id: 'app-1',
      service_id: 'svc-1',
      target_type: 'SERVICE',
      target_ref_id: 'svc-1',
      point_type: '',
      tags: '',
    };

    const result = ensureDerivedApplicationPointForService(service, [existing]);
    expect(result.isNew).toBe(false);
    expect(result.applicationPoint.id).toBe('ap-server-allocated-uuid');
  });
});

describe('ensureDerivedApplicationPointsForServices (Fix #6a)', () => {
  it('returns the entities unchanged when there are no services', () => {
    const entities = emptyEntities();
    const result = ensureDerivedApplicationPointsForServices(entities);
    expect(result).toBe(entities);
  });

  it('returns the entities unchanged when every service already has a derived AP', () => {
    const entities = emptyEntities();
    entities.services = [svc('svc-1'), svc('svc-2')];
    entities.application_points = [
      {
        id: generateDerivedApplicationPointId('SERVICE', 'svc-1'),
        name: 'svc-1', description: '', kind: 'SERVICE',
        application_id: 'app-1', service_id: 'svc-1',
        target_type: 'SERVICE', target_ref_id: 'svc-1',
        point_type: '', tags: '',
      },
      {
        id: generateDerivedApplicationPointId('SERVICE', 'svc-2'),
        name: 'svc-2', description: '', kind: 'SERVICE',
        application_id: 'app-1', service_id: 'svc-2',
        target_type: 'SERVICE', target_ref_id: 'svc-2',
        point_type: '', tags: '',
      },
    ];
    const result = ensureDerivedApplicationPointsForServices(entities);
    expect(result).toBe(entities);
  });

  it('appends a derived AP for each Service that lacks one', () => {
    const entities = emptyEntities();
    entities.services = [svc('svc-1'), svc('svc-2'), svc('svc-3')];
    // Only svc-2 has a derived AP.
    entities.application_points = [
      {
        id: generateDerivedApplicationPointId('SERVICE', 'svc-2'),
        name: 'svc-2', description: '', kind: 'SERVICE',
        application_id: 'app-1', service_id: 'svc-2',
        target_type: 'SERVICE', target_ref_id: 'svc-2',
        point_type: '', tags: '',
      },
    ];

    const result = ensureDerivedApplicationPointsForServices(entities);
    expect(result).not.toBe(entities);
    expect(result.application_points).toHaveLength(3);

    const ids = result.application_points.map(ap => ap.target_ref_id);
    expect(ids).toEqual(expect.arrayContaining(['svc-1', 'svc-2', 'svc-3']));

    // Every AP has target_type='SERVICE' targeting the matching service id.
    const newSvc1 = result.application_points.find(ap => ap.target_ref_id === 'svc-1');
    expect(newSvc1?.target_type).toBe('SERVICE');
    expect(newSvc1?.kind).toBe('SERVICE');
    expect(newSvc1?.id).toBe(generateDerivedApplicationPointId('SERVICE', 'svc-1'));
  });

  it('is idempotent across repeated invocations', () => {
    const entities = emptyEntities();
    entities.services = [svc('svc-1'), svc('svc-2')];

    const first = ensureDerivedApplicationPointsForServices(entities);
    const second = ensureDerivedApplicationPointsForServices(first);
    // Second invocation is a no-op (no Services lacking a derived AP).
    expect(second).toBe(first);
    expect(first.application_points).toHaveLength(2);
  });
});
