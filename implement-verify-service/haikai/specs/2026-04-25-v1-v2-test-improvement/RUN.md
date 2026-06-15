# Quick Start: Autoresearch Experiments for V1/V2 Testing

**Goal**: Improve V2 coverage from 39% → 70% using autoresearch methodology

---

## Setup (One-Time, 2 minutes)

```bash
# 1. Switch to v2 branch
cd /home/node/standards-extractor
git checkout feature/agentic-discovery-v2
git pull origin feature/agentic-discovery-v2

# 2. Create results tracking file
cat > autoresearch_results.tsv << 'EOF'
iter	hypothesis	file_changed	v2_total	grep_total	coverage_pct	status	notes
0	baseline	-	8100	20663	39.2	keep	current state per spec.md
EOF

# 3. Verify test runner works
python3 scripts/run_v2_50_repos.py --help || echo "Test runner ready"
```

---

## The Loop (Repeat 25 Times)

### Step 1: Pick Next Experiment

Consult `spec.md` experiment plan (sorted by priority).

**Phase 1 (Quick Wins)**:
- Iter 1: Confirm kibana object-key extraction
- Iter 2: Page-based-php conflict rule  
- Iter 3: Loosen Phase 10/11 trigger
- ... (see spec.md)

### Step 2: Read Current State

```bash
# Check latest results
tail -5 autoresearch_results.tsv

# Read playbook you're about to modify
cat playbooks/frameworks/<playbook>.yml

# Check current test results for affected repos
ls temp/v2_50_results/row_*.json | tail -10
```

### Step 3: Make ONE Change

**Example (Iteration 2): Add Laravel conflict rule**

```bash
# Edit playbook
nano playbooks/frameworks/page-based-php.yml
```

Add this block:
```yaml
conflict_rules:
  - if_framework: laravel
    action: drop
    reason: "Laravel has explicit routes, page-based should be fallback only"
```

### Step 4: Git Commit

```bash
git add playbooks/frameworks/page-based-php.yml
git commit -m "autoresearch iter 2: page-based-php drops when Laravel detected

Hypothesis: page-based-php is over-triggering on Laravel repos,
causing merger to collapse real Laravel routes.

Expected: +150 endpoints on firefly-iii, monica, invoiceninja

Test plan: Run V2 on these 3 repos, compare to baseline"
```

### Step 5: Run Verification

```bash
# Test affected repos only (faster feedback)
python3 scripts/run_v2_50_repos.py firefly-iii monica invoiceninja

# Or test all 50 (if change is cross-cutting)
python3 scripts/run_v2_50_repos.py
```

### Step 6: Extract Results

```bash
# Check individual repo results
cat temp/v2_50_results/row_firefly-iii.json | jq '{v2: .v2_unique, grep: .grep_count}'
cat temp/v2_50_results/row_monica.json | jq '{v2: .v2_unique, grep: .grep_count}'
cat temp/v2_50_results/row_invoiceninja.json | jq '{v2: .v2_unique, grep: .grep_count}'

# Sum up totals
python3 << 'PYEOF'
import json
from pathlib import Path

v2_total = 0
grep_total = 0
for f in Path("temp/v2_50_results").glob("row_*.json"):
    data = json.loads(f.read_text())
    v2_total += data.get("v2_unique", 0)
    grep_total += data.get("grep_count", 0)

coverage = (v2_total / grep_total * 100) if grep_total > 0 else 0
print(f"V2: {v2_total}, Grep: {grep_total}, Coverage: {coverage:.1f}%")
PYEOF
```

### Step 7: Compare to Baseline

```bash
# Previous iteration had:
# v2_total=8100, coverage=39.2%

# New results:
# v2_total=8250, coverage=40.0%  

# Delta: +150 endpoints, +0.8pp coverage ✓
```

### Step 8: Keep or Discard

**If improved (coverage increased)**:
```bash
# Keep the commit, advance branch
echo -e "2\tpage-based-php conflict\tplaybooks/frameworks/page-based-php.yml\t8250\t20663\t40.0\tkeep\t+150 endpoints on Laravel repos" >> autoresearch_results.tsv

# Branch is already advanced (commit kept)
```

**If worse or neutral**:
```bash
# Discard the change
git reset --hard HEAD~1

echo -e "2\tpage-based-php conflict\tplaybooks/frameworks/page-based-php.yml\t8100\t20663\t39.2\tdiscard\tno improvement, reverted" >> autoresearch_results.tsv
```

### Step 9: Log & Repeat

```bash
# Review progress
cat autoresearch_results.tsv

# Pick next experiment
# Go to Step 1
```

---

## Example: Full Iteration 1 (Kibana Test)

```bash
# --- ITERATION 1: Confirm Object-Key Extraction ---

# Step 1: Hypothesis
echo "Testing kibana object-key extraction (already implemented)"

# Step 2: Baseline
# Previous: kibana had 0 endpoints

# Step 3: No code change needed (already merged)

# Step 4: Skip commit (testing existing code)

# Step 5: Run verification
PYTHONIOENCODING=utf-8 PYTHONUTF8=1 AST_SKIP_CALLS=true \
  python3 scripts/run_v2_50_repos.py kibana

# Step 6: Check results
cat temp/v2_50_results/row_kibana.json | jq '{v2: .v2_unique, grep: .grep_count}'
# Output: {"v2": 107, "grep": 251}

# Step 7: Compare
# Before: 0 endpoints
# After: 107 endpoints  
# Delta: +107 ✓

# Step 8: Log result
echo -e "1\tobject-key extraction\tsrc/ast/v2/...\t8207\t20663\t39.7\tkeep\t+107 from kibana" >> autoresearch_results.tsv

# Step 9: Next iteration
echo "Moving to iteration 2: page-based-php conflict"
```

---

## Example: Full Iteration 3 (Loosen Phase 10/11 Trigger)

```bash
# --- ITERATION 3: Loosen Phase 10/11 Trigger ---

# Step 1: Hypothesis
echo "Phase 10/11 currently only fires when endpoints == 0"
echo "Change to fire when coverage < 30% of grep ground truth"

# Step 2: Read current state
cat src/ast/v2/discovery_agent.py | grep -A5 "if len(endpoints) == 0"

# Step 3: Edit code
nano src/ast/v2/discovery_agent.py

# Find this block:
#   if len(endpoints) == 0 and len(frameworks) == 0:
#       # Phase 11: playbook writer
#       trigger_playbook_writer()

# Change to:
#   verifier_count = run_verifier(project_root, language)
#   coverage_ratio = len(endpoints) / max(verifier_count, 1)
#   
#   if coverage_ratio < 0.3:  # Less than 30% of grep ground truth
#       if len(frameworks) == 0:
#           # Phase 11: playbook writer
#           trigger_playbook_writer()
#       else:
#           # Phase 10: LLM fallback
#           trigger_llm_fallback()

# Step 4: Commit
git add src/ast/v2/discovery_agent.py
git commit -m "autoresearch iter 3: loosen Phase 10/11 trigger to <30% coverage

Previously: Only fired when endpoints == 0
Now: Fires when endpoints < 30% of verifier count

Expected: Catch partial-coverage cases like kibana (107 vs 251)
Should trigger Phase 10 LLM fallback to fill gaps

Expected gain: +500 endpoints across 8-10 repos"

# Step 5: Run verification (test repos likely affected)
python3 scripts/run_v2_50_repos.py kibana discourse dotcms-core

# Step 6: Extract results
cat temp/v2_50_results/row_kibana.json | jq '{v2: .v2_unique, grep: .grep_count}'
# Expected: v2 increases from 107 → 200+ (Phase 10 fills gaps)

# Step 7: Sum totals across all repos
# ... (run full benchmark or sample)

# Step 8: If coverage improved, keep. If not, revert.

# Step 9: Log
echo -e "3\tloosen Phase10/11 trigger\tsrc/ast/v2/discovery_agent.py\t8750\t20663\t42.4\tkeep\t+543 from partial-coverage repos" >> autoresearch_results.tsv
```

---

## Monitoring Progress

### After Every 5 Iterations

```bash
# Plot progress
python3 << 'PYEOF'
import csv

with open("autoresearch_results.tsv") as f:
    reader = csv.DictReader(f, delimiter="\t")
    for row in reader:
        if row["status"] == "keep":
            print(f"Iter {row['iter']:>2}: {row['coverage_pct']:>5}% ({row['hypothesis']})")
PYEOF

# Expected output:
# Iter  0: 39.2% (baseline)
# Iter  1: 39.7% (object-key extraction)
# Iter  2: 40.0% (page-based-php conflict)
# Iter  3: 42.4% (loosen Phase10/11)
# ...
# Iter 25: 68.5% (final)
```

### Identify Patterns

```bash
# Which types of changes work best?
grep "keep" autoresearch_results.tsv | awk -F'\t' '{print $2}' | sort | uniq -c | sort -rn

# Example output:
#   5 playbook expansion
#   3 conflict rule addition
#   2 detection tuning
#   1 Phase 10 improvement
```

---

## Red Flags (Stop & Investigate)

### If 5+ Consecutive Discards

```bash
# Count recent failures
tail -10 autoresearch_results.tsv | grep "discard" | wc -l

# If >= 5, you're stuck:
# - Switch to different framework
# - Try radical idea (not incremental tweaks)
# - Investigate assumptions (is grep ground truth correct?)
```

### If Coverage Drops >2pp

```bash
# This means you broke something

# Immediately revert
git reset --hard HEAD~1

# Investigate what went wrong
git log -1 --stat
git diff HEAD~1 HEAD
```

### If Verification Fails on >10% of Repos

```bash
# Precision problem (false positives)

# Check verifier output
grep "verification: FAIL" temp/v2_50_results/row_*.json | wc -l

# If >5 repos failing:
# - Playbook is too aggressive
# - Detection is matching wrong frameworks
# - Rollback and tighten constraints
```

---

## Shortcuts & Tips

### Test Single Repo Quickly

```bash
# Instead of full 50-repo run (4 hours)
# Test one repo in 3-5 minutes

python3 scripts/run_v2_50_repos.py spring-petclinic

# Check result
cat temp/v2_50_results/row_spring-petclinic.json | jq '.'
```

### Diff Two Iterations

```bash
# See what changed between iterations

# Before (iter 2)
git show HEAD~1:playbooks/frameworks/page-based-php.yml > /tmp/before.yml

# After (iter 3)  
git show HEAD:playbooks/frameworks/page-based-php.yml > /tmp/after.yml

# Diff
diff -u /tmp/before.yml /tmp/after.yml
```

### Bulk Test Affected Repos

```bash
# If you changed Symfony playbook, test all PHP repos

python3 scripts/run_v2_50_repos.py \
  akeneo-pim dolibarr ampache firefly-iii monica \
  invoiceninja passbolt piwigo shopware
```

---

## Success Metrics

Track these after every iteration:

| Metric | Baseline | Target | Stretch |
|--------|----------|--------|---------|
| **Coverage %** | 39.2% | 60% | 70% |
| **Repos ≥80%** | 14 | 30 | 40 |
| **Zero-endpoint repos** | 14 | 5 | 2 |
| **Precision** | ~90% | 92% | 95% |

```bash
# Calculate current metrics
python3 << 'PYEOF'
import json
from pathlib import Path

total_v2 = 0
total_grep = 0
repos_80_plus = 0
repos_zero = 0
total_repos = 0

for f in Path("temp/v2_50_results").glob("row_*.json"):
    data = json.loads(f.read_text())
    v2 = data.get("v2_unique", 0)
    grep = data.get("grep_count", 0)
    
    total_v2 += v2
    total_grep += grep
    total_repos += 1
    
    if grep > 0:
        ratio = v2 / grep
        if ratio >= 0.8:
            repos_80_plus += 1
    
    if v2 == 0:
        repos_zero += 1

coverage = (total_v2 / total_grep * 100) if total_grep > 0 else 0

print(f"Coverage: {coverage:.1f}%")
print(f"Repos ≥80%: {repos_80_plus}/{total_repos}")
print(f"Zero-endpoint repos: {repos_zero}/{total_repos}")
PYEOF
```

---

## When to Stop

**Minimum Viable (Ship It)**:
- ✅ Coverage ≥ 50%
- ✅ 10 iterations completed
- ✅ At least 3 playbook improvements merged

**Target (Great Outcome)**:
- ✅ Coverage ≥ 60%  
- ✅ 20 iterations completed
- ✅ Repos ≥80% increased from 14 → 30+

**Stretch (Amazing)**:
- ✅ Coverage ≥ 70%
- ✅ All 25 iterations completed
- ✅ Comprehensive autoresearch_learnings.md written

---

## Troubleshooting

### Test Runner Fails

```bash
# Check Python dependencies
python3 -c "import yaml; import tree_sitter; print('OK')"

# If missing:
pip3 install pyyaml tree-sitter

# Check LLM proxy (if using Phase 10)
curl http://localhost:3456/v1/models
```

### Results Don't Match Expected

```bash
# Verify grep ground truth
cd temp/repos/spring-petclinic
grep -r "GetMapping\|PostMapping\|RequestMapping" src/ | wc -l

# Compare to recorded grep count
cat ../../v2_50_results/row_spring-petclinic.json | jq '.grep_count'
```

### Git State Confused

```bash
# If you accidentally kept a bad change

# View history
git log --oneline -10

# Reset to known-good state
git reset --hard <commit_hash_of_baseline>

# Restart from there
```

---

## Final Checklist

Before starting autoresearch:

- [ ] On `feature/agentic-discovery-v2` branch
- [ ] `autoresearch_results.tsv` created with baseline row
- [ ] Test runner works: `python3 scripts/run_v2_50_repos.py spring-petclinic`
- [ ] Have spec.md open in editor for experiment plan
- [ ] Ready to iterate for 2-3 hours (Phase 1 complete)

**Let's iterate!** 🚀

Time to first improvement: ~10 minutes (Iteration 1)  
Time to 50% coverage: ~2 hours (Phase 1 complete)  
Time to 60% coverage: ~6 hours (Phase 2 complete)  
Time to 70% coverage: ~14 hours (all phases complete)
