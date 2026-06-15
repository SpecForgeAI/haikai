# Autoresearch Analysis: Improving V1/V2 Test Effectiveness

**Date**: 2026-04-25  
**Branch**: feature/agentic-discovery-v2  
**Parent Spec**: `2026-04-25-v1-v2-state/spec.md`  
**Methodology**: Autoresearch (constraint + metric + iteration = compounding gains)

---

## Executive Summary

Current V2 test effectiveness: **39% of grep ground truth** (8,100 / 20,663 endpoints).

Using autoresearch methodology, we identify **8 high-impact experiments** that could boost V2 from 39% → **70%+ coverage** within 25 iterations.

**Key Insight**: The test suite itself is the "training loop" — each playbook improvement = one experiment. We have the constraint (50 repos), the metric (% of grep), and fast verification (<5 min per repo). We just need to apply autoresearch's systematic iteration strategy.

---

## Autoresearch Framing

### The Constraint
- **Scope**: 50-repo benchmark (fixed test set)
- **Time Budget**: ~5 min verification per repo
- **Mechanical**: Deterministic playbook execution (no randomness)

### The Metric
**Primary**: `coverage_pct = (v2_endpoints / grep_ground_truth) × 100`

**Secondary metrics**:
- Precision = endpoints found that match verification
- False positive rate = endpoints found that don't exist
- Repo coverage = % of 50 repos at ≥80% grep

### Fast Verification
Each experiment verifies in <5 minutes:
1. Edit playbook YAML (1 min)
2. Run `run_v2_50_repos.py <repo>` (3-5 min for single repo)
3. Compare to grep ground truth
4. Keep if improved, discard if worse

### Current Baseline

| Metric | V1 (Sonnet) | V2 (Playbooks) | Gap |
|--------|-------------|----------------|-----|
| Total endpoints | 21,850 | 8,100 | -13,750 (-63%) |
| vs Grep (20,663) | 106% | 39% | -67pp |
| Repos ≥80% grep | ~45/50 | 14/50 | -31 repos |
| Cost per run | $5-10 (LLM) | $0 (deterministic) | - |

**Problem**: V2 is 97% cheaper but 67pp less accurate.

---

## Root Cause Analysis (Autoresearch Phase 0)

Before iterating, understand **why** V2 underperforms:

### Issue #1: Missing Playbooks (12 repos at 0%)
**Repos**: kibana, gerrit, gitea, opensearch, mautic, monica, opencart, orangehrm, phpbb, suitecrm, wordpress, odoo

**Cause**: No playbook matches framework detection
- Kibana: Uses object-literal routing (`router.versioned.get({path:...})`)
- GitLab Go: Custom routing DSL  
- WordPress: Plugin-based, no central route file

**Fix experiments**:
1. Add object-key path extraction (already in flight per spec)
2. Create GitLab-go playbook  
3. Create WordPress plugin-routes playbook
4. Loosen Phase 10/11 trigger to fire on low coverage (not just 0)

**Expected gain**: +107 endpoints (kibana alone) + ~500 from others = **+600 total**

---

### Issue #2: Over-Restrictive Playbooks (8 repos at 30-80%)
**Repos**: mastodon (366→103 after only:/except:), akeneo, passbolt, mantisbt

**Cause**: Playbooks too strict, missing valid routes
- Mastodon: Rails `only:`/`except:` parser too aggressive (or correct but grep is wrong)
- Akeneo: Symfony annotation variants not all covered

**Fix experiments**:
5. Audit mastodon ground truth manually (is 103 or 366 correct?)
6. Add missing Symfony annotation patterns to playbook
7. Expand PHP attribute detection (.scm file) to cover `#[Route]` variants

**Expected gain**: +200-300 endpoints if patterns expanded

---

### Issue #3: Page-Based PHP False Positives
**Repos**: Laravel-based repos (firefly-iii, monica, invoiceninja)

**Cause**: page-based-php playbook fires on Laravel, merger drops real routes

**Fix experiments**:
8. Add conflict_rule: `{if: laravel_detected, drop: page-based-php}`
9. Or make page-based-php priority-low (fallback only)

**Expected gain**: +150 endpoints (restore collapsed Laravel routes)

---

### Issue #4: Phase 10 Insufficient for Large Repos
**Repos**: Kibana (returned `[]` in 5.5 min), discourse (1106 vs 1156)

**Cause**: Single-prompt LLM fallback can't handle 14KB evidence packs

**Fix experiments**:
10. Multi-turn Phase 10 (like V1's cli-delegated approach)
11. Evidence pack chunking (split by directory, run parallel)
12. Increase timeout + use claude-opus-4-6 for complex repos

**Expected gain**: +2,000 endpoints (kibana + other large repos)

---

### Issue #5: Detection False Positives
**Repos**: yii2 on espocrm/owncloud (detects but emits 0)

**Cause**: Framework detector matches on weak signals (file globs too generic)

**Fix experiments**:
13. Increase confidence threshold for detection (0.6 → 0.75)
14. Add negative signals (e.g., "if has composer.json with 'laravel', don't detect as yii2")
15. Gate playbooks with `min_confidence: 0.8` for high-FP frameworks

**Expected gain**: -50 false positives, +0 real endpoints (precision improvement)

---

## Autoresearch Experiment Plan

### Phase 1: Quick Wins (Iterations 1-8)

**Goal**: Low-hanging fruit with high confidence

| Iter | Experiment | File Changed | Expected Δ | Time |
|------|------------|--------------|------------|------|
| 1 | Confirm object-key extraction (kibana) | Already done | +107 | 3 min |
| 2 | Add conflict_rule for page-based-php | playbooks/frameworks/page-based-php.yml | +150 | 5 min |
| 3 | Loosen Phase 10/11 trigger (0 → <30% grep) | src/ast/v2/discovery_agent.py | +500 | 10 min |
| 4 | Add wordpress-plugin-routes playbook | playbooks/frameworks/wordpress.yml | +80 | 15 min |
| 5 | Add gitlab-go playbook | playbooks/frameworks/gitlab-go.yml | +120 | 15 min |
| 6 | Audit mastodon ground truth (manual) | None (investigation) | TBD | 20 min |
| 7 | Expand Symfony #[Route] variants | queries/annotations/php.scm | +50 | 10 min |
| 8 | Increase detection confidence threshold | src/ast/v2/framework_detector.py | +0/-50 | 5 min |

**Cumulative after Phase 1**: +1,007 endpoints → **44% coverage** (9,107 / 20,663)

---

### Phase 2: Medium Effort (Iterations 9-16)

**Goal**: Playbook expansions and refinements

| Iter | Experiment | File Changed | Expected Δ | Time |
|------|------------|--------------|------------|------|
| 9 | Multi-turn Phase 10 (like V1) | src/ast/v2/discovery_agent.py | +1,000 | 30 min |
| 10 | Evidence pack chunking | src/ast/v2/discovery_agent.py | +500 | 20 min |
| 11 | Add Akeneo-specific annotation patterns | queries/annotations/php.scm | +80 | 15 min |
| 12 | Review+promote 9 staged playbooks | playbooks/proposed/ → frameworks/ | +300 | 30 min |
| 13 | Add negative detection signals | playbooks/frameworks/*.yml | +0/-30 | 20 min |
| 14 | Test claude-opus-4-6 on Phase 10 | src/ast/v2/discovery_agent.py | +200 | 10 min |
| 15 | Add Drupal 10 route variants | playbooks/frameworks/drupal.yml | +50 | 10 min |
| 16 | Fine-tune Rails only:/except: parser | queries/configs/rails_dsl.py | +100 | 25 min |

**Cumulative after Phase 2**: +2,230 endpoints → **55% coverage** (11,337 / 20,663)

---

### Phase 3: Advanced (Iterations 17-25)

**Goal**: Framework-specific deep dives

| Iter | Experiment | Expected Δ | Time |
|------|------------|------------|------|
| 17 | Add Go Gin framework playbook | +150 | 20 min |
| 18 | Add Python FastAPI decorators | +120 | 15 min |
| 19 | Add Ruby Sinatra routes | +80 | 15 min |
| 20 | Expand NestJS decorator coverage | +40 | 10 min |
| 21 | Add PHP Laravel 10 route variants | +60 | 10 min |
| 22 | Test streaming on all Phase 10 calls | +300 | 15 min |
| 23 | Add evidence_globs to 10 playbooks | +200 | 20 min |
| 24 | Combine best playbooks (ensemble) | +150 | 25 min |
| 25 | Re-run full 50-repo benchmark | 0 (validation) | 4 hours |

**Cumulative after Phase 3**: +1,100 endpoints → **60% coverage** (12,437 / 20,663)

---

## The Autoresearch Loop (Apply This)

```
LOOP (25 iterations):
  1. Pick next experiment from priority queue (sorted by expected Δ / time)
  2. Read current state: results.tsv, playbook YAML, detection logic
  3. Make ONE focused change (edit 1 file)
  4. Git commit with hypothesis
  5. Run verification: python3 scripts/run_v2_50_repos.py <affected_repos>
  6. Compare: new_coverage vs baseline_coverage
  7. If improved → keep (advance branch)
  8. If worse → git reset (discard)
  9. Log to results.tsv: iter, hypothesis, Δ_coverage, status
  10. Repeat until coverage ≥ 70% or 25 iterations exhausted
```

**Critical**: ONE change per iteration. Don't bundle "add wordpress playbook + fix laravel conflict" — can't tell which worked.

---

## Expected Results (Probabilistic)

### Conservative Estimate (50% of expected Δ realized)
- Phase 1: +500 endpoints → 46% coverage
- Phase 2: +1,100 endpoints → 51% coverage  
- Phase 3: +550 endpoints → 54% coverage
- **Final**: 11,250 / 20,663 = **54% coverage**

### Optimistic Estimate (80% of expected Δ realized)
- Phase 1: +800 endpoints → 44% coverage
- Phase 2: +1,800 endpoints → 58% coverage
- Phase 3: +880 endpoints → 63% coverage
- **Final**: 13,080 / 20,663 = **63% coverage**

### Best Case (100% + compounding discoveries)
- Phase 1: +1,000 endpoints → 44% coverage
- Phase 2: +2,200 endpoints → 55% coverage
- Phase 3: +1,100 endpoints → 60% coverage
- **Bonus**: Discover 3 new high-impact patterns → +2,000
- **Final**: 14,400 / 20,663 = **70% coverage**

---

## Key Autoresearch Principles Applied

### 1. Constraint = Enabler
**Constraint**: Only edit playbook YAML or .scm files (keep engine generic)

**Why it helps**: Forces us to find general solutions, not one-off hacks. Every playbook improvement helps ALL repos that match that framework.

### 2. Mechanical Metric
**Metric**: `coverage_pct = v2_endpoints / grep_ground_truth`

**Why it works**:
- Vocab-size-independent (like val_bpb in ML)
- Comparable across frameworks (Java vs PHP vs Ruby)
- Fast to compute (<1 sec)
- No human judgment needed

### 3. Fast Verification
**Timing**: 3-5 min per repo, <5 hours for all 50

**Why it enables iteration**: Can run 12 experiments/hour on single repos, 2-3 full benchmarks per day.

### 4. Pattern Recognition from History
**After every 5 experiments**, analyze results.tsv:
- Which playbook edits consistently improve?
- Which frameworks respond to annotation expansion?
- Which detection tweaks reduce FPs without losing TPs?

**Build mental model**: "Symfony routes respond well to annotation .scm expansion. Laravel routes need conflict rules to not collide with page-based-php."

### 5. Simplicity Criterion
**Rule**: Prefer deleting code over adding it

**Example**:
- Bad: Add 10 new detection signals → playbook is now 200 lines
- Good: Remove `manifest_contains: express` (false positive source) → simpler + more accurate

### 6. Learn from Failures
**If 3 experiments in a row discard**:
- Switch to different framework (stop beating dead horse)
- Try radical idea (multi-turn Phase 10 instead of single-prompt tweaks)
- Investigate assumption (maybe grep ground truth is wrong, not playbook)

### 7. One Change Per Experiment
**Bad**: "Add wordpress playbook + fix laravel conflict + expand symfony annotations"
→ If coverage jumps +200, which change mattered?

**Good**: 
- Iter 4: Add wordpress playbook → +80
- Iter 5: Fix laravel conflict → +150  
- Iter 6: Expand symfony annotations → +50
→ Clear attribution, build knowledge

---

## Implementation: Start Immediately

### Setup (5 min)
```bash
cd /home/node/standards-extractor
git checkout feature/agentic-discovery-v2
git pull origin feature/agentic-discovery-v2

# Create results tracking
echo -e "iter\thypothesis\tfile_changed\tv2_total\tgrep_total\tcoverage_pct\tstatus\tnotes" > autoresearch_results.tsv
echo -e "0\tbaseline\t-\t8100\t20663\t39.2\tkeep\tcurrent state per spec.md" >> autoresearch_results.tsv
```

### Iteration 1 (Confirm object-key extraction)
```bash
# Test kibana specifically
PYTHONIOENCODING=utf-8 PYTHONUTF8=1 AST_SKIP_CALLS=true \
  python3 scripts/run_v2_50_repos.py kibana

# Check results
cat temp/v2_50_results/row_kibana.json | jq '.v2_unique'

# Expected: ~107 (up from 0)
# If yes: log to results.tsv, keep commit
# If no: investigate, fix object-key extraction, retry
```

### Iteration 2 (Page-based-php conflict rule)
```bash
# Edit playbook
vim playbooks/frameworks/page-based-php.yml
# Add: conflict_rules: [{if_framework: laravel, action: drop}]

git add playbooks/frameworks/page-based-php.yml
git commit -m "autoresearch iter 2: page-based-php conflict with Laravel"

# Test affected repos
python3 scripts/run_v2_50_repos.py firefly-iii monica invoiceninja

# Compare totals, log result
```

### Continue Loop
Repeat for all 25 iterations following the experiment plan above.

---

## Success Criteria

### Minimum Viable (Ship It)
- ✅ Coverage ≥ 50% (10,300 / 20,663 endpoints)
- ✅ Repos ≥80% grep: 20+ (up from 14)
- ✅ Zero-endpoint repos: <10 (down from 14)

### Target (Great Outcome)
- ✅ Coverage ≥ 60% (12,400 / 20,663 endpoints)
- ✅ Repos ≥80% grep: 30+ 
- ✅ Precision ≥ 90% (verification passes)

### Stretch (Amazing)
- ✅ Coverage ≥ 70% (14,500 / 20,663 endpoints)
- ✅ Repos ≥80% grep: 40+
- ✅ V2 beats V1 on cost-adjusted accuracy metric

---

## Comparison to ML Autoresearch (Karpathy)

| Aspect | ML Autoresearch (train.py) | V1/V2 Testing (this spec) |
|--------|---------------------------|---------------------------|
| **Metric** | val_bpb (lower is better) | coverage_pct (higher is better) |
| **Constraint** | 630-line train.py, 5-min GPU budget | 18 playbooks, 50-repo test set |
| **Iteration** | Edit Python (arch/LR/optimizer) | Edit YAML (playbooks/detection) |
| **Verification** | Train model, eval on validation set | Run V2 discovery, compare to grep |
| **Time per iter** | ~5 min (GPU training) | ~3-5 min (single repo test) |
| **Cost per iter** | $0.50 (H100 time) | $0 (deterministic, no LLM) |
| **Baseline** | 1.0050 val_bpb | 39% coverage |
| **Target** | 0.9900 val_bpb (1.5% improvement) | 60% coverage (54% improvement) |
| **Iterations** | 100+ overnight | 25 in this spec |
| **Learning** | From results.tsv (what worked) | From results.tsv (which playbooks) |
| **Simplicity** | Delete code if same val_bpb | Delete detection signals if FPs |

**Key insight**: Both are autoresearch problems! Just different domains (ML vs endpoint discovery).

---

## Next Steps

1. **Immediate**: Run Iteration 1 (kibana object-key test) — 3 min
2. **Today**: Complete Phase 1 (iterations 1-8) — 2 hours
3. **This Week**: Complete Phase 2 (iterations 9-16) — 4 hours
4. **This Sprint**: Complete Phase 3 (iterations 17-25) — 8 hours

**Total time investment**: ~14 hours of focused iteration  
**Expected output**: 50-70% coverage (vs 39% baseline)  
**ROI**: 1.28-1.79x accuracy improvement for 14 hours of work

---

## Monitoring & Observability

Create dashboard tracking:
- Coverage % over iterations (expect monotonic increase if doing well)
- Repos at ≥80% (leading indicator of quality)
- Zero-endpoint repos (lagging indicator, fix with Phase 10/11)
- False positive rate (from verification failures)

**Red flags** (stop and investigate):
- 5+ consecutive discards → switch strategy
- Coverage drops >2pp → bad change, revert immediately  
- Verification fails on >10% of repos → precision problem

---

## Autoresearch Meta-Learning

**After 25 iterations, write**:
- `autoresearch_learnings.md` — what worked, what didn't
- Top 5 playbook patterns that consistently improve
- Top 5 dead ends to avoid
- Generalize to: "Autoresearch playbook for autoresearch playbooks" (meta!)

This becomes the knowledge base for the NEXT autoresearch cycle on V3.

---

**Status**: Ready to execute  
**Estimated completion**: 2026-04-27 (3 days of focused work)  
**Risk**: Low (all changes reversible, fast verification)  
**Upside**: 1.5-1.8x accuracy improvement, systematic knowledge capture

Let's iterate! 🚀
