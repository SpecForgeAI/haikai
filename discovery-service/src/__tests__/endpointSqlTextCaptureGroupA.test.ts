/**
 * Per-endpoint SQL TEXT capture (Data-Layer Fidelity 2, Task Group A).
 *
 * Spec: 2026-05-30 Data-Layer Fidelity 2 — Cross-Engine DB Capture
 * Completeness, Task Group A. Builds on Spec #1's data-effect path
 * (`endpointDataEffectResolver` / `endpointDataEffectCandidates`) and Spec #5's
 * committed `CallIR.args` / the existing `AnnotationIR.args`.
 *
 * Captures the ACTUAL query text per endpoint into the EXISTING
 * `endpoint_data_effects.path_metadata_json` JSONB (additive `query_text` +
 * `query_kind` keys -- no schema change), and attaches the verbatim SQL of an
 * UNRESOLVED native/dynamic chain to the `endpoint_data_effect_unresolved`
 * Finding's `detail` instead of discarding it.
 *
 * Focused coverage ONLY (per the spec's 2-8-test budget):
 *   (1) `@Query("SELECT o FROM Order o ...")` JPQL  -> query_kind 'jpql'  + verbatim text
 *   (2) `@Query(value="SELECT * FROM orders", nativeQuery=true)` -> query_kind 'native'
 *   (3) `jdbcTemplate.queryForList("SELECT ... FROM legacy_report")` -> query_kind 'jdbc_template'
 *       captured on the unresolved Finding (JdbcTemplate never resolves to an entity)
 *   (4) a MyBatis mapper `@Select("...")` (reachable @Repository DAO) -> query_kind 'mybatis'
 *   (5) an unresolved native/dynamic chain -> the `endpoint_data_effect_unresolved`
 *       Finding now carries the VERBATIM SQL in its `detail`
 *   (+) a Spring-Data derived query (no explicit SQL) carries NO query_text key
 *
 * This group touches the Java-parsing (tree-sitter) path, so it MUST be run in
 * isolation by path (a pre-existing combined-run tree-sitter fragility).
 *
 * Pure / offline: real Java source through `extractJavaIR`, then assert on the
 * resolver / candidate / finding output. No I/O, no LLM.
 */
import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import { buildEndpointDataEffectCandidates } from '../services/extensionPacks/frameworkAdapters/springClassic/endpointDataEffectCandidates';
import { resolveEndpointDataEffects } from '../services/extensionPacks/frameworkAdapters/springClassic/endpointDataEffectResolver';
import { runSpringClassicFindingScanner } from '../services/findings/packFindingScanners/springClassicFindingScanner';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';
import type { DiscoveryCandidate } from '../types/candidate';

// ---------------------------------------------------------------------------
// Shared fixtures.
// ---------------------------------------------------------------------------

const ORDER_ENTITY = `
package com.foo.model;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.Id;
@Entity
@Table(name = "orders")
public class Order {
  @Id
  private Long id;
  private String status;
}
`;

// Repository with BOTH a @Query JPQL method and a @Query(nativeQuery=true)
// method, PLUS a Spring-Data derived query (no @Query) for the negative case.
const ORDER_REPOSITORY = `
package com.foo.repo;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import com.foo.model.Order;
import java.util.List;
public interface OrderRepository extends JpaRepository<Order, Long> {
  @Query("SELECT o FROM Order o WHERE o.status = :status")
  List<Order> findByStatusQuery(String status);

  @Query(value = "SELECT * FROM orders WHERE total > ?1", nativeQuery = true)
  List<Order> findExpensive(double min);

  // Spring-Data derived query -- NO explicit SQL/JPQL string.
  List<Order> findByStatus(String status);
}
`;

const ORDER_SERVICE = `
package com.foo.service;
import org.springframework.stereotype.Service;
import com.foo.repo.OrderRepository;
import com.foo.model.Order;
import java.util.List;
@Service
public class OrderService {
  private final OrderRepository orderRepository;
  public OrderService(OrderRepository r) { this.orderRepository = r; }
  public List<Order> byStatusJpql(String s) { return orderRepository.findByStatusQuery(s); }
  public List<Order> expensive(double m) { return orderRepository.findExpensive(m); }
  public List<Order> derived(String s) { return orderRepository.findByStatus(s); }
}
`;

const ORDER_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import com.foo.service.OrderService;
import com.foo.model.Order;
import java.util.List;
@RestController
@RequestMapping("/orders")
public class OrderController {
  private final OrderService orderService;
  public OrderController(OrderService s) { this.orderService = s; }
  @GetMapping("/by-status-jpql")
  public List<Order> byStatusJpql(String s) { return orderService.byStatusJpql(s); }
  @GetMapping("/expensive")
  public List<Order> expensive(double m) { return orderService.expensive(m); }
  @GetMapping("/derived")
  public List<Order> derived(String s) { return orderService.derived(s); }
}
`;

function ir(...srcs: Array<[string, string]>): SourceFileIR[] {
  return srcs.map(([p, s]) => {
    const parsed = extractJavaIR(p, s);
    if (!parsed) throw new Error(`parse fail for ${p}`);
    return parsed;
  });
}

function dataOf(c: DiscoveryCandidate): Record<string, any> {
  return c.data as Record<string, any>;
}

function metaOf(c: DiscoveryCandidate): Record<string, any> {
  return dataOf(c).path_metadata_json as Record<string, any>;
}

// ===========================================================================
// 1 + 2 + (negative). @Query JPQL / native / derived-no-SQL on resolved edges.
// ===========================================================================

describe('@Query SQL text on the resolved path_metadata_json', () => {
  const files = () =>
    ir(
      ['web/OrderController.java', ORDER_CONTROLLER],
      ['service/OrderService.java', ORDER_SERVICE],
      ['repo/OrderRepository.java', ORDER_REPOSITORY],
      ['model/Order.java', ORDER_ENTITY],
    );

  it('captures a @Query JPQL string verbatim with query_kind "jpql"', () => {
    const cands = buildEndpointDataEffectCandidates(files(), 'r1');
    const edge = cands.find((c) => dataOf(c).endpointName === 'GET /orders/by-status-jpql');
    expect(edge).toBeDefined();
    const meta = metaOf(edge!);
    expect(meta.query_kind).toBe('jpql');
    // VERBATIM -- the extractor unquotes the annotation value; no normalization.
    expect(meta.query_text).toBe('SELECT o FROM Order o WHERE o.status = :status');
  });

  it('captures a @Query(nativeQuery=true) string with query_kind "native"', () => {
    const cands = buildEndpointDataEffectCandidates(files(), 'r1');
    const edge = cands.find((c) => dataOf(c).endpointName === 'GET /orders/expensive');
    expect(edge).toBeDefined();
    const meta = metaOf(edge!);
    expect(meta.query_kind).toBe('native');
    expect(meta.query_text).toBe('SELECT * FROM orders WHERE total > ?1');
  });

  it('does NOT add query_text/query_kind for a Spring-Data derived query (no explicit SQL)', () => {
    const cands = buildEndpointDataEffectCandidates(files(), 'r1');
    const edge = cands.find((c) => dataOf(c).endpointName === 'GET /orders/derived');
    expect(edge).toBeDefined();
    const meta = metaOf(edge!);
    // The derived-query edge still carries the hop list, but no SQL keys.
    expect(meta.hops.length).toBeGreaterThan(0);
    expect(meta.query_text).toBeUndefined();
    expect(meta.query_kind).toBeUndefined();
  });
});

// ===========================================================================
// 3 + 5. JdbcTemplate string SQL -> captured on the unresolved finding.
//
// A JdbcTemplate-backed chain never resolves to a data entity (it is the
// canonical `jdbc_template` UNRESOLVED escape), so its verbatim SQL is captured
// ON the `endpoint_data_effect_unresolved` Finding's `detail` instead of being
// discarded -- the migration sees the actual query even with no resolvable table.
// ===========================================================================

describe('JdbcTemplate string SQL -> verbatim on the unresolved finding', () => {
  const JDBC_SERVICE = `
package com.foo.service;
import org.springframework.stereotype.Service;
import org.springframework.jdbc.core.JdbcTemplate;
import java.util.List;
@Service
public class LegacyReportService {
  private final JdbcTemplate jdbcTemplate;
  public LegacyReportService(JdbcTemplate jdbcTemplate) { this.jdbcTemplate = jdbcTemplate; }
  public List<String> legacy() {
    return jdbcTemplate.queryForList("SELECT name FROM legacy_report WHERE active = 1", String.class);
  }
}
`;
  const JDBC_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import com.foo.service.LegacyReportService;
import java.util.List;
@RestController
@RequestMapping("/legacy")
public class LegacyReportController {
  private final LegacyReportService legacyReportService;
  public LegacyReportController(LegacyReportService s) { this.legacyReportService = s; }
  @GetMapping("/report")
  public List<String> report() { return legacyReportService.legacy(); }
}
`;

  const SQL = 'SELECT name FROM legacy_report WHERE active = 1';

  function jdbcFiles(): SourceFileIR[] {
    return ir(
      ['web/LegacyReportController.java', JDBC_CONTROLLER],
      ['service/LegacyReportService.java', JDBC_SERVICE],
    );
  }

  it('the resolver reports jdbc_template UNRESOLVED carrying the verbatim SQL (query_text + detail)', () => {
    const { resolved, unresolved } = resolveEndpointDataEffects(jdbcFiles());
    // No fabricated edge for the JdbcTemplate chain.
    expect(resolved).toHaveLength(0);
    const u = unresolved.find((x) => x.reason === 'jdbc_template');
    expect(u).toBeDefined();
    expect(u!.endpointName).toBe('GET /legacy/report');
    // Verbatim SQL captured on the unresolved result (the field AND appended
    // to the human-readable detail).
    expect(u!.queryText).toBe(SQL);
    expect(u!.detail).toContain(SQL);
  });

  it('the endpoint_data_effect_unresolved Finding detail now carries the verbatim SQL (not discarded)', () => {
    const irMap = new Map(jdbcFiles().map((f) => [f.filePath, f]));
    const findings = runSpringClassicFindingScanner({
      runId: 'r1',
      irFiles: irMap,
      packCandidates: [],
    });
    const finding = findings.find((f) => f.findingType === 'endpoint_data_effect_unresolved');
    expect(finding).toBeDefined();
    expect(finding!.title).toContain('GET /legacy/report');
    // The Finding's detail (both the structured detailJson.detail and the
    // human-readable summary) now carries the verbatim SQL instead of dropping it.
    const detailJson = finding!.detailJson as Record<string, any>;
    expect(detailJson.reason).toBe('jdbc_template');
    expect(String(detailJson.detail)).toContain(SQL);
    expect(String(finding!.summary)).toContain(SQL);
  });
});

// ===========================================================================
// 4. MyBatis mapper @Select SQL -> captured on the resolved edge (where reachable).
//
// A @Repository-annotated DAO (resolved to its @Entity via the <Name>Dao name
// prefix) with an inline @Select is a reachable mapper; its verbatim SQL is
// captured as query_kind 'mybatis'.
// ===========================================================================

describe('MyBatis mapper SQL on the resolved path_metadata_json', () => {
  const ACCOUNT_ENTITY = `
package com.foo.model;
import jakarta.persistence.Entity;
@Entity
public class Account {
  private Long id;
}
`;
  const ACCOUNT_DAO = `
package com.foo.mapper;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;
import org.springframework.stereotype.Repository;
import com.foo.model.Account;
@Mapper
@Repository
public interface AccountDao {
  @Select("SELECT * FROM accounts WHERE id = #{id}")
  Account findById(Long id);
}
`;
  const ACCOUNT_SERVICE = `
package com.foo.service;
import org.springframework.stereotype.Service;
import com.foo.mapper.AccountDao;
import com.foo.model.Account;
@Service
public class AccountService {
  private final AccountDao accountDao;
  public AccountService(AccountDao d) { this.accountDao = d; }
  public Account get(Long id) { return accountDao.findById(id); }
}
`;
  const ACCOUNT_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import com.foo.service.AccountService;
import com.foo.model.Account;
@RestController
@RequestMapping("/accounts")
public class AccountController {
  private final AccountService accountService;
  public AccountController(AccountService s) { this.accountService = s; }
  @GetMapping("/{id}")
  public Account get(Long id) { return accountService.get(id); }
}
`;

  it('captures an inline MyBatis @Select string verbatim with query_kind "mybatis"', () => {
    const files = ir(
      ['web/AccountController.java', ACCOUNT_CONTROLLER],
      ['service/AccountService.java', ACCOUNT_SERVICE],
      ['mapper/AccountDao.java', ACCOUNT_DAO],
      ['model/Account.java', ACCOUNT_ENTITY],
    );
    const cands = buildEndpointDataEffectCandidates(files, 'r1');
    const edge = cands.find((c) => dataOf(c).endpointName === 'GET /accounts/{id}');
    expect(edge).toBeDefined();
    expect(dataOf(edge!).dataEntityName).toBe('Account');
    const meta = metaOf(edge!);
    expect(meta.query_kind).toBe('mybatis');
    expect(meta.query_text).toBe('SELECT * FROM accounts WHERE id = #{id}');
  });
});
