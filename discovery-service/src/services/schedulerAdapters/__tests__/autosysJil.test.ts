/** Autosys jil adapter (Oracle Nine item 8): parse + main resolution. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseJilText, parseJilFiles, resolveJobsToMains } from '../autosysJil';

const JIL = `
/* nightly load box */
insert_job: env.feedload.box   job_type: b
insert_job: env.deleteandload  job_type: c
box_name: env.feedload.box
command: bin/DeleteAndLoad.sh UNITS $file 20240101
start_times: "17:00"
days_of_week: mo,tu,we,th,fr
insert_job: env.waitfile       job_type: f
watch_file: /drop/units.dat
insert_job: env.xferload       job_type: c
command: bin/TransferLoad.sh -d 20240101 -u tree
condition: s(env.deleteandload)
`;

describe('parseJilText', () => {
  it('parses jobs with their fields, joined by insert_job blocks', () => {
    const jobs = parseJilText(JIL, 'batch/autosys/jils/feed.jil');
    expect(jobs.map((j) => j.jobName)).toEqual([
      'env.feedload.box',
      'env.deleteandload',
      'env.waitfile',
      'env.xferload',
    ]);
    const load = jobs[1];
    expect(load).toMatchObject({
      jobType: 'c',
      boxName: 'env.feedload.box',
      startTimes: '17:00',
      daysOfWeek: 'mo,tu,we,th,fr',
    });
    expect(load.command).toContain('DeleteAndLoad.sh');
    expect(jobs[2].watchFile).toBe('/drop/units.dat');
    expect(jobs[3].condition).toBe('s(env.deleteandload)');
  });
});

describe('resolveJobsToMains', () => {
  it('resolves via the named shell script; unresolved command jobs stay null (loud upstream)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jil-'));
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'jils'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'bin', 'DeleteAndLoad.sh'),
      '#!/bin/sh\njava -cp app.jar com.x.batch.BatchLoaderImpl "$@"\n',
    );
    fs.writeFileSync(path.join(dir, 'jils', 'feed.jil'), JIL);
    try {
      const jobs = parseJilFiles(dir);
      const resolved = resolveJobsToMains(jobs, dir, [
        'com.x.batch.BatchLoaderImpl',
        'com.x.batch.XferToTablesImpl',
      ]);
      const load = resolved.find((j) => j.jobName === 'env.deleteandload')!;
      expect(load.resolvedMainFqn).toBe('com.x.batch.BatchLoaderImpl');
      expect(load.resolvedVia).toBe('script');
      const xfer = resolved.find((j) => j.jobName === 'env.xferload')!;
      expect(xfer.resolvedMainFqn).toBeNull(); // TransferLoad.sh does not exist
      const box = resolved.find((j) => j.jobName === 'env.feedload.box')!;
      expect(box.resolvedMainFqn).toBeNull(); // boxes never resolve
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
