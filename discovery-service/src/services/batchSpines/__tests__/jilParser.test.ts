/**
 * Tests for the hand-rolled Autosys JIL parser (D2, Task Group 2).
 *
 * The parser is deterministic key:value (NOT tree-sitter) and produces a
 * structured topology object (boxes / jobs / trigger DAG / schedules) that
 * Group 4's capability synthesis lands authoritatively in capability
 * `detail_json`. It mints NO candidate rows — it is a pure parser.
 *
 * Coverage is deliberately focused (D12): a box + its child jobs, a
 * file-watcher (`job_type f`), the `condition` DAG variants
 * (success / done / notrunning / failure), and unknown-keyword tolerance via
 * the generic `attributes` bag.
 */
import { parseJil } from '../jilParser';

// A box that owns two command jobs, with a success-condition edge between
// them and a schedule on the box.
const BOX_WITH_JOBS = `
/* Daily risk hierarchy load */
insert_job: risk_hier_box   job_type: b
machine: batchhost01
start_times: "06:00"
days_of_week: mo,tu,we,th,fr
run_calendar: business_days
alarm_if_fail: 1

insert_job: risk_hier_extract   job_type: c
box_name: risk_hier_box
command: /opt/risk/bin/extract.sh -o UPDATE
machine: batchhost01
std_out_file: /var/log/risk/extract.out
std_err_file: /var/log/risk/extract.err

insert_job: risk_hier_load   job_type: c
box_name: risk_hier_box
command: /opt/risk/bin/load.sh -o ARCHIVE
machine: batchhost01
condition: success(risk_hier_extract)
`;

// A standalone file-watcher job (job_type f) that triggers a downstream job
// via a done()-condition, plus a notrunning() and a failure() edge to exercise
// every condition keyword.
const FILE_WATCHER_AND_CONDITIONS = `
insert_job: feed_watcher   job_type: f
machine: ftphost01
watch_file: /incoming/risk_feed.csv

insert_job: feed_ingest   job_type: c
command: /opt/risk/bin/ingest.sh
condition: done(feed_watcher) & notrunning(risk_hier_box)

insert_job: feed_alert   job_type: c
command: /opt/risk/bin/alert.sh
condition: failure(feed_ingest)
`;

// A dialect with keywords the parser does not model explicitly — they must
// land in the per-job `attributes` bag with NO hard failure.
const UNKNOWN_KEYWORDS = `
insert_job: exotic_job   job_type: c
command: /opt/x/run.sh
owner: batchsvc@REALM
permission: gx,wx
n_retrys: 3
profile: /opt/x/.profile
`;

describe('parseJil — hand-rolled Autosys JIL parser', () => {
  it('parses a box and its child jobs into the topology', () => {
    const topo = parseJil(BOX_WITH_JOBS);

    // One box.
    expect(topo.boxes.map((b) => b.name)).toEqual(['risk_hier_box']);

    // The flat `jobs` list holds every stanza (the box + both command jobs).
    expect(topo.jobs.map((j) => j.name).sort()).toEqual([
      'risk_hier_box',
      'risk_hier_extract',
      'risk_hier_load',
    ]);

    // Two command jobs, both owned by the box via box_name.
    const commandJobs = topo.jobs.filter((j) => j.jobType === 'c');
    expect(commandJobs.map((j) => j.name).sort()).toEqual([
      'risk_hier_extract',
      'risk_hier_load',
    ]);
    for (const j of commandJobs) {
      expect(j.boxName).toBe('risk_hier_box');
    }

    // Box-level schedule + machine captured.
    const box = topo.boxes[0];
    expect(box.jobType).toBe('b');
    expect(box.machine).toBe('batchhost01');
    expect(box.schedule).toEqual(
      expect.objectContaining({
        startTimes: '"06:00"',
        daysOfWeek: 'mo,tu,we,th,fr',
        runCalendar: 'business_days',
      }),
    );
    expect(box.alarmIfFail).toBe('1');

    // Commands + std out/err streams captured on the jobs.
    const extract = topo.jobs.find((j) => j.name === 'risk_hier_extract')!;
    expect(extract.command).toBe('/opt/risk/bin/extract.sh -o UPDATE');
    expect(extract.stdOutFile).toBe('/var/log/risk/extract.out');
    expect(extract.stdErrFile).toBe('/var/log/risk/extract.err');
  });

  it('captures box-membership edges AND a success() condition edge in the DAG', () => {
    const topo = parseJil(BOX_WITH_JOBS);

    // Box-membership edges (box -> child) for both jobs.
    const memberEdges = topo.edges.filter((e) => e.type === 'box-member');
    expect(
      memberEdges.map((e) => `${e.from}->${e.to}`).sort(),
    ).toEqual(['risk_hier_box->risk_hier_extract', 'risk_hier_box->risk_hier_load']);

    // The success() condition edge: extract must succeed before load runs.
    const condEdges = topo.edges.filter((e) => e.type === 'condition');
    expect(condEdges).toHaveLength(1);
    expect(condEdges[0]).toEqual(
      expect.objectContaining({
        from: 'risk_hier_extract',
        to: 'risk_hier_load',
        condition: 'success',
      }),
    );
  });

  it('recognises a file-watcher job (job_type f)', () => {
    const topo = parseJil(FILE_WATCHER_AND_CONDITIONS);
    const watcher = topo.jobs.find((j) => j.name === 'feed_watcher')!;
    expect(watcher).toBeDefined();
    expect(watcher.jobType).toBe('f');
    expect(topo.fileWatchers.map((w) => w.name)).toEqual(['feed_watcher']);
    // The unmodelled `watch_file` keyword lands in attributes (tolerated).
    expect(watcher.attributes.watch_file).toBe('/incoming/risk_feed.csv');
  });

  it('parses every condition variant (success / done / notrunning / failure) into edges', () => {
    const topo = parseJil(FILE_WATCHER_AND_CONDITIONS);
    const condEdges = topo.edges.filter((e) => e.type === 'condition');
    // done(feed_watcher) + notrunning(risk_hier_box) -> feed_ingest, and
    // failure(feed_ingest) -> feed_alert. Three condition edges total.
    const triples = condEdges
      .map((e) => `${e.condition}:${e.from}->${e.to}`)
      .sort();
    expect(triples).toEqual([
      'done:feed_watcher->feed_ingest',
      'failure:feed_ingest->feed_alert',
      'notrunning:risk_hier_box->feed_ingest',
    ]);
  });

  it('lands unknown keywords in the generic attributes bag with no hard failure', () => {
    const topo = parseJil(UNKNOWN_KEYWORDS);
    expect(topo.jobs).toHaveLength(1);
    const job = topo.jobs[0];
    expect(job.name).toBe('exotic_job');
    // Modelled keyword still recognised.
    expect(job.command).toBe('/opt/x/run.sh');
    // Every unmodelled keyword is preserved verbatim in attributes.
    expect(job.attributes).toEqual({
      owner: 'batchsvc@REALM',
      permission: 'gx,wx',
      n_retrys: '3',
      profile: '/opt/x/.profile',
    });
  });

  it('is deterministic and returns an empty topology for empty / comment-only input', () => {
    const empty = parseJil('   \n /* just a comment */ \n');
    expect(empty.boxes).toEqual([]);
    expect(empty.jobs).toEqual([]);
    expect(empty.edges).toEqual([]);
    expect(empty.fileWatchers).toEqual([]);
    // Stable shape across calls (deterministic).
    expect(parseJil(BOX_WITH_JOBS)).toEqual(parseJil(BOX_WITH_JOBS));
  });
});
