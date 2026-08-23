/**
 * Live stored-object harvest (Oracle Nine item 1, 2026-08-23): syscomments
 * segments reassemble in colid order per object; empty results are honest.
 */

jest.mock('../sybaseSidecarClient', () => ({
  callSidecarQuery: jest.fn(),
}));

import { callSidecarQuery } from '../sybaseSidecarClient';
import { harvestLiveProcSources } from '../sybaseProcHarvest';

const CREDS = {
  host: 'h',
  port: 5000,
  database: 'd',
  username: 'u',
  password: 'p',
  driver: 'auto',
} as never;

describe('harvestLiveProcSources', () => {
  it('reassembles multi-segment bodies in colid order, per object', async () => {
    (callSidecarQuery as jest.Mock).mockResolvedValue({
      rows: [
        { obj_name: 'roll_dates', obj_type: 'P', colid: 1, body_text: 'create proc roll_dates as ' },
        { obj_name: 'roll_dates', obj_type: 'P', colid: 2, body_text: 'update biz_date_ctrl set d = 1' },
        { obj_name: 'next_seq', obj_type: 'F', colid: 1, body_text: 'create function next_seq as select 1' },
      ],
    });
    const sources = await harvestLiveProcSources(CREDS, 60);
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({ name: 'roll_dates', objType: 'P' });
    expect(sources[0].text).toBe('create proc roll_dates as update biz_date_ctrl set d = 1');
    expect(sources[1]).toMatchObject({ name: 'next_seq', objType: 'F' });
    const sql = (callSidecarQuery as jest.Mock).mock.calls[0][1].sql as string;
    expect(sql).toContain('syscomments');
    expect(sql.toUpperCase().startsWith('SELECT')).toBe(true); // read-only guard territory
  });

  it('an empty catalog yields an empty list (never throws on no rows)', async () => {
    (callSidecarQuery as jest.Mock).mockResolvedValue({ rows: [] });
    await expect(harvestLiveProcSources(CREDS, 60)).resolves.toEqual([]);
  });
});

describe('detectServerCharset (Oracle Nine item 3)', () => {
  it('detects charset + sortorder and declares the charset on later creds', async () => {
    (callSidecarQuery as jest.Mock).mockResolvedValue({
      rows: [{ charset_name: 'iso_1', sortorder_name: 'bin_iso_1' }],
    });
    const { SybaseDiscoveryPack } = await import('../SybaseDiscoveryPack');
    const pack = new SybaseDiscoveryPack();
    await pack.connect({
      config: { host: 'h', port: 5000, databaseName: 'd', queryTimeoutSeconds: 30 },
      credentials: { username: 'u', password: 'p' },
    } as never);
    const facts = await pack.detectServerCharset({
      config: { queryTimeoutSeconds: 30 },
    } as never);
    expect(facts).toEqual({
      charset: 'iso_1',
      sortorderName: 'bin_iso_1',
      caseSensitive: true,
    });
    // Subsequent sidecar calls carry the declared charset.
    await pack.harvestProcSources({ config: { queryTimeoutSeconds: 30 } } as never);
    const lastCreds = (callSidecarQuery as jest.Mock).mock.calls.at(-1)![0];
    expect(lastCreds.charset).toBe('iso_1');
  });

  it('a nocase sortorder reads as case-INsensitive', async () => {
    (callSidecarQuery as jest.Mock).mockResolvedValue({
      rows: [{ charset_name: 'cp850', sortorder_name: 'nocase_cp850' }],
    });
    const { SybaseDiscoveryPack } = await import('../SybaseDiscoveryPack');
    const pack = new SybaseDiscoveryPack();
    await pack.connect({
      config: { host: 'h', port: 5000, databaseName: 'd' },
      credentials: { username: 'u', password: 'p' },
    } as never);
    const facts = await pack.detectServerCharset({ config: {} } as never);
    expect(facts?.caseSensitive).toBe(false);
  });
});
