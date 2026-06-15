/**
 * Unit tests for the new `interface_logical_entities` candidate type emitted
 * by the Spring Boot and Spring Classic framework adapters.
 *
 * Spec (2026-04-20 V3 type rename): each adapter emits one
 * `interface_logical_entities` candidate per (controller, DTO) pair the
 * controller references via a request body or response body. Granularity is
 * PER-INTERFACE — a controller with five endpoints all using the same DTO
 * yields ONE candidate, not five. The naming convention is
 * `InterfaceClass → LogicalDataEntityClass` (ASCII arrow U+2192, single spaces).
 */
import { javaLangPack } from '../services/extensionPacks/languagePacks/javaLangPack';
import { springBootFrameworkPack } from '../services/extensionPacks/frameworkPacks/springBootFrameworkPack';
import { springClassicFrameworkPack } from '../services/extensionPacks/frameworkPacks/springClassicFrameworkPack';
import type { TechHints } from '../services/extensionPacks';

const SPRING_BOOT_HINTS: TechHints = {
  '0': { language: 'Java' },
  '1': { technology: 'Spring Boot' },
};

const SPRING_CLASSIC_HINTS: TechHints = {
  '0': { language: 'Java' },
  '1': { technology: 'Spring' },
};

// OwnerController exposes 3 endpoints all referencing OwnerDto (via request
// body, response type, and a second response-body endpoint). Expectation:
// ONE interface_logical_entities candidate named "OwnerController → OwnerDto".
const CONTROLLER_MULTI_ENDPOINT_SRC = `
package org.example.owner;

import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;

@RestController
@RequestMapping("/owners")
public class OwnerController {

    @GetMapping("/{id}")
    public OwnerDto show(@PathVariable int id) { return null; }

    @PostMapping
    public OwnerDto create(@RequestBody OwnerDto dto) { return null; }

    @PutMapping("/{id}")
    public OwnerDto update(@PathVariable int id, @RequestBody OwnerDto dto) { return null; }
}
`;

// Controller that references TWO different DTOs — confirms per-(controller,
// DTO) pair granularity produces TWO interface_logical_entities candidates.
const CONTROLLER_MULTI_DTO_SRC = `
package org.example.shop;

import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;

@RestController
@RequestMapping("/shop")
public class ShopController {

    @GetMapping("/order")
    public OrderDto getOrder() { return null; }

    @PostMapping("/order")
    public OrderDto placeOrder(@RequestBody OrderRequest req) { return null; }
}
`;

const OWNER_DTO_SRC = `
package org.example.owner;

public class OwnerDto {
    public String firstName;
    public String lastName;
}
`;

const ORDER_DTO_SRC = `
package org.example.shop;

public class OrderDto {
    public String orderId;
    public int total;
}
`;

const ORDER_REQUEST_SRC = `
package org.example.shop;

public class OrderRequest {
    public String customerId;
}
`;

function fileMap(entries: Array<[string, string]>): Map<string, string> {
  return new Map(entries);
}

describe('springBootFrameworkPack interface_logical_entities emission', () => {
  test('emits a single interface_logical_entities candidate per (controller, DTO) pair regardless of endpoint count', () => {
    const files = fileMap([
      ['src/main/java/org/example/owner/OwnerController.java', CONTROLLER_MULTI_ENDPOINT_SRC],
      ['src/main/java/org/example/owner/OwnerDto.java', OWNER_DTO_SRC],
    ]);
    const ir = javaLangPack.extract(files, SPRING_BOOT_HINTS);
    const candidates = springBootFrameworkPack.adapt(ir, 'run-ile-1', SPRING_BOOT_HINTS);

    const ileCandidates = candidates.filter(
      (c) => c.candidateType === 'interface_logical_entities',
    );
    expect(ileCandidates).toHaveLength(1);
    expect(ileCandidates[0].name).toBe('OwnerController \u2192 OwnerDto');
    expect(ileCandidates[0].data.interfaceClassName).toBe('OwnerController');
    expect(ileCandidates[0].data.logicalEntityName).toBe('OwnerDto');
  });

  test('uses ASCII arrow U+2192 with exactly one space on each side', () => {
    const files = fileMap([
      ['src/main/java/org/example/owner/OwnerController.java', CONTROLLER_MULTI_ENDPOINT_SRC],
      ['src/main/java/org/example/owner/OwnerDto.java', OWNER_DTO_SRC],
    ]);
    const ir = javaLangPack.extract(files, SPRING_BOOT_HINTS);
    const candidates = springBootFrameworkPack.adapt(ir, 'run-ile-2', SPRING_BOOT_HINTS);

    const ile = candidates.find((c) => c.candidateType === 'interface_logical_entities');
    expect(ile).toBeDefined();
    expect(ile!.name).toMatch(/^OwnerController \u2192 OwnerDto$/);
    expect(ile!.name).not.toContain('->');
  });

  test('emits one candidate per distinct DTO when a controller references multiple DTOs', () => {
    const files = fileMap([
      ['src/main/java/org/example/shop/ShopController.java', CONTROLLER_MULTI_DTO_SRC],
      ['src/main/java/org/example/shop/OrderDto.java', ORDER_DTO_SRC],
      ['src/main/java/org/example/shop/OrderRequest.java', ORDER_REQUEST_SRC],
    ]);
    const ir = javaLangPack.extract(files, SPRING_BOOT_HINTS);
    const candidates = springBootFrameworkPack.adapt(ir, 'run-ile-3', SPRING_BOOT_HINTS);

    const ileCandidates = candidates
      .filter((c) => c.candidateType === 'interface_logical_entities')
      .map((c) => c.name)
      .sort();
    expect(ileCandidates).toEqual([
      'ShopController \u2192 OrderDto',
      'ShopController \u2192 OrderRequest',
    ]);
  });
});

describe('springClassicFrameworkPack interface_logical_entities emission', () => {
  test('emits a single interface_logical_entities candidate per (controller, DTO) pair', () => {
    const files = fileMap([
      ['src/main/java/org/example/owner/OwnerController.java', CONTROLLER_MULTI_ENDPOINT_SRC],
      ['src/main/java/org/example/owner/OwnerDto.java', OWNER_DTO_SRC],
    ]);
    const ir = javaLangPack.extract(files, SPRING_CLASSIC_HINTS);
    const candidates = springClassicFrameworkPack.adapt(ir, 'run-ile-4', SPRING_CLASSIC_HINTS);

    const ileCandidates = candidates.filter(
      (c) => c.candidateType === 'interface_logical_entities',
    );
    expect(ileCandidates).toHaveLength(1);
    expect(ileCandidates[0].name).toBe('OwnerController \u2192 OwnerDto');
  });
});
