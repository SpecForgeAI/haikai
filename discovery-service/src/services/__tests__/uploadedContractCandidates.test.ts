/**
 * Operator-uploaded API contract → service-discovery candidates (2026-08-02).
 *
 * The service scan can now be HANDED an authoritative WADL/XSD (the
 * service-discovery analogue of API Baseline Capture's contract upload). This
 * proves the load-bearing seam: an uploaded WADL becomes a synthetic IR entry
 * (buildUploadedContractIrEntries) which the EXISTING contract passes parse
 * into endpoint candidates carrying the declared media-type discriminator — so
 * an endpoint/format the repo merge missed is recovered.
 */
import { buildUploadedContractIrEntries } from '../discoveryV3Pipeline';
import { runContractCandidatePasses } from '../findings/packFindingScanners/contractCandidates';

const DUAL_FORMAT_WADL = `<?xml version="1.0"?>
<application xmlns="http://wadl.dev.java.net/2009/02">
  <resources base="http://example.invalid/api/">
    <resource path="/views">
      <method id="getViews" name="POST">
        <request>
          <representation mediaType="application/json"/>
          <representation mediaType="application/xml"/>
        </request>
        <response>
          <representation mediaType="application/json"/>
          <representation mediaType="application/xml"/>
        </response>
      </method>
    </resource>
  </resources>
</application>`;

describe('buildUploadedContractIrEntries', () => {
  it('makes a synthetic .wadl IR entry (real extension preserved for pass selection)', () => {
    const entries = buildUploadedContractIrEntries([
      { fileName: 'views.wadl', content: DUAL_FORMAT_WADL },
    ]);
    const entry = entries.get('__uploaded_contract__/views.wadl');
    expect(entry).toBeDefined();
    expect(entry!.filePath.endsWith('.wadl')).toBe(true);
    expect(entry!.rawContent).toBe(DUAL_FORMAT_WADL);
  });

  it('drops blank names and empty content', () => {
    const entries = buildUploadedContractIrEntries([
      { fileName: '   ', content: DUAL_FORMAT_WADL },
      { fileName: 'x.wadl', content: '' },
    ]);
    expect(entries.size).toBe(0);
  });
});

describe('uploaded WADL → contract endpoint candidates', () => {
  it('recovers the endpoint with its declared media types from an uploaded contract', () => {
    const irFiles = buildUploadedContractIrEntries([
      { fileName: 'views.wadl', content: DUAL_FORMAT_WADL },
    ]);
    const { candidates } = runContractCandidatePasses({
      runId: 'run-1',
      irFiles,
      packCandidates: [],
    });

    const endpoints = candidates.filter((c) => c.candidateType === 'endpoints');
    expect(endpoints.length).toBeGreaterThanOrEqual(1);
    const views = endpoints.find((e) =>
      String((e.data as Record<string, unknown>).path_or_address ?? '').includes('/views'),
    );
    expect(views).toBeDefined();
    // The declared media types are present so the merge can stamp the
    // per-format discriminator on the endpoint name.
    const data = views!.data as Record<string, unknown>;
    const produces = (data.produces as string[] | undefined) ?? [];
    expect(produces).toEqual(
      expect.arrayContaining(['application/json', 'application/xml']),
    );
  });
});
