# Benchmark Design: Standards Extractor vs. Industry Benchmarks

> How do we position Standards Extractor against the benchmarks that the coding agent market actually uses?

---

## 1. The Landscape — What Exists and How They Work

### Tier 1: Automated, Independent, Reproducible

| Benchmark | Who Runs It | What It Tests | Input Format | Output Format | Scoring |
|-----------|-------------|---------------|--------------|---------------|---------|
| **SWE-bench Verified** | Princeton NLP / Epoch AI | Fix real GitHub issues end-to-end | Issue description + repo snapshot (Docker) | Git patch (diff) | Binary pass/fail per test suite (% resolved) |
| **SWE-bench Pro** (Scale AI) | Scale AI | Harder variant — proprietary codebases | Same as SWE-bench | Git patch | % resolved (top agents ~23%) |
| **FeatureBench** | Academic (Feb 2026) | Multi-commit feature development across repos | Feature spec + repo state | Multi-file implementation | Test pass rate (Claude Opus 4.5 = 11%) |
| **AIMultiple Agent Benchmark** | AIMultiple (independent) | 10 full-stack web dev tasks | Task spec as TASK.md | Running web app (backend + frontend) | Backend smoke tests + UI smoke tests (0.7×backend + 0.3×UI) |
| **Aider Polyglot** | Aider / Epoch AI | 225 Exercism problems across 6 languages | Problem description + starter code + tests | Completed function | Test pass rate (Pass@1, 2 attempts) |
| **Epoch AI SWE-bench** | Epoch AI | Standardized re-run of SWE-bench Verified | Same as SWE-bench | Git patch | % resolved with controlled scaffold |
| **ai-agents-benchmark.com** | Independent | Build a full CRM SaaS from spec | Natural language app spec | Deployed web app | Manual + functional scoring (1-10) |

### Tier 2: Self-Reported / Vendor-Specific

| Benchmark | Who Runs It | Notes |
|-----------|-------------|-------|
| **CursorBench** | Cursor (vendor) | Traces from real Cursor usage → task extraction. Not public. |
| **cline-bench** | Cline (vendor) | Real engineering tasks from Cline users. Early stage. |
| **Terminal-Bench 2.0** | Community | Terminal task completion. Used by Codex/Claude Code. |
| **LogRocket Power Rankings** | LogRocket (editorial) | 50+ feature scoring, weighted rubric — not an automated benchmark. |

### Tier 3: Model-Level (Not Agent-Level)

| Benchmark | Notes |
|-----------|-------|
| **HumanEval** | Function-level. Tests the model, not the agent. Already in our Phase 1. |
| **LiveCodeBench** | Competitive programming. Model-level. Already in our Phase 5. |
| **RepoBench** | Cross-file understanding. Model-level. Already in our Phase 2. |

---

## 2. Compatibility Analysis — What Can Standards Extractor Actually Run?

### How Our App Works (the three modes)

| Mode | Endpoint | What It Does |
|------|----------|-------------|
| **A: Direct** | `POST /shape-spec/stream` | Prompt → LLM → response (through our conversational API) |
| **B: With Standards** | Standards extraction → `POST /shape-spec/stream` | Extract coding standards from a codebase, inject as context, then generate |
| **C: Full Pipeline** | `POST /orchestrations` | Prompt → shape-spec → write-spec → create-tasks → implement-tasks → verification report |

### Compatibility Matrix

| Benchmark | Input Compat | Output Compat | Mode A | Mode B | Mode C | Effort | Notes |
|-----------|-------------|---------------|--------|--------|--------|--------|-------|
| **SWE-bench Verified** | ⚠️ Medium | ⚠️ Medium | ✅ | ✅ | ✅ | `L` | Need adapter: issue→prompt, response→patch, Docker eval harness |
| **SWE-bench Pro** | ⚠️ Medium | ⚠️ Medium | ✅ | ✅ | ✅ | `L` | Same as Verified but need Scale AI access |
| **FeatureBench** | ✅ High | ⚠️ Medium | ✅ | ✅ | ✅ | `M` | Feature specs map well to our shape-spec input. Multi-file output needs assembly. |
| **AIMultiple** | ✅ High | ⚠️ Medium | ✅ | ✅ | ✅ | `M` | TASK.md → our prompt. Need backend/UI smoke test runner + deployment step. |
| **Aider Polyglot** | ✅ High | ✅ High | ✅ | ✅ | ❌ | `S` | Problem+tests→prompt→code→run tests. Mode C overkill for function-level. |
| **ai-agents-benchmark** | ✅ High | ⚠️ Medium | ✅ | ✅ | ✅ | `L` | Full CRM spec as input. Need deployment + manual/automated evaluation. |
| **CursorBench** | ❌ | ❌ | — | — | — | — | Not public. Cannot reproduce. |
| **cline-bench** | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ⚠️ | ? | Early stage. Format not yet standardized. Watch but don't invest yet. |
| **Terminal-Bench** | ⚠️ Low | ⚠️ Low | ⚠️ | ❌ | ❌ | `M` | Tests terminal/shell execution — we'd need to route through our API's command execution layer. Already in Phase 6. |

### Key Insight: Where Standards Extractor Has a Unique Angle

Most benchmarks test: **"given a problem, produce code."**

Our app tests: **"given a problem, produce _standards-aware, spec-driven_ code through a structured pipeline."**

No existing benchmark measures the _value of standards extraction and spec-driven development_. That's our differentiator. The design should prove:

1. **Do standards help?** — Mode A vs Mode B on the same benchmark
2. **Does the full pipeline help?** — Mode A vs Mode C on the same benchmark
3. **Where in the pipeline does value accrue?** — Per-stage attribution on DevBench/FeatureBench

---

## 3. The Design — What to Benchmark and How

### Priority Order (based on market credibility + compatibility + effort)

#### 🥇 Priority 1: SWE-bench Verified — The Must-Have Number
**Why:** Every coding agent is measured against this. Without it, you're not in the conversation.

**Input format:** GitHub issue description (text) + repository at a specific commit (Docker image)
**Expected output:** A git patch that makes failing tests pass
**Our approach:**
```
Issue description
    → Mode A: /shape-spec/stream → extract code from response → git diff
    → Mode B: Extract standards from the repo first → inject → generate
    → Mode C: /orchestrations → extract implemented code → git diff
```
**Adapter needed:**
- Download SWE-bench dataset (HuggingFace: `princeton-nlp/SWE-bench_Verified`)
- For each issue: spin up Docker container with repo at correct commit
- Transform issue text → API prompt
- Parse response → extract code changes → format as unified diff/patch
- Apply patch in container → run test suite → score pass/fail
- Use SWE-bench's own evaluation harness (`swebench.harness.run_evaluation`)

**Key challenge:** Output format. Our API returns conversational text with embedded code, not clean patches. The adapter needs robust code extraction + diff generation.

**Scoring:** `resolved_rate = passed / total` (standard SWE-bench metric)

---

#### 🥈 Priority 2: FeatureBench — Our Natural Fit
**Why:** Multi-commit feature development is exactly what our full pipeline does. This is where Mode C should shine.

**Input format:** Feature specification + repository state + dependency graph
**Expected output:** Multi-file implementation that passes unit tests
**Our approach:**
```
Feature spec (from FeatureBench dataset)
    → Mode C: shape-spec → write-spec → create-tasks → implement-tasks
    → Collect all generated files
    → Run FeatureBench's test suite
```
**Adapter needed:**
- Download FeatureBench (200 tasks, 24 repos, HuggingFace)
- Map feature spec → shape-spec prompt (natural fit — these ARE specs)
- Collect multi-file output from orchestration → place in repo
- Run FeatureBench's evaluation framework

**Why this is our differentiator:** Claude Opus 4.5 scores 11% on this with raw prompting. If our spec-driven pipeline pushes that meaningfully higher, that's our marketing story.

---

#### 🥉 Priority 3: AIMultiple-Style Full-Stack Benchmark — The Real-World Test
**Why:** Tests end-to-end app generation, which is what the orchestration pipeline is built for. The methodology is public and reproducible.

**Input format:** Task specification (natural language, equivalent to TASK.md)
**Expected output:** Running web application (backend API + frontend UI)
**Our approach:**
```
Task spec
    → Mode C: Full pipeline → generates project files
    → Deploy locally (Docker/localhost)
    → Run automated backend smoke tests (HTTP assertions)
    → Run automated UI smoke tests (Playwright/Selenium)
    → Score: 0.7 × backend + 0.3 × UI
```
**Adapter needed:**
- Design 10 full-stack tasks (or reuse AIMultiple's methodology)
- Build smoke test framework:
  - Backend: health checks, CRUD operations, auth flows, error handling
  - UI: page renders, form submission, navigation, no crashes
- Deployment step: take generated files → `docker-compose up` → test

**Key challenge:** Our pipeline generates specs/tasks/code but doesn't deploy. Need a deployment bridge.

---

#### Priority 4: Aider Polyglot — Quick Win, Cross-Language
**Why:** Easy to set up, tests multi-language capability, comparable to a well-known leaderboard. Good for initial credibility.

**Input format:** Problem description + starter code + test file (per language: Python, JS, Java, Go, C++, Rust)
**Expected output:** Completed function that passes tests
**Our approach:**
```
Problem + starter code
    → Mode A: /shape-spec/stream → extract code → run tests
    → Mode B: Inject language-specific standards → generate → run tests
```
**Adapter needed:**
- Clone `Aider-AI/polyglot-benchmark` (225 problems)
- For each problem: format prompt with problem description + starter code
- Parse generated code → write to file → run test suite
- 2 attempts per problem (matches Aider's methodology)

**Scoring:** `pass_rate = problems_passed / total` (per language + aggregate)

---

#### Priority 5: Custom Standards Quality Benchmark — Our Unique Moat
**Why:** No one else benchmarks this. It's our only defensible differentiator.

Already designed in roadmap Phase 7. The three tests:
1. **Extraction Accuracy** — Can we extract standards that match a repo's known style guide?
2. **Standards Impact** — Does injecting standards reduce style violations?
3. **Round-Trip Consistency** — Extract → generate → re-extract → same standards?

---

### Not Pursuing (and Why)

| Benchmark | Reason |
|-----------|--------|
| CursorBench | Proprietary, not public |
| cline-bench | Too early, format unstable |
| ai-agents-benchmark.com CRM test | Cool but one-off, not reproducible at scale. Use AIMultiple methodology instead. |
| SWE-bench Pro | Requires Scale AI partnership/access. Pursue after Verified is solid. |
| Terminal-Bench | Tests shell execution, not our core value prop. Keep in roadmap Phase 6 but deprioritize. |

---

## 4. Input/Output Mapping — Technical Detail

### Standard Flow: Benchmark Problem → Our API → Evaluation

```
┌─────────────────────────┐
│   Benchmark Dataset      │
│   (HuggingFace/GitHub)   │
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│   Adapter Layer          │  ← NEW: per-benchmark adapter
│   • Transform input      │
│   • Map to API format    │
│   • Select mode (A/B/C)  │
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│   Standards Extractor    │
│   API                    │
│   • /shape-spec/stream   │  ← Mode A & B
│   • /orchestrations      │  ← Mode C
│   • /standards/generate  │  ← Mode B (pre-step)
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│   Output Parser          │  ← NEW: per-benchmark parser
│   • Extract code blocks  │
│   • Format as patch/diff │
│   • Write to file system │
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│   Evaluation Harness     │
│   • Run benchmark tests  │  ← Existing harness per benchmark
│   • Score pass/fail      │
│   • Compute metrics      │
└─────────┬───────────────┘
          │
          ▼
┌─────────────────────────┐
│   Results + Learnings    │  ← Existing results pipeline
│   • JSON scores          │
│   • Markdown reports     │
│   • Learnings docs       │
└─────────────────────────┘
```

### Input/Output Format Comparison

| Benchmark | Raw Input | → API Input | API Output → | → Eval Format |
|-----------|-----------|-------------|-------------|---------------|
| **SWE-bench** | Issue text + repo Docker image | Prompt: "Fix this issue: {description}\n\nRepo context: {key files}" | Streamed text with code blocks | Git patch (unified diff) |
| **FeatureBench** | Feature spec + repo state | Prompt: shape-spec with feature requirements | Orchestration output (spec→tasks→code) | Multi-file changeset placed in repo |
| **AIMultiple** | TASK.md (natural language spec) | Prompt: "Build this: {task_spec}" | Full project files from pipeline | Deployed app → HTTP + Playwright tests |
| **Aider Polyglot** | Problem desc + starter code + tests | Prompt: "Complete this function: {description}\n```{lang}\n{starter}```" | Code in response | Function file → run test suite |
| **Custom Standards** | Source repo with known style guide | `/standards/generate` with repo path | Standards document (markdown) | Compare against ground truth style guide |

### The Hard Part: Output Parsing

Our API returns conversational SSE streams, not clean code files. Each adapter needs:

1. **Code block extraction** — Parse markdown fenced blocks from streamed content
2. **Language detection** — Match code blocks to expected file types
3. **File path resolution** — For multi-file outputs, determine where each block goes
4. **Diff generation** — For SWE-bench, convert full files to patches against the base

This is the single biggest engineering challenge. Recommend building a shared `OutputParser` class:

```python
class OutputParser:
    """Extract structured code from API responses."""
    
    def extract_code_blocks(self, content: str) -> list[CodeBlock]
    def extract_patch(self, content: str, base_repo: Path) -> str  # unified diff
    def extract_files(self, content: str) -> dict[str, str]  # path → content
    def extract_function(self, content: str, language: str) -> str  # single function
```

---

## 5. Metrics We Report

For each benchmark, report all three modes side by side:

| Metric | Mode A (Direct) | Mode B (Standards) | Mode C (Pipeline) |
|--------|-----------------|--------------------|--------------------|
| Pass rate / Resolved rate | X% | Y% | Z% |
| Avg latency per problem | Xs | Ys | Zs |
| Avg token usage | X tok | Y tok | Z tok |
| Avg cost per problem | $X | $Y | $Z |
| Failure categories | ... | ... | ... |

**The key number:** Mode B improvement over Mode A = "Standards Lift"
**The other key number:** Mode C improvement over Mode A = "Pipeline Lift"

If Standards Lift is positive and consistent across benchmarks, that's the product thesis validated.

---

## 6. Revised Roadmap Integration

The existing roadmap is good but should be reordered based on market credibility:

| Priority | Phase | Benchmark | Effort | Rationale |
|----------|-------|-----------|--------|-----------|
| **P0** | 0 | Infrastructure (DONE) | — | Already complete |
| **P0** | 1 | HumanEval (DONE) | — | Already have results |
| **P1** | NEW | Aider Polyglot | `S` | Quick win, public leaderboard, multi-language |
| **P1** | 3 | SWE-bench Lite → Verified | `L` | The number everyone reports |
| **P2** | NEW | FeatureBench | `M` | Natural fit for our pipeline, huge differentiator if Mode C wins |
| **P2** | 7 | Custom Standards Quality | `L` | Our unique moat, no one else measures this |
| **P3** | NEW | AIMultiple-style full-stack | `L` | Real-world credibility, reproducible |
| **P3** | 2 | RepoBench | `M` | Cross-file understanding |
| **P4** | 4 | DevBench | `L` | Full SDLC — overlaps with FeatureBench |
| **P4** | 5 | LiveCodeBench | `M` | Continuous tracking |
| **P5** | 6 | Terminal-Bench | `M` | Deprioritize — not our core value |
| **P5** | 8 | Stretch (Pro, CI, Dashboard) | `XL` | After everything else |

---

## 7. What Success Looks Like

**Minimum viable benchmark story (MVP):**
- SWE-bench Verified score (comparable to published leaderboard)
- Aider Polyglot score (comparable to published leaderboard)
- Standards Lift quantified on both (Mode B vs Mode A)

**Full benchmark story:**
- All of the above, plus:
- FeatureBench score showing Pipeline Lift (Mode C >> Mode A)
- Custom Standards Quality scores proving the extraction works
- Cost-per-task comparison showing efficiency advantage

**The pitch:**
> "Standards Extractor scores X% on SWE-bench Verified — but more importantly, enabling spec-driven development through the pipeline adds Y percentage points over raw generation. On FeatureBench (multi-commit features), the improvement is Z points. No other tool measures or optimizes for this."

---

*Generated 2026-03-28. Based on thread research in #benchmarking.*
