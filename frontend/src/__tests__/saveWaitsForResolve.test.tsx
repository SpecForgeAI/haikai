/**
 * Integration tests — Save waits for Tech-Hints resolve (Case B) + end-to-end
 * gateway round-trip + chip-removal -> PUT body assertion.
 *
 * Spec 2026-04-20: Tech Hints LLM Resolution — Task Group 7 (gap fill)
 *
 * These tests exercise the cross-component surface that no prior Group test
 * covers in isolation:
 *
 *   1. Frontend -> gateway relay end-to-end: TechHintsCell drives the real
 *      `gatewayClient.resolveTechHints` (not the service-level mock used in
 *      the Group 5 unit test) so we catch regressions in the POST body
 *      contract and the chip-render feedback loop that depends on the full
 *      fetch round-trip.
 *
 *   2. Save-waits-for-resolve (Case B, per spec Architecture Overview step
 *      #9): the user clicks Save while a resolve is in-flight; the
 *      `SaveWithPendingResolves` save button must hold the whole-model PUT
 *      until `Promise.allSettled(pending)` completes with the resolved
 *      fields patched into the row. Group 6's store-level tests verify the
 *      awaiting mechanics but do NOT wire the real TechHintsCell -> store
 *      registration path. This test closes that integration gap.
 *
 *   3. Chip-removal manual-override round-trip: removing a chip must push
 *      `core_tech_resolution_confidence: 'manual-override'` into the row
 *      patch so the next whole-model PUT carries the flag (snake-case per
 *      ServiceDto @JsonProperty). Group 5 asserts the onChange patch; this
 *      test asserts the downstream PUT body that the save pipeline would
 *      send (spec task 7.3 bullet).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, screen, waitFor } from '@testing-library/react';
import { useState, useRef, useEffect } from 'react';

import { TechHintsCell } from '../components/Grid/TechHintsCell';
import { SaveWithPendingResolves } from '../components/TopBar/SaveWithPendingResolves';
import { pendingResolutionsStore } from '../stores/pendingResolutionsStore';
import type { Service } from '../types/model';
import type { TechHintResolution } from '../types/techHints';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function buildService(overrides: Partial<Service> = {}): Service {
  return {
    id: 'svc-1',
    name: 'Orders',
    description: '',
    application_id: 'app-1',
    service_type: 'backend',
    core_tech: 'Java 21 (Spring Boot 3)',
    repo_location: 'https://github.com/acme/orders.git',
    repo_subfolder: 'services/orders',
    tags: '',
    ...overrides,
  };
}

function buildResolution(overrides: Partial<TechHintResolution> = {}): TechHintResolution {
  return {
    language: { name: 'Java', version: '21' },
    frameworks: [{ name: 'Spring Boot', version: '3' }],
    languagePack: 'java-21',
    frameworkPacks: ['spring-boot-3'],
    confirmationSentence: 'Detected Java 21 with Spring Boot 3.',
    repoCrossCheck: null,
    confidence: 'high',
    ...overrides,
  };
}

/**
 * Tiny harness that owns a mutable Service row (as the grid would) and
 * renders TechHintsCell + SaveWithPendingResolves. The `onSave` callback
 * reads from a ref to always reflect the latest row state — Save fires
 * AFTER resolves settle and React has re-rendered, but the `useCallback`
 * closure inside SaveWithPendingResolves captured `onSave` at click time,
 * so the outer closure needs a stable reference that reads the current row.
 */
function Harness(props: {
  initialService: Service;
  onSaveCalled: (service: Service) => void;
}) {
  const [service, setService] = useState<Service>(props.initialService);
  const serviceRef = useRef(service);
  useEffect(() => {
    serviceRef.current = service;
  }, [service]);

  const handleChange = (patch: Partial<Service>) => {
    setService((prev) => ({ ...prev, ...patch }));
  };

  const handleSave = () => {
    props.onSaveCalled(serviceRef.current);
  };

  return (
    <div>
      <TechHintsCell
        service={service}
        onChange={handleChange}
        onResolved={() => {}}
      />
      <SaveWithPendingResolves onSave={handleSave} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const realFetch = global.fetch;

beforeEach(() => {
  pendingResolutionsStore._resetForTests();
});

afterEach(() => {
  vi.useRealTimers();
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

// ===========================================================================
// 1. Frontend -> gateway end-to-end happy path (via real gatewayClient + mocked fetch)
// ===========================================================================

describe('TechHintsCell -> gatewayClient -> fetch (end-to-end happy path)', () => {
  it('posts to the gateway relay with the expected body and renders chips on success', async () => {
    vi.useFakeTimers();

    const resolution = buildResolution();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => resolution,
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const service = buildService();
    const onChange = vi.fn();

    const { container } = render(
      <TechHintsCell service={service} onChange={onChange} onResolved={() => {}} />
    );

    // Drive the edit + blur flow through the real component.
    fireEvent.doubleClick(
      container.querySelector('[data-testid="tech-hints-cell-display"]')!
    );
    const input = container.querySelector(
      '[data-testid="tech-hints-cell-input"]'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Java 21 (Spring Boot 3)' } });
    fireEvent.blur(input);

    // Advance past the 250 ms debounce.
    await act(async () => {
      vi.advanceTimersByTime(260);
    });
    // Flush the fetch promise chain.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The gateway relay route was hit exactly once with the spec-shaped body.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/api/v1/discovery/tech-hints/resolve');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body as string);
    expect(body.freeText).toBe('Java 21 (Spring Boot 3)');
    expect(body.repoLocation).toBe('https://github.com/acme/orders.git');
    expect(body.repoSubfolder).toBe('services/orders');

    // Row was patched with all 5 resolved fields.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        core_tech_language_pack: 'java-21',
        core_tech_framework_packs: ['spring-boot-3'],
        core_tech_resolution_confidence: 'high',
      })
    );
  });
});

// ===========================================================================
// 2. Case B: Save click during in-flight resolve is held until settlement.
//    Combines the real TechHintsCell (which registers in the store on blur)
//    with the real SaveWithPendingResolves (which awaits the store's
//    Promise.allSettled). Only this test wires both surfaces together.
// ===========================================================================

describe('Save waits for in-flight resolve (Case B)', () => {
  it('holds onSave until Promise.allSettled completes, then saves with resolved fields', async () => {
    vi.useFakeTimers();

    // Keep fetch unresolved until we explicitly settle it.
    let resolveFetch: (value: unknown) => void = () => {};
    const mockFetch = vi.fn().mockImplementationOnce(
      () =>
        new Promise((fetchResolve) => {
          resolveFetch = fetchResolve;
        })
    );
    global.fetch = mockFetch as unknown as typeof fetch;

    const savedService: Service[] = [];

    const { container } = render(
      <Harness
        initialService={buildService()}
        onSaveCalled={(svc) => savedService.push(svc)}
      />
    );

    // User types + blurs -> resolve request is in-flight.
    fireEvent.doubleClick(
      container.querySelector('[data-testid="tech-hints-cell-display"]')!
    );
    const input = container.querySelector(
      '[data-testid="tech-hints-cell-input"]'
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Java 21 (Spring Boot 3)' } });
    fireEvent.blur(input);

    await act(async () => {
      vi.advanceTimersByTime(260);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(pendingResolutionsStore.pendingCount()).toBe(1);

    // Flip to real timers so `waitFor` and fetch promise chains work normally.
    vi.useRealTimers();

    // User clicks Save WHILE the resolve is in-flight.
    const saveBtn = screen.getByTestId('save-button') as HTMLButtonElement;
    fireEvent.click(saveBtn);
    await Promise.resolve();

    // Save must NOT have fired yet — the promise is still pending.
    expect(savedService.length).toBe(0);

    // Now settle the fetch with the resolved body.
    const resolvedBody = buildResolution();
    resolveFetch({
      ok: true,
      status: 200,
      json: async () => resolvedBody,
    });

    // Save should fire exactly once, with the resolved fields merged into the row.
    await waitFor(() => {
      expect(savedService.length).toBe(1);
    });
    expect(savedService[0].core_tech_language_pack).toBe('java-21');
    expect(savedService[0].core_tech_framework_packs).toEqual(['spring-boot-3']);
    expect(savedService[0].core_tech_resolution_confidence).toBe('high');
  });
});

// ===========================================================================
// 3. Chip removal -> PUT body carries `core_tech_resolution_confidence: 'manual-override'`.
//    Exercises the full frontend save pipeline seam: the grid row gets patched
//    with the manual-override confidence after chip removal, then the parent
//    serialises the service into the whole-model PUT payload. We assert on the
//    outgoing PUT body rather than on intermediate props.
// ===========================================================================

describe('Chip removal -> whole-model PUT body (manual-override round-trip)', () => {
  it('PUT body contains core_tech_resolution_confidence=manual-override after chip removal', async () => {
    // Mock fetch for the whole-model PUT. Real timers throughout — no
    // debounce is exercised because we never type into the input.
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ filename: 'model.json' }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    const initial = buildService({
      core_tech_resolved: {
        language: { name: 'Java', version: '21' },
        frameworks: [{ name: 'Spring Boot', version: '3' }],
      } as Record<string, unknown>,
      core_tech_language_pack: 'java-21',
      core_tech_framework_packs: ['spring-boot-3'],
      core_tech_resolution_confidence: 'high',
      core_tech_resolved_at: '2026-04-20T00:00:00.000Z',
    });

    // Harness issues the PUT on Save with the same body shape
    // saveModelByFilename produces. A ref keeps onSave binding to the latest
    // service state because SaveWithPendingResolves captures onSave at click.
    function PutHarness() {
      const [service, setService] = useState<Service>(initial);
      const serviceRef = useRef(service);
      useEffect(() => {
        serviceRef.current = service;
      }, [service]);

      const handleChange = (patch: Partial<Service>) => {
        setService((prev) => ({ ...prev, ...patch }));
      };
      const doSave = async () => {
        const s = serviceRef.current;
        // Spec 2026-05-11: architecture-scoped save URL (project + architecture path segments)
        await fetch('/api/model/projects/proj-uuid-001/architectures/arch-uuid-001?filename=model.json', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            services: [
              {
                id: s.id,
                name: s.name,
                core_tech: s.core_tech,
                core_tech_resolved: s.core_tech_resolved,
                core_tech_language_pack: s.core_tech_language_pack,
                core_tech_framework_packs: s.core_tech_framework_packs,
                core_tech_resolution_confidence:
                  s.core_tech_resolution_confidence,
                core_tech_resolved_at: s.core_tech_resolved_at,
              },
            ],
          }),
        });
      };
      return (
        <div>
          <TechHintsCell
            service={service}
            onChange={handleChange}
            onResolved={() => {}}
          />
          <SaveWithPendingResolves onSave={doSave} />
        </div>
      );
    }

    const { container } = render(<PutHarness />);

    // Remove the language chip -> row flips into manual-override.
    const removeLang = container.querySelector(
      '[data-testid="tech-hints-chip-remove-language"]'
    ) as HTMLElement;
    expect(removeLang).toBeTruthy();
    fireEvent.click(removeLang);

    // Click Save; the store has no pending entries so Save fires synchronously.
    const saveBtn = screen.getByTestId('save-button') as HTMLButtonElement;
    fireEvent.click(saveBtn);

    // PUT was made with the manual-override flag on the service.
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled();
    });
    const [url, options] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/api/model/projects/proj-uuid-001/architectures/arch-uuid-001?filename=model.json');
    expect(options.method).toBe('PUT');
    const body = JSON.parse(options.body as string);
    const svcBody = body.services[0];
    // The frontend Service type (and the architecture-model-service
    // ServiceDto @JsonProperty) both use snake_case on the wire. Note:
    // tasks.md pseudocode uses camelCase `coreTechResolutionConfidence`
    // but the actual DTO contract is snake_case, which is what the
    // frontend Service type expresses.
    expect(svcBody.core_tech_resolution_confidence).toBe('manual-override');
    expect(svcBody.core_tech_language_pack).toBeNull();
  });
});
