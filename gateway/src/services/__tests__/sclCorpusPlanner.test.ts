/**
 * SCL corpus-derived spec planner — PURE derivation pins (SCL pipeline spec 7).
 *
 * Fixture corpus: 2 external controllers (one with a private fan_in-1 helper —
 * the vertical residue), one internal job root, a shared envelope table
 * (fan_in 3), a *Utils class (fan_in 2), 2 boundaries, an enum shape, an
 * Exception shape, and 3 DTO shapes (one mutated-in-flight).
 */

import {
  SclContractDto,
  composeAnnotationPaths,
  deriveCorpusPlan,
  httpRoutesOf,
} from '../sclCorpusPlanner';

function table(args: {
  key: string;
  symbol: string;
  fanIn?: number;
  roots?: string[];
  annotations?: string[];
  rows: number;
  references?: string[];
}): SclContractDto {
  return {
    contract_key: args.key,
    kind: 'behaviour_table',
    source_path: `src/${args.symbol.split('#')[0].replace(/\./g, '/')}.java`,
    source_symbol: args.symbol,
    fan_in: args.fanIn ?? 0,
    roots_json: { roots: args.roots ?? [], total: 5, reachable: 5 },
    body_json: {
      symbol: args.symbol,
      annotations: args.annotations ?? [],
      rows: Array.from({ length: args.rows }, (_, i) => ({ index: i, condition: `c${i}` })),
      references: args.references ?? [],
    },
  };
}

function shape(args: {
  key: string;
  symbol: string;
  representation?: string;
  flags?: string[];
}): SclContractDto {
  return {
    contract_key: args.key,
    kind: 'shape',
    source_path: `src/${args.symbol.replace(/\./g, '/')}.java`,
    source_symbol: args.symbol,
    fan_in: 0,
    roots_json: { roots: [] },
    body_json: {
      symbol: args.symbol,
      fields: [{ name: 'x', kind: 'string' }],
      flags: args.flags ?? [],
      ...(args.representation ? { representation: args.representation } : {}),
    },
  };
}

function boundary(key: string, symbol: string): SclContractDto {
  return {
    contract_key: key,
    kind: 'boundary',
    source_path: `src/${symbol.split('#')[0].replace(/\./g, '/')}.java`,
    source_symbol: symbol,
    fan_in: 1,
    roots_json: { roots: [] },
    body_json: { symbol, operations: [{ name: 'op', sql: 'SELECT 1' }] },
  };
}

const GET_ORDER = 'com.app.OrdersController#getOrder(String)';
const LIST_ORDERS = 'com.app.OrdersController#listOrders()';
const VALIDATE = 'com.app.OrdersController#validate(String)';
const CREATE_USER = 'com.app.UsersController#createUser(User)';
const JOB_RUN = 'com.app.NightlyJob#run()';
const ENVELOPE_BUILD = 'com.app.EnvelopeBuilder#build(Object)';
const DATE_FORMAT = 'com.app.DateUtils#format(Date)';

function fixture(): SclContractDto[] {
  return [
    // External controller 1 — two http roots + a private fan_in-1 helper.
    table({
      key: 'T-ORD-GET',
      symbol: GET_ORDER,
      roots: [GET_ORDER],
      annotations: ['@GET', '@Path("/orders/{id}")'],
      rows: 3,
      references: ['T-ORD-VAL', 'T-ENV', 'Q-ORD'],
    }),
    table({
      key: 'T-ORD-LIST',
      symbol: LIST_ORDERS,
      roots: [LIST_ORDERS],
      annotations: ['@GET', '@Path("/orders")'],
      rows: 2,
      references: ['T-ENV'],
    }),
    table({
      key: 'T-ORD-VAL',
      symbol: VALIDATE,
      fanIn: 1,
      roots: [GET_ORDER],
      rows: 2,
    }),
    // External controller 2 — one http root.
    table({
      key: 'T-USR-CREATE',
      symbol: CREATE_USER,
      roots: [CREATE_USER],
      annotations: ['@POST', '@Path("/users")'],
      rows: 4,
      references: ['T-ENV', 'T-UTIL'],
    }),
    // Internal job root (its own symbol in roots, NOT http-annotated).
    table({
      key: 'T-JOB',
      symbol: JOB_RUN,
      roots: [JOB_RUN],
      rows: 5,
      references: ['T-UTIL'],
    }),
    // Shared envelope fragment (fan_in 3) + shared *Utils (fan_in 2).
    table({ key: 'T-ENV', symbol: ENVELOPE_BUILD, fanIn: 3, rows: 2 }),
    table({ key: 'T-UTIL', symbol: DATE_FORMAT, fanIn: 2, rows: 1 }),
    // Boundaries.
    boundary('Q-ORD', 'com.app.OrderDao#findById(String)'),
    boundary('Q-USR', 'com.app.UserDao#insert(User)'),
    // Shapes: enum + exception + 3 DTOs (one mutated-in-flight).
    shape({ key: 'S-STATUS', symbol: 'com.app.Status', representation: 'enum' }),
    shape({ key: 'S-NFE', symbol: 'com.app.NotFoundException' }),
    shape({ key: 'S-ORDER', symbol: 'com.app.Order' }),
    shape({ key: 'S-USER', symbol: 'com.app.User', flags: ['mutated-in-flight'] }),
    shape({ key: 'S-ENV', symbol: 'com.app.Envelope' }),
  ];
}

describe('deriveCorpusPlan — 6-layer foundation partition', () => {
  const plan = deriveCorpusPlan(fixture());

  it('emits exactly the 6 layers, in order, with exact membership', () => {
    expect(plan.foundationStories.map((s) => s.layer)).toEqual([
      'constants-exceptions',
      'dto-shapes',
      'cross-cutting-fragments',
      'utilities',
      'data-access',
      'test-kit',
    ]);
    const byLayer = new Map(plan.foundationStories.map((s) => [s.layer, s]));
    expect(byLayer.get('constants-exceptions')!.contractKeys).toEqual(['S-NFE', 'S-STATUS']);
    expect(byLayer.get('constants-exceptions')!.title).toBe(
      'Constants, enums & exception types'
    );
    expect(byLayer.get('dto-shapes')!.contractKeys).toEqual(['S-ENV', 'S-ORDER', 'S-USER']);
    expect(byLayer.get('dto-shapes')!.description).toContain('1 mutated-in-flight');
    // Utils extracted OUT of layer 3 into layer 4.
    expect(byLayer.get('cross-cutting-fragments')!.contractKeys).toEqual(['T-ENV']);
    expect(byLayer.get('cross-cutting-fragments')!.rowCount).toBe(2);
    expect(byLayer.get('utilities')!.contractKeys).toEqual(['T-UTIL']);
    expect(byLayer.get('utilities')!.rowCount).toBe(1);
    expect(byLayer.get('data-access')!.contractKeys).toEqual(['Q-ORD', 'Q-USR']);
    // Test kit = ALL shape keys (symbol-sorted).
    expect(byLayer.get('test-kit')!.contractKeys).toEqual([
      'S-ENV',
      'S-NFE',
      'S-ORDER',
      'S-STATUS',
      'S-USER',
    ]);
  });

  it('tags every foundation story with scl + its layer tag', () => {
    for (const story of plan.foundationStories) {
      expect(story.tags).toEqual(['scl', `scl:foundation:${story.layer}`]);
    }
  });

  it('omits empty layers', () => {
    const noBoundaries = deriveCorpusPlan(fixture().filter((c) => c.kind !== 'boundary'));
    expect(noBoundaries.foundationStories.map((s) => s.layer)).not.toContain('data-access');
  });
});

describe('deriveCorpusPlan — endpoint groups', () => {
  const plan = deriveCorpusPlan(fixture());

  it('groups external roots per controller class with vertical-residue row counts', () => {
    expect(plan.externalEndpointGroups).toHaveLength(2);
    const [orders, users] = plan.externalEndpointGroups;

    expect(orders.title).toBe('Implement OrdersController (2 endpoints)');
    expect(orders.controllerClass).toBe('com.app.OrdersController');
    // getOrder(3) + validate residue(2) + listOrders(2); shared T-ENV and
    // boundary Q-ORD are NOT counted (hoisted to foundations).
    expect(orders.rowCount).toBe(7);
    expect(orders.contractKeys).toEqual(['T-ORD-GET', 'T-ORD-VAL', 'T-ORD-LIST']);
    expect(orders.tags).toEqual(['scl', 'scl:endpoint:external']);

    expect(users.title).toBe('Implement UsersController (1 endpoints)');
    expect(users.rowCount).toBe(4); // shared T-ENV/T-UTIL excluded
    expect(users.contractKeys).toEqual(['T-USR-CREATE']);
  });

  it('places internal groups AFTER externals in the plan object', () => {
    expect(plan.internalEndpointGroups).toHaveLength(1);
    const job = plan.internalEndpointGroups[0];
    expect(job.title).toBe('Implement NightlyJob (1 endpoints)');
    expect(job.controllerClass).toBe('com.app.NightlyJob');
    expect(job.rowCount).toBe(5);
    expect(job.tags).toEqual(['scl', 'scl:endpoint:internal']);
    expect(job.layer).toBe('endpoint:internal');
  });

  it('splits a controller over the row budget into consecutive-method parts', () => {
    const split = deriveCorpusPlan(fixture(), { rowBudget: 5 });
    const orderParts = split.externalEndpointGroups.filter(
      (g) => g.controllerClass === 'com.app.OrdersController'
    );
    expect(orderParts.map((g) => g.title)).toEqual([
      'Implement OrdersController (1 endpoints) (part 1)',
      'Implement OrdersController (1 endpoints) (part 2)',
    ]);
    // Part 1 = getOrder + its residue (3+2=5, exactly at budget); part 2 = listOrders (2).
    expect(orderParts[0].contractKeys).toEqual(['T-ORD-GET', 'T-ORD-VAL']);
    expect(orderParts[0].rowCount).toBe(5);
    expect(orderParts[1].contractKeys).toEqual(['T-ORD-LIST']);
    expect(orderParts[1].rowCount).toBe(2);
    // The under-budget controllers stay whole.
    expect(
      split.externalEndpointGroups.filter((g) => g.controllerClass === 'com.app.UsersController')
    ).toHaveLength(1);
    expect(split.internalEndpointGroups).toHaveLength(1);
    expect(split.stats.splitCount).toBe(1);
    expect(split.stats.rowBudget).toBe(5);
  });

  it('computes stats (shared count, controller count, default budget)', () => {
    expect(plan.stats).toEqual({
      sharedContractCount: 2, // T-ENV (fan_in 3) + T-UTIL (fan_in 2)
      controllerCount: 3, // OrdersController, UsersController, NightlyJob
      splitCount: 0,
      foundationSplitCount: 0, // fixture layers are all well under the 40 budget
      rowBudget: 40,
    });
  });
});

describe('deriveCorpusPlan — determinism', () => {
  it('is deterministic: same input twice ⇒ identical plan', () => {
    const a = deriveCorpusPlan(fixture());
    const b = deriveCorpusPlan(fixture());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('is input-order independent (sorts by symbol everywhere)', () => {
    const shuffled = [...fixture()].reverse();
    expect(JSON.stringify(deriveCorpusPlan(shuffled))).toBe(
      JSON.stringify(deriveCorpusPlan(fixture()))
    );
  });
});

/**
 * composeAnnotationPaths (2026-09-01). JAX-RS and Spring split a route across
 * a class-level BASE (`/`-prefixed) and a method-level SUFFIX; the naive
 * de-dupe emitted the split as TWO bogus routes, neither matching the
 * committed `/filters/create` — so every split-annotated endpoint silently
 * failed the route join. `httpRoutesOf` previously had ZERO coverage, which
 * is exactly how that regression vanished silently.
 */
describe('composeAnnotationPaths', () => {
  it('joins every base to every suffix when both are present', () => {
    expect(composeAnnotationPaths(['/filters', 'create'])).toEqual(['/filters/create']);
    expect(composeAnnotationPaths(['/a', '/b', 'x', 'y'].sort())).toEqual([
      '/a/x',
      '/a/y',
      '/b/x',
      '/b/y',
    ]);
  });

  it('absorbs a base trailing slash into ONE separating slash', () => {
    // NOTE: a `/`-prefixed fragment is ALWAYS a base by the classification
    // rule — there is deliberately no leading-slash SUFFIX case.
    expect(composeAnnotationPaths(['/filters/', 'create'])).toEqual(['/filters/create']);
  });

  it('passes fragments through deduped when either side is absent', () => {
    expect(composeAnnotationPaths(['/filters', '/views', '/filters'])).toEqual([
      '/filters',
      '/views',
    ]);
    // A bare suffix stays AS-IS for the join's suffix tier — never fabricated
    // into a rooted route.
    expect(composeAnnotationPaths(['create', 'create'])).toEqual(['create']);
    expect(composeAnnotationPaths([' ', ''])).toEqual([]);
  });
});

describe('httpRoutesOf — split-annotation composition', () => {
  it('a JAX-RS class base + method suffix yields the COMPOSED route, never the two halves', () => {
    const contract = table({
      key: 'T-CREATE',
      symbol: 'com.app.FiltersController#create(Filter)',
      annotations: ['@Path("/filters")', '@POST', '@Path("create")'],
      rows: 1,
    });
    expect(httpRoutesOf(contract)).toEqual([{ verb: 'POST', path: '/filters/create' }]);
  });

  it('a Spring class @RequestMapping base + @PostMapping suffix composes the same way', () => {
    const contract = table({
      key: 'T-SPRING',
      symbol: 'com.app.FiltersController#create(Filter)',
      annotations: ['@RequestMapping("/filters")', '@PostMapping("create")'],
      rows: 1,
    });
    expect(httpRoutesOf(contract)).toEqual([{ verb: 'POST', path: '/filters/create' }]);
  });

  it('a base-absent bare suffix passes through as-is (for the join suffix tier)', () => {
    const contract = table({
      key: 'T-BARE',
      symbol: 'com.app.FiltersController#create(Filter)',
      annotations: ['@POST', '@Path("create")'],
      rows: 1,
    });
    expect(httpRoutesOf(contract)).toEqual([{ verb: 'POST', path: 'create' }]);
  });
});

