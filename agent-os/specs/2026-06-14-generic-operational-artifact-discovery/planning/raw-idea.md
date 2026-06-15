# D1 — Generic operational-artifact discovery (always-on summariser → findings)

This is Spec 1 (of 6) in a discovery-completeness + net_new program that makes the migration tool discover NON-API / internal functionality it currently misses (the first real migration is a Sybase/Spring-Classic/Java risk-hierarchy system whose batch tier is CA Autosys JIL + shell scripts + plain-Java main() classes + Geneos monitoring XML + Argon/TIBCO FTP — almost none of which discovery picks up today).

## The gap (verified by code-tracing)
Discovery ingestion is limited to a hard `SOURCE_EXTENSIONS` whitelist (Java/TS/Py/Go/SQL/XML/YAML/contract files), and there is NO generic/LLM fallback for files no dedicated parser handles. `.jil`/`.pl`/proprietary XML are dropped entirely; `.sh` is read into a `file_structure` atom but dropped before the LLM by the scan-plan filter unless ctags happens to find symbols, and there is no shell-semantic pass. Net: a legacy system that is mostly shell + scheduler DSL + monitoring/connection config is ~invisible to discovery, even though the raw files are read into `file_structure` atoms (every text file ≤1MB already is).

## What D1 does
A NEW, ALWAYS-ON, pack-AGNOSTIC discovery pass (runs regardless of the language/framework/DB pack combo) that takes the "unknown-but-potentially-relevant" files no parser handles — shell (.sh), Autosys JIL (.jil), Perl (.pl), proprietary/monitoring XML (e.g. a 700-line Geneos config), messaging/connection config XML, CI config (.gitlab-ci.yml), etc. — and LLM-summarises EACH into a rich Finding describing what it does: purpose, what it invokes (other files, Java FQCNs, external commands), inputs/outputs (files, DB, env, network), side-effects, external systems it touches, and evidence snippets.

## Output fits the EXISTING findings model — NO schema change
Verified: `findingType` AND `category` are free-text/extensible (a new `operational_artifact` type/category needs no schema change); `detailJson` is open JSONB for the rich payload; `source`/`createdByStage` carry provenance; `confidence` carries trust; `reviewStatus` gives triage; findings can link to discovered candidates/entities/evidence atoms. So D1 reuses FindingEmitter (discovery-service) + the AMS DiscoveryFinding persistence with no new table/changeset.

## The load-bearing design point: relevance + cost gating
"Potentially-relevant" is load-bearing — an always-on LLM-reads-everything pass is expensive and noisy. D1 MUST gate: skip vendored/generated/binary/minified/test-fixture files; prioritise files that are invoked from elsewhere, sit in bin/scripts/ops/batch/etc. directories, or reference known entities/DB/external systems; cap volume; dedup; stamp confidence so the later completeness gate can rank. The raw material is free (file_structure atoms already exist); the only new cost is the gated LLM summarisation + the emission path.

## Standalone value
Even before any capability clustering, D1 immediately lets the (later) completeness gate say "here are 40 operational artifacts we found and summarised; account for them" instead of silence.

## Explicitly OUT of scope for D1 (these are D2)
- Capability/feature clustering (grouping the per-file findings + related entities into one coherent "nightly load pipeline" unit) — D2.
- The bespoke Autosys JIL parser (job topology / trigger DAG) — D2.
- Plain-Java main() batch-entrypoint recognition + JIL→shell→Java→DB invocation linkage — D2.
- The new `discovery_capability` grouping entity — D2.
D1 is PER-FILE summaries → findings ONLY.

## Owner
discovery-service (the new pass + the file-relevance gating + the emission to findings). No AMS schema change. No new Liquibase changeset.

## Repo conventions
discovery-service is TypeScript; tree-sitter jest isolation rules apply; never add a bare top-level require('tree-sitter'); only edit discovery-service/src when no discovery run is active. Findings persist via the existing FindingEmitter → AMS DiscoveryFinding.
