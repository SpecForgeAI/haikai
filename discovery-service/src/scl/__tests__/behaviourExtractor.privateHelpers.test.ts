/**
 * Private/same-class helper folding (Kiro 2026-08-24, replicated from the
 * work-machine fix): a DAO's PUBLIC method is the contract unit; its
 * private helpers are that op's implementation, so their SQL and their
 * DAO->DAO delegations belong to the public op. Before this fix a create
 * op mined sql=null because its INSERT lived in a private insert-row
 * helper, and every sequence-DAO delegation site was a private helper —
 * the sequence table looked untouched from every create endpoint.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { indexJavaProject } from '../javaProjectIndex';
import { extractBehaviour } from '../behaviourExtractor';

const SEQUENCE_DAO = `package com.x;

public class SequenceDao {
  public int getNext(String name) {
    run("update seq_registry set SeqNumber = SeqNumber + 1 where SeqName = ?");
    return 0;
  }
  private int run(String sql) { return 0; }
}
`;

const VIEW_DAO = `package com.x;

public class ViewDao {
  private SequenceDao sequenceDao;

  public void createView(String name) {
    int id = nextId();
    insertViewRow(id, name);
  }

  public java.util.List<String> listViews() {
    return query("select ViewName from view_registry where ValidTo = '9999-12-31'");
  }

  private int nextId() {
    return sequenceDao.getNext("ViewId");
  }

  private void insertViewRow(int id, String name) {
    exec("insert into view_registry (ViewId, ViewName) values (?, ?)");
  }

  private java.util.List<String> query(String sql) { return null; }
  private void exec(String sql) { }
}
`;

const CYCLE_DAO = `package com.x;

public class CycleDao {
  public void save(String x) {
    stepA(x);
  }
  private void stepA(String x) {
    stepB(x);
  }
  private void stepB(String x) {
    stepA(x);
    exec("insert into audit_trail_info (Detail) values (?)");
  }
  private void exec(String sql) { }
}
`;

const ORG_DAO = `package com.x;

public interface OrgDao {
  public void createOrg(String name);
}
`;

const ORG_DAO_IMPL = `package com.x;

public class OrgDaoImpl implements OrgDao {
  public void createOrg(String name) {
    insertOrgRow(name);
  }
  private void insertOrgRow(String name) {
    exec("insert into org_registry (Name) values (?)");
  }
  private void exec(String sql) { }
}
`;

describe('private/same-class helper folding (Kiro 2026-08-24)', () => {
  let dir: string;
  let result: ReturnType<typeof extractBehaviour>;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl-helpers-'));
    fs.mkdirSync(path.join(dir, 'com', 'x'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'com', 'x', 'SequenceDao.java'), SEQUENCE_DAO);
    fs.writeFileSync(path.join(dir, 'com', 'x', 'ViewDao.java'), VIEW_DAO);
    fs.writeFileSync(path.join(dir, 'com', 'x', 'CycleDao.java'), CYCLE_DAO);
    fs.writeFileSync(path.join(dir, 'com', 'x', 'OrgDao.java'), ORG_DAO);
    fs.writeFileSync(path.join(dir, 'com', 'x', 'OrgDaoImpl.java'), ORG_DAO_IMPL);
    const index = await indexJavaProject(dir);
    expect(index.parseErrors).toEqual([]);
    result = extractBehaviour(index, new Map());
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function opOf(symbol: string, name: string) {
    const boundary = result.boundaries.find((b) => b.symbol === symbol);
    expect(boundary).toBeDefined();
    return boundary!.operations.find((o) => o.name === name);
  }

  it("folds a private helper's SQL into the public op (collaborator SQL stays out)", () => {
    const createView = opOf('com.x.ViewDao', 'createView')!;
    expect(createView.sqlVerbatim).toContain('insert into view_registry');
    // The DELEGATE's SQL is not folded — only same-class helpers are.
    expect(createView.sqlVerbatim ?? '').not.toContain('seq_registry');
  });

  it("folds a private helper's DAO->DAO delegation into the public op", () => {
    const createView = opOf('com.x.ViewDao', 'createView')!;
    expect(createView.delegatesTo).toContain('com.x.SequenceDao#getNext');
  });

  it('transitive helper chains fold cycle-safely', () => {
    const save = opOf('com.x.CycleDao', 'save')!;
    expect(save.sqlVerbatim).toContain('insert into audit_trail_info');
  });

  it("an INTERFACE op's helpers are mined from the implementing class", () => {
    const createOrg = opOf('com.x.OrgDao', 'createOrg')!;
    expect(createOrg.sqlVerbatim).toContain('insert into org_registry');
  });
});
