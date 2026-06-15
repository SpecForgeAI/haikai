# Rubric — task group g1 (text-utilities polyrepo)

Score each repo's change against these qualitative signals. PASS requires all.

- **Pure stdlib**: no third-party imports in the feature module (only stdlib).
- **Typed signature**: the public function has complete type hints.
- **Input guard**: None input raises TypeError (not a silent crash).
- **Edge coverage**: tests cover empty/degenerate input and at least one boundary case.
- **No dead scope**: no unused config, caching, or alternative-separator code paths.

Report: PASS or FAIL per repo, with one sentence of evidence each.
