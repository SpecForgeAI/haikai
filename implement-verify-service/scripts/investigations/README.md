# Investigation scripts

Ad-hoc scripts written during specific investigations, kept here for historical reference. **Not part of the supported tooling surface.**

Shared characteristics:
- Hardcoded paths to a particular machine / snapshot location (typically `C:\Users\ozzie\AppData\Local\Temp\<repo>` or similar)
- Pinned to the repo state at the time of writing
- No tests, no argparse, no CI integration
- May reference modules or APIs that have since moved

Treat these as a notebook record, not as runnable utilities. If you find yourself wanting one of these to work today, copy it out and parameterize the paths.

## Files

| Script | Investigation | When |
|---|---|---|
| `count_kibana_routes.py` | Triangulate Kibana endpoint counts (V1 vs V2 vs OpenAPI spec) by grep-counting `router.{get,post,...}` calls | 2026-04 OpenAPI discovery work |
| `diff_kibana_three_way.py` | Side-by-side diff of V1, V2, and OpenAPI-derived endpoint sets on Kibana | 2026-04 OpenAPI discovery work |
| `dump_kibana_v2_endpoints.py` | Dump V2's discovered Kibana endpoints to JSON for inspection | 2026-04 OpenAPI discovery work |
| `test_refactoring_on_kibana.py` | Smoke-exercise the refactoring engines (change_detector, rename_engine, staleness) against a live Kibana snapshot | 2026-04 refactoring impact spec |
