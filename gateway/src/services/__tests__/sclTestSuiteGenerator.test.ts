/**
 * SCL TDD test-suite generator — determinism + content pins (SCL pipeline
 * spec 9). Fixture: 2 shapes (Order references Customer; Customer carries a
 * date + wide id), an enum shape, one behaviour table with terminal / call /
 * absorb rows (+ cites, + a '*' + '/' verbatim), and a controller root table
 * feeding golden paths.
 */

import { SclContractDto } from '../sclCorpusPlanner';
import {
  SCL_SUITE_GENERATED_NOTE,
  SclSuiteStory,
  generateSclTestSuite,
} from '../sclTestSuiteGenerator';

// ---------------------------------------------------------------------------
// Fixture corpus
// ---------------------------------------------------------------------------

const CONTROLLER = 'com.app.OrdersController';
const GET_ORDER = `${CONTROLLER}#getOrder(String)`;

function customerShape(): SclContractDto {
  return {
    contract_key: 'S-CUST',
    kind: 'shape',
    source_symbol: 'com.app.Customer',
    body_json: {
      symbol: 'com.app.Customer',
      representation: 'pojo',
      flags: [],
      fields: [
        { name: 'name', kind: 'string', nullable: false },
        { name: 'id', kind: 'integer-wide', nullable: false },
        { name: 'joined', kind: 'date', nullable: true },
      ],
    },
  };
}

function orderShape(): SclContractDto {
  return {
    contract_key: 'S-ORD',
    kind: 'shape',
    source_symbol: 'com.app.Order',
    body_json: {
      symbol: 'com.app.Order',
      representation: 'pojo',
      flags: ['mutated_in_flight'],
      fields: [
        { name: 'id', kind: 'string', nullable: false },
        { name: 'total', kind: 'decimal', nullable: false },
        { name: 'customer', kind: 'ref:S-CUST', nullable: false },
        { name: 'placedAt', kind: 'timestamp', nullable: true },
        { name: 'tags', kind: 'list<string>', nullable: false },
        { name: 'attrs', kind: 'map<string,string>', nullable: false },
        { name: 'active', kind: 'boolean', nullable: false },
        { name: 'count', kind: 'int64', nullable: false },
        { name: 'status', kind: 'ref:S-STATUS', nullable: false },
        { name: 'blob', kind: 'opaque:Blob', nullable: true },
      ],
    },
  };
}

function statusEnumShape(): SclContractDto {
  return {
    contract_key: 'S-STATUS',
    kind: 'shape',
    source_symbol: 'com.app.Status',
    body_json: {
      symbol: 'com.app.Status',
      representation: 'enum',
      flags: [],
      fields: [{ name: 'OPEN', kind: 'string' }, { name: 'CLOSED', kind: 'string' }],
    },
  };
}

function behaviourTable(): SclContractDto {
  return {
    contract_key: 'T-GET',
    kind: 'behaviour_table',
    source_symbol: GET_ORDER,
    fan_in: 0,
    roots_json: { roots: [GET_ORDER] },
    body_json: {
      symbol: GET_ORDER,
      annotations: ['@GET', '@Path("/orders/{id}")'],
      signatureInputs: [{ name: 'id', typeRef: 'String' }],
      rows: [
        {
          index: 0,
          kind: 'branch',
          conditionVerbatim: 'id == null',
          conditionRef: { path: 'src/A.java', line: 10 },
          outcome: {
            type: 'terminal',
            verbatim: 'throw new BadRequestException("id")',
            ref: { path: 'src/A.java', line: 11 },
            outcomeLabel: 'throws:BadRequestException',
          },
        },
        {
          index: 1,
          kind: 'dispatch',
          conditionVerbatim: null,
          conditionRef: null,
          outcome: {
            type: 'call',
            targetKey: 'T-SVC',
            targetSymbol: 'com.app.OrderService#load(String)',
          },
        },
        {
          index: 2,
          kind: 'catch',
          conditionVerbatim: null,
          conditionRef: null,
          outcome: {
            type: 'absorb',
            exceptionType: 'SQLException',
            thenVerbatim: 'return ErrorEnvelope.of(e)',
            ref: { path: 'src/A.java', line: 20 },
            outcomeLabel: 'value:ErrorEnvelope',
          },
        },
        {
          index: 3,
          kind: 'terminal',
          conditionVerbatim: 'order.isReady() */ legacy',
          conditionRef: { path: 'src/A.java', line: 30 },
          outcome: {
            type: 'terminal',
            verbatim: 'return order',
            ref: { path: 'src/A.java', line: 31 },
            outcomeLabel: 'value:Order',
          },
        },
      ],
      references: ['T-SVC', 'S-ORD'],
    },
  };
}

function fixtureContracts(): SclContractDto[] {
  return [behaviourTable(), orderShape(), customerShape(), statusEnumShape()];
}

function story(): SclSuiteStory {
  return {
    title: 'Implement OrdersController (1 endpoints)',
    sclContractKeys: ['T-GET', 'S-ORD', 'S-CUST', 'S-STATUS'],
    layer: 'endpoint:external',
    controllerClass: CONTROLLER,
    tags: ['scl', 'scl:endpoint:external'],
  };
}

const BASE_PACKAGE = 'com.example.target';

function generate(contracts = fixtureContracts()) {
  return generateSclTestSuite({ story: story(), contracts, basePackage: BASE_PACKAGE });
}

function fileByPath(suite: ReturnType<typeof generate>, suffix: string): string {
  const file = suite.files.find((f) => f.path.endsWith(suffix));
  if (!file) throw new Error(`missing generated file *${suffix}`);
  return file.content;
}

// ---------------------------------------------------------------------------
// Files + counts
// ---------------------------------------------------------------------------

describe('generateSclTestSuite — file scheme', () => {
  it('emits fixtures (non-enum shapes only), one behaviour suite, one golden file', () => {
    const suite = generate();
    expect(suite.files.map((f) => f.path)).toEqual([
      'src/test/java/com/example/target/behaviour/OrdersController_getOrderBehaviourTest.java',
      'src/test/java/com/example/target/golden/OrdersControllerGoldenPathsTest.java',
      'src/test/java/com/example/target/testkit/CustomerFixtures.java',
      'src/test/java/com/example/target/testkit/OrderFixtures.java',
    ]);
    // Enum shapes get NO fixture file.
    expect(suite.files.some((f) => f.path.includes('StatusFixtures'))).toBe(false);
    expect(suite.stats).toEqual({ fixtureBuilders: 2, rowTests: 4, goldenPaths: 3 });
  });
});

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

describe('generateSclTestSuite — fixture builders', () => {
  it('emits per-kind deterministic defaults', () => {
    const suite = generate();
    const customer = fileByPath(suite, 'CustomerFixtures.java');
    expect(customer).toContain('public static Customer aCustomer()');
    expect(customer).toContain('"x-name"');
    expect(customer).toContain('new BigInteger("1")');
    expect(customer).toContain('LocalDate.of(2026, 1, 1)');
    expect(customer).toContain('import java.math.BigInteger;');
    expect(customer).toContain('import java.time.LocalDate;');

    const order = fileByPath(suite, 'OrderFixtures.java');
    expect(order).toContain('new BigDecimal("1.00")');
    expect(order).toContain('CustomerFixtures.aCustomer()'); // nested ref:S-CUST
    expect(order).toContain('ZonedDateTime.of(2026, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC)');
    expect(order).toContain('List.of()');
    expect(order).toContain('Map.of()');
    expect(order).toContain('false /* active : boolean */');
    expect(order).toContain('1L /* count : int64 */');
    expect(order).toContain('Status.OPEN'); // enum ref → first constant
    expect(order).toMatch(/null \/\* opaque:Blob/); // opaque → null with comment
  });

  it('marks mutated-in-flight shapes with a warning comment', () => {
    const suite = generate();
    expect(fileByPath(suite, 'OrderFixtures.java')).toContain('WARNING — mutated-in-flight');
    expect(fileByPath(suite, 'CustomerFixtures.java')).not.toContain('mutated-in-flight');
  });
});

// ---------------------------------------------------------------------------
// Per-row behaviour tests
// ---------------------------------------------------------------------------

describe('generateSclTestSuite — per-row behaviour tests', () => {
  it('declares a @Mock per distinct callee class and constructor-injects the subject', () => {
    const content = fileByPath(generate(), 'OrdersController_getOrderBehaviourTest.java');
    expect(content).toContain('@ExtendWith(MockitoExtension.class)');
    expect(content).toContain('@Mock');
    expect(content).toContain('private OrderService orderService;');
    expect(content).toContain('return new OrdersController(orderService);');
  });

  it('names row tests row<N>_<slug> with javadoc row cites', () => {
    const content = fileByPath(generate(), 'OrdersController_getOrderBehaviourTest.java');
    expect(content).toContain('/** Row 0: id == null [src/A.java:10] */');
    expect(content).toMatch(/void row0_id_null\(\)/);
    expect(content).toMatch(/void row1_/);
    expect(content).toMatch(/void row2_/);
    expect(content).toMatch(/void row3_/);
  });

  it('terminal throws-label rows use assertThrows; value labels assertInstanceOf', () => {
    const content = fileByPath(generate(), 'OrdersController_getOrderBehaviourTest.java');
    expect(content).toContain(
      'assertThrows(BadRequestException.class, () -> subject().getOrder("x-id"));'
    );
    expect(content).toContain('assertInstanceOf(Order.class, result);');
  });

  it('call rows stub with when/thenReturn and verify the delegation', () => {
    const content = fileByPath(generate(), 'OrdersController_getOrderBehaviourTest.java');
    expect(content).toContain('when(orderService.load(any())).thenReturn(null);');
    expect(content).toContain('verify(orderService).load(any());');
  });

  it('absorb rows arrange when/thenThrow and assert the mapped envelope class', () => {
    const content = fileByPath(generate(), 'OrdersController_getOrderBehaviourTest.java');
    expect(content).toContain(
      'when(orderService.load(any())).thenThrow(new SQLException("scl-absorb"));'
    );
    expect(content).toContain('// Handler (verbatim): return ErrorEnvelope.of(e)');
    expect(content).toContain('assertInstanceOf(ErrorEnvelope.class, result);');
  });

  it('escapes block-comment closers in verbatim text', () => {
    const content = fileByPath(generate(), 'OrdersController_getOrderBehaviourTest.java');
    expect(content).toContain('order.isReady() *\\/ legacy'); // escaped form present
    expect(content).not.toContain('order.isReady() */ legacy'); // raw closer gone
  });
});

// ---------------------------------------------------------------------------
// Golden paths
// ---------------------------------------------------------------------------

describe('generateSclTestSuite — golden paths', () => {
  it('emits one skeleton per DISTINCT root-level outcomeLabel', () => {
    const content = fileByPath(generate(), 'OrdersControllerGoldenPathsTest.java');
    expect(content).toMatch(/void golden_throws_badrequestexception\(\)/);
    expect(content).toMatch(/void golden_value_errorenvelope\(\)/);
    expect(content).toMatch(/void golden_value_order\(\)/);
    expect(content).toContain('MockMvcBuilders.standaloneSetup(new OrdersController(orderService))');
    expect(content).toContain('get("/orders/{id}", "x-p0")');
    expect(content).toContain('.andExpect(status().isOk());');
  });

  it('is suppressed for non-external stories', () => {
    const internalStory: SclSuiteStory = {
      ...story(),
      layer: 'endpoint:internal',
      tags: ['scl', 'scl:endpoint:internal'],
    };
    const suite = generateSclTestSuite({
      story: internalStory,
      contracts: fixtureContracts(),
      basePackage: BASE_PACKAGE,
    });
    expect(suite.files.some((f) => f.path.includes('GoldenPathsTest'))).toBe(false);
    expect(suite.stats.goldenPaths).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Manifest + determinism + syntactic sanity
// ---------------------------------------------------------------------------

describe('generateSclTestSuite — manifest + determinism', () => {
  it('is byte-deterministic across runs (stable sha256s, static note, no timestamps)', () => {
    const first = generate();
    const second = generate();
    expect(second).toEqual(first);
    expect(first.manifest.generated_at_note).toBe(SCL_SUITE_GENERATED_NOTE);
    expect(first.manifest.story_title).toBe('Implement OrdersController (1 endpoints)');
    expect(first.manifest.contract_keys).toEqual(['T-GET', 'S-ORD', 'S-CUST', 'S-STATUS']);
    expect(first.manifest.files.map((f) => f.path)).toEqual(first.files.map((f) => f.path));
    for (const entry of first.manifest.files) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('changes the behaviour file sha when a contract body changes', () => {
    const baseline = generate();
    const mutated = fixtureContracts();
    const table = mutated[0] as { body_json: { rows: Array<{ conditionVerbatim: string | null }> } };
    table.body_json.rows[0].conditionVerbatim = 'id == null || id.isEmpty()';
    const changed = generate(mutated as SclContractDto[]);
    const behaviourPath = (p: string) => p.includes('BehaviourTest');
    const shaOf = (suite: ReturnType<typeof generate>) =>
      suite.manifest.files.find((f) => behaviourPath(f.path))!.sha256;
    expect(shaOf(changed)).not.toBe(shaOf(baseline));
    // Untouched files keep their hashes.
    const fixtureSha = (suite: ReturnType<typeof generate>) =>
      suite.manifest.files.find((f) => f.path.endsWith('OrderFixtures.java'))!.sha256;
    expect(fixtureSha(changed)).toBe(fixtureSha(baseline));
  });

  it('every generated file has balanced braces (syntactic-sanity proxy)', () => {
    for (const file of generate().files) {
      const open = (file.content.match(/\{/g) ?? []).length;
      const close = (file.content.match(/\}/g) ?? []).length;
      expect(`${file.path}:${open}`).toBe(`${file.path}:${close}`);
    }
  });
});
