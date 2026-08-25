/**
 * interface_logical_entities emission skips internally-filtered interfaces
 * (Kiro 2026-08-25). Bare-Java DAO/service interfaces are emitted as
 * `interfaces` candidates with springConfigKind 'service-api' and then
 * DROPPED by the stage-2 post-process (internal wiring is not an external
 * meta-model interface) — but their ILE links were still emitted, arriving
 * at save-back pointing at an interface that no longer exists (19 blocked
 * "Interface Class Name" rows with NO fillable value). A link from an
 * interface outside the external meta-model has no meaning: skip it at the
 * source. External (REST) interfaces keep their links.
 */
import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import { runSpringClassicAdapter } from '../services/extensionPacks/frameworkAdapters/springClassic';
import type { DiscoveryCandidate } from '../types/candidate';

function run(files: Array<{ path: string; src: string }>): DiscoveryCandidate[] {
  const irs = files.map((f) => {
    const ir = extractJavaIR(f.path, f.src);
    expect(ir).toBeTruthy();
    return ir!;
  });
  return runSpringClassicAdapter(irs, 'ile-run');
}

const OWNER_DTO = `package org.example.model;

public class OwnerDto {
  private String name;
  public String getName() { return name; }
  public void setName(String name) { this.name = name; }
}
`;

const OWNER_DAO = `package org.example.dao;

import org.example.model.OwnerDto;

public interface OwnerDao {
  OwnerDto getOwner(String id);
}
`;

const OWNER_CONTROLLER = `package org.example.web;

import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;
import org.example.model.OwnerDto;

@RestController
public class OwnerController {
  @GetMapping("/owners/{id}")
  public OwnerDto get(String id) { return null; }
}
`;

describe('ILE emission vs internally-filtered interfaces (Kiro 2026-08-25)', () => {
  it('emits no ILE link for a service-api DAO interface; the REST controller link survives', () => {
    const cands = run([
      { path: 'model/OwnerDto.java', src: OWNER_DTO },
      { path: 'dao/OwnerDao.java', src: OWNER_DAO },
      { path: 'web/OwnerController.java', src: OWNER_CONTROLLER },
    ]);

    // Precondition: the DAO interface IS emitted (as internal service-api
    // wiring — stage-2 post-process drops it later).
    const daoIface = cands.find(
      (c) => c.candidateType === 'interfaces' && c.name === 'OwnerDao',
    );
    expect(daoIface).toBeDefined();
    expect((daoIface!.data as Record<string, unknown>).springConfigKind).toBe('service-api');

    const ileNames = cands
      .filter((c) => c.candidateType === 'interface_logical_entities')
      .map((c) => c.name);
    // The dangling link is never born...
    expect(ileNames).not.toContain('OwnerDao → OwnerDto');
    // ...while the EXTERNAL interface's link is untouched.
    expect(ileNames).toContain('OwnerController → OwnerDto');
  });
});
