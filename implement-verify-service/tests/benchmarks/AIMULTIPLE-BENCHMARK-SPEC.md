# AIMultiple Agent Benchmark — Detailed Integration Spec

## 1. What is the AIMultiple Benchmark?

AIMultiple runs the **most relevant independent benchmark** for coding agents and IDEs. It's the one Kiro is benchmarked on.

They test **10 real-world full-stack web development tasks** using a one-shot setup (no human intervention). Each task produces a working app that gets hit with **~60 automated smoke tests** (backend + frontend). Total: ~600 checks per agent across all 10 tasks, and 5,000+ total test executions including consistency runs.

### Who's been benchmarked

**IDE Agents (from their code editor benchmark):**

| Agent | Backend Score | Frontend Score | Combined Score |
|-------|-------------|---------------|----------------|
| Cursor (Opus 4.6) | Highest | Tied 1st (100%) | **0.751** (1st) |
| Kiro IDE | Strong | Tied 1st (100%) | **>0.69** (2nd) |
| Antigravity | Strong | Strong | **>0.69** (3rd) |
| Roo Code | Moderate | Moderate | Lower |
| Replit | Moderate | Lower | Lower |
| Windsurf | Last | Last | Last |

**CLI Agents (from their agentic CLI benchmark):**

| Agent | Backend | Frontend | Combined | Time | Tokens |
|-------|---------|----------|----------|------|--------|
| Codex CLI | 58.5% | 89.2% | **67.7%** | 426s | 258k |
| Junie | 54.3% | 85.0% | **63.5%** | 483s | 370k |
| Kiro CLI | — | — | **58.1%** | 168s | 46 credits |
| Claude Code | 38.6% | 95.0% | **55.5%** | 745s | 397k |
| Aider | — | — | **52.7%** | 257s | 126k |
| Gemini CLI | — | — | Lower | — | — |
| Cline | 26.7% | 33.3% | Lower | — | — |
| Goose | 3.1% | 10.0% | **5.2%** | 587s | 300k |

### Scoring formula
```
combined_score = 0.7 × backend_score + 0.3 × frontend_score
```

Backend is weighted 70% because it's where agents diverge most. Frontend scores are high across the board.

---

## 2. Exactly How It Works

### Task Format

Each task is a **markdown spec** (like `task-6-web.md`) that describes:
- What to build (natural language)
- Core requirements and business rules
- Data entities
- Technical constraints (FastAPI + SQLite, React/Vue/Svelte + Vite, JWT auth)
- Exact run commands (must work as-is)
- Acceptance criteria
- Seed data
- Expected deliverable structure

Example: Task 6 is a Helpdesk Ticket System with:
- Two user roles (customer, agent)
- Ticket CRUD with status workflow (open → in_progress → waiting_on_customer → resolved → reopened)
- JWT auth, data isolation (404 not 403), reply threads
- FastAPI backend, React/Vue/Svelte frontend

### Smoke Test Format

Each task has a **YAML smoke test file** (`task-6.yaml`) that defines HTTP test steps:

```yaml
steps:
  - name: Health check
    method: GET
    path: /health
    expect:
      status: "200"

  - name: Login agent
    method: POST
    path: /login
    body:
      email: "agent@example.com"
      password: "agent123"
    expect:
      status: "200"
    save:
      token_as: agent_token

  - name: Customer creates ticket
    method: POST
    path: /tickets
    auth: customer_token
    body:
      subject: "Smoke Test Issue"
      description: "Something is not working"
      priority: "high"
    expect:
      status: "200|201"
    save:
      json_as: created_ticket

  - name: Agent assigns ticket to self
    method: PUT
    path: /tickets/$created_ticket.id/assign
    auth: agent_token
    body:
      agent_id: "self"
    expect:
      status: "200"
```

Features of the test format:
- **Variable saving:** `save: token_as: agent_token` → subsequent steps use `auth: agent_token`
- **JSON path references:** `$created_ticket.id` resolves to a value from a saved response
- **Status matching:** `"200|201"` accepts either
- **JSON assertions:** `json_has: [subject, status, replies]` checks response structure
- **Auth injection:** `auth: agent_token` adds `Authorization: Bearer {token}` header

### Frontend Testing

Separate from the YAML backend tests, they run **Playwright** tests:
- Login form renders
- Login works (form submission)
- Post-login state persists (redirect, session)
- No console errors or crashes
- UI elements render correctly

### Execution Flow

```
1. Give agent the task spec (markdown)
2. Agent generates code (one-shot, no human)
3. Start backend: cd backend && pip install -r requirements.txt && uvicorn main:app --port 8000
4. Start frontend: cd frontend && npm install && npm run dev
5. Wait for both to be ready
6. Run backend smoke tests (YAML → HTTP requests → check responses)
7. Run frontend tests (Playwright → browser automation → check UI)
8. Score: 0.7 × backend_pass_rate + 0.3 × frontend_pass_rate
```

---

## 3. How We Adapt This for Standards Extractor

### The Key Insight

This benchmark is **exactly what our orchestration pipeline is designed for.** The task spec is basically a product requirement → the pipeline does: shape-spec → write-spec → create-tasks → implement-tasks.

This is where Mode C should shine.

### Architecture

```
┌───────────────────────────────────────────┐
│  Task Specs (10 tasks)                     │
│  task-1-web.md ... task-10-web.md          │
│  + YAML smoke tests per task               │
└──────────────┬────────────────────────────┘
               │
               ▼
┌───────────────────────────────────────────┐
│  AIMultipleBenchmark                       │
│  (extends BaseBenchmark)                   │
│                                            │
│  load_dataset():                           │
│    Read 10 task markdown specs             │
│    Read 10 YAML smoke test files           │
│                                            │
│  adapt_problem(task):                      │
│    Task markdown → API prompt              │
│    (minimal adaptation needed —             │
│     the spec IS the prompt)                │
│                                            │
│  evaluate(generated, task):                │
│    1. Extract project files from response  │
│    2. Write to temp directory              │
│    3. Start backend (uvicorn)              │
│    4. Start frontend (npm run dev)         │
│    5. Run YAML smoke test runner           │
│    6. Run Playwright frontend tests        │
│    7. Score and return                     │
└──────────────┬────────────────────────────┘
               │
       ┌───────┼───────┐
       ▼       ▼       ▼
    Mode A   Mode B   Mode C
   (direct) (w/std)  (pipeline)
```

### Mode A: Direct Generation
```
Task spec markdown
  → POST /shape-spec/stream
  → "Build this helpdesk system: {task_spec}"
  → Extract code files from response
  → Deploy & test
```

### Mode B: Standards-Enhanced
```
Task spec markdown
  → Extract standards from a FastAPI reference project first
  → Inject: "Follow these standards: {standards}"
  → POST /shape-spec/stream with enriched prompt
  → Extract code files
  → Deploy & test
```

### Mode C: Full Pipeline ⭐ (THE MAIN EVENT)
```
Task spec markdown
  → POST /shape-spec/stream (creates spec session)
  → POST /orchestrations:
      → write-spec (formalizes requirements)
      → create-tasks (breaks into implementation tasks)
      → implement-tasks (generates all code)
  → Extract generated project files
  → Deploy & test
```

---

## 4. What We Need to Build

### 4.1 Task Specs (10 tasks)

AIMultiple published **Task 6** publicly. The other 9 are not public. We have two options:

**Option A: Recreate equivalent tasks** — Design 10 full-stack web dev tasks at similar complexity. This is what we should do. Benefits:
- We control the specs and can tune difficulty
- We can share them publicly
- We can compare results against AIMultiple's published numbers for calibration (Task 6)

**Option B: Use only Task 6** — Start with the published task, validate our approach, then expand.

**Recommended: Option B first, then Option A.**

Here are 10 tasks we should build (Task 6 already exists):

| # | Task | Key Challenges |
|---|------|----------------|
| 1 | **Todo App with Auth** | Basic CRUD, JWT, user isolation. Warmup. |
| 2 | **Blog Platform** | Markdown rendering, comments, pagination, search |
| 3 | **E-commerce Cart** | Products, cart state, checkout flow, inventory |
| 4 | **Chat Application** | WebSocket/polling, message history, typing indicators |
| 5 | **Project Management Board** | Kanban drag-and-drop, task assignment, status workflow |
| 6 | **Helpdesk Ticket System** | ← AIMultiple's published task (existing) |
| 7 | **Expense Tracker** | Receipt upload, categories, monthly reports, charts |
| 8 | **Quiz/Survey Builder** | Dynamic form generation, response collection, analytics |
| 9 | **Booking/Scheduling System** | Calendar view, time slots, conflict detection |
| 10 | **Multi-tenant Dashboard** | Org-level isolation, role hierarchy, data visualization |

### 4.2 Smoke Test Runner

We need a YAML-driven HTTP test runner. The format is defined by AIMultiple's `task-6.yaml`.

```python
class SmokeTestRunner:
    """Execute YAML-defined smoke tests against a running backend."""

    def __init__(self, base_url: str = "http://localhost:8000"):
        self.base_url = base_url
        self.variables: dict[str, Any] = {}  # saved tokens, responses

    def run(self, yaml_path: str) -> SmokeTestResult:
        steps = yaml.safe_load(open(yaml_path))["steps"]
        results = []

        for step in steps:
            result = self._execute_step(step)
            results.append(result)

            # Save variables if step defines save
            if step.get("save") and result.passed:
                self._save_variables(step["save"], result.response)

        return SmokeTestResult(
            total=len(results),
            passed=sum(1 for r in results if r.passed),
            failed=sum(1 for r in results if not r.passed),
            details=results,
        )

    def _execute_step(self, step: dict) -> StepResult:
        method = step["method"]
        path = self._resolve_variables(step["path"])
        headers = {}
        
        # Auth injection
        if "auth" in step:
            token = self.variables.get(step["auth"], "")
            headers["Authorization"] = f"Bearer {token}"

        # Body with variable resolution
        body = None
        if "body" in step:
            body = self._resolve_body(step["body"])

        # Execute
        response = httpx.request(method, f"{self.base_url}{path}",
                                 json=body, headers=headers, timeout=10)

        # Check expectations
        passed = self._check_expect(step.get("expect", {}), response)
        return StepResult(name=step["name"], passed=passed, ...)

    def _resolve_variables(self, text: str) -> str:
        """Replace $variable.path references with saved values."""
        for match in re.finditer(r'\$(\w+)\.(\w+)', text):
            var_name, field = match.groups()
            if var_name in self.variables:
                value = self.variables[var_name]
                if isinstance(value, dict):
                    value = value.get(field, "")
                text = text.replace(match.group(), str(value))
        return text
```

### 4.3 Frontend Test Runner

Playwright-based UI validation:

```python
class FrontendTestRunner:
    """Run Playwright tests against the frontend."""

    async def run(self, frontend_url: str = "http://localhost:5173") -> FrontendResult:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page()

            results = []

            # Test 1: Page loads without crash
            results.append(await self._test_page_loads(page, frontend_url))

            # Test 2: Login form renders
            results.append(await self._test_login_form_renders(page))

            # Test 3: Login works
            results.append(await self._test_login_works(page))

            # Test 4: Post-login state
            results.append(await self._test_post_login(page))

            # Test 5: No console errors
            results.append(await self._test_no_console_errors(page))

            await browser.close()

        return FrontendResult(
            total=len(results),
            passed=sum(1 for r in results if r.passed),
            details=results,
        )
```

### 4.4 Deployment Harness

The critical bridge: take generated files → start the app → make it testable.

```python
class AppDeployer:
    """Deploy a generated full-stack app for testing."""

    def __init__(self, project_dir: Path):
        self.project_dir = project_dir
        self.backend_process = None
        self.frontend_process = None

    async def start(self) -> DeployResult:
        # 1. Install backend deps
        subprocess.run(
            ["pip", "install", "-r", "requirements.txt"],
            cwd=self.project_dir / "backend",
            timeout=120,
        )

        # 2. Start backend
        self.backend_process = subprocess.Popen(
            ["uvicorn", "main:app", "--port", "8000"],
            cwd=self.project_dir / "backend",
        )

        # 3. Install frontend deps
        subprocess.run(
            ["npm", "install"],
            cwd=self.project_dir / "frontend",
            timeout=120,
        )

        # 4. Start frontend
        self.frontend_process = subprocess.Popen(
            ["npm", "run", "dev"],
            cwd=self.project_dir / "frontend",
        )

        # 5. Wait for both to be ready
        await self._wait_for_backend("http://localhost:8000/health")
        await self._wait_for_frontend("http://localhost:5173")

        return DeployResult(backend_ready=True, frontend_ready=True)

    async def stop(self):
        if self.backend_process:
            self.backend_process.terminate()
        if self.frontend_process:
            self.frontend_process.terminate()
```

### 4.5 Multi-File Code Extraction

This is the hardest part. Our API returns conversational text. We need to extract a full project structure from it.

```python
class ProjectExtractor:
    """Extract a multi-file project from an LLM response."""

    def extract(self, response: str) -> dict[str, str]:
        """
        Returns dict of {filepath: content}.
        e.g. {"backend/main.py": "from fastapi...", "frontend/src/App.jsx": "..."}
        """
        files = {}

        # Strategy 1: Look for file markers like "```python\n# backend/main.py"
        # or "File: backend/main.py" or "### backend/main.py"
        pattern = r'(?:#{1,4}\s*|File:\s*|`)?([a-zA-Z0-9_/.-]+\.[a-z]+)`?\s*\n```\w*\n(.*?)```'
        for match in re.finditer(pattern, response, re.DOTALL):
            filepath, content = match.groups()
            files[filepath.strip()] = content

        # Strategy 2: Look for explicit file creation instructions
        # "Create backend/main.py with the following content:"
        pattern2 = r'(?:Create|Write|Save)\s+`?([a-zA-Z0-9_/.-]+\.[a-z]+)`?.*?:\s*\n```\w*\n(.*?)```'
        for match in re.finditer(pattern2, response, re.DOTALL):
            filepath, content = match.groups()
            if filepath not in files:
                files[filepath.strip()] = content

        # Strategy 3: Infer from code content if no explicit paths
        if not files:
            files = self._infer_from_code_blocks(response)

        return files

    def write_project(self, files: dict[str, str], output_dir: Path):
        """Write extracted files to disk."""
        for filepath, content in files.items():
            full_path = output_dir / filepath
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_text(content)
```

---

## 5. The Three Modes — What We Expect

### Mode A: Direct (baseline)
- Send task spec through `/shape-spec/stream`
- Expect: moderate backend score, good frontend score
- This is comparable to what Claude Code scored (55.5% combined)

### Mode B: Standards-Enhanced (our value-add)
- First: extract standards from a reference FastAPI + React project
- Then: inject those standards into the prompt
- Expect: higher backend score due to better REST contract compliance
  - The #1 failure mode in AIMultiple's benchmark is **endpoint contract mismatch** (PUT vs PATCH, missing dedicated endpoints)
  - Standards that specify "use PUT for /tickets/{id}/assign" should directly fix this

### Mode C: Full Pipeline (our big bet)
- Task spec → shape-spec → write-spec → create-tasks → implement-tasks
- Expect: highest scores because:
  - write-spec formalizes ambiguous requirements
  - create-tasks breaks down the work systematically
  - implement-tasks generates code per-task with verification
- This mirrors how Kiro works (spec-driven, structural) and Kiro scores 2nd

### What makes this benchmark perfect for us

From AIMultiple's analysis of Kiro:
> _"Kiro optimizes for structural coherence... It prefers a clean system over a minimal diff... It behaves like a specification-driven engineer who prefers correctness by reconstruction."_

That's exactly what our pipeline does. Standards Extractor IS a specification-driven engineering tool. If we can't beat raw Claude Code on this benchmark with Mode C, something is wrong.

---

## 6. Implementation Steps

| Step | Task | Effort | Deliverable |
|------|------|--------|-------------|
| 1 | **Start with Task 6** — clone the public example, validate we understand the format | `XS` | Working copy of task-6-web.md + task-6.yaml |
| 2 | **Build SmokeTestRunner** — YAML-driven HTTP test executor with variable resolution | `S` | `benchmarks/aimultiple/smoke_runner.py` |
| 3 | **Build FrontendTestRunner** — Playwright-based UI checks | `S` | `benchmarks/aimultiple/frontend_runner.py` |
| 4 | **Build AppDeployer** — start backend + frontend, wait for ready | `S` | `benchmarks/aimultiple/deployer.py` |
| 5 | **Build ProjectExtractor** — multi-file code extraction from API responses | `M` | `benchmarks/aimultiple/extractor.py` |
| 6 | **Build AIMultipleBenchmark adapter** — integrate with our BaseBenchmark | `S` | `benchmarks/aimultiple/benchmark.py` |
| 7 | **Run Task 6: Mode A** — direct generation, deploy, test, score | `S` | First results |
| 8 | **Run Task 6: Mode B** — with FastAPI+React standards | `S` | Standards lift data |
| 9 | **Run Task 6: Mode C** — full pipeline | `S` | Pipeline lift data |
| 10 | **Analyze Task 6 results** — compare to AIMultiple's published agent scores | `XS` | Learnings doc |
| 11 | **Design remaining 9 tasks** — write task specs + YAML smoke tests | `L` | 9 task markdown files + 9 YAML files |
| 12 | **Run full 10-task suite** — all modes, all models | `L` | Complete benchmark results |
| 13 | **Write learnings + comparison doc** | `S` | Marketing-ready comparison |
| **Total** | | **~3-4 weeks** | |

### Suggested start: Steps 1-7 (2 weeks)
Get Task 6 working end-to-end through all 3 modes. This alone gives us a direct comparison to every agent AIMultiple tested.

---

## 7. Docker Environment

```dockerfile
# benchmarks/docker/aimultiple/Dockerfile
FROM python:3.11-slim

# Backend deps
RUN pip install fastapi uvicorn sqlalchemy httpx pyyaml

# Frontend deps (Node.js + npm)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs chromium

# Playwright for frontend testing
RUN pip install playwright && playwright install chromium

WORKDIR /benchmark
```

---

## 8. Metrics

### Per-task metrics (matching AIMultiple)

| Metric | Description |
|--------|-------------|
| Backend pass rate | % of YAML smoke test steps that pass |
| Frontend pass rate | % of Playwright UI checks that pass |
| Combined score | 0.7 × backend + 0.3 × frontend |
| Execution time | Total wall-clock time from prompt to scored |
| Token usage | Input + output tokens consumed |

### Cross-mode comparison (our unique data)

| Metric | Mode A | Mode B | Mode C |
|--------|--------|--------|--------|
| Combined score | X% | Y% | Z% |
| Backend score | | | |
| Frontend score | | | |
| Execution time | | | |
| Token cost | | | |
| **Standards Lift** | — | Y-X | — |
| **Pipeline Lift** | — | — | Z-X |

### Comparison table (the money slide)

| Agent | Combined Score | Source |
|-------|---------------|--------|
| Cursor (Opus 4.6) | 0.751 | AIMultiple |
| Kiro IDE | >0.69 | AIMultiple |
| Codex CLI | 67.7% | AIMultiple |
| Junie CLI | 63.5% | AIMultiple |
| **Standards Extractor (Mode C)** | **?%** | **Us** |
| Kiro CLI | 58.1% | AIMultiple |
| Claude Code | 55.5% | AIMultiple |
| **Standards Extractor (Mode A)** | **?%** | **Us** |
| Aider | 52.7% | AIMultiple |

---

## 9. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Multi-file extraction fails** — API response doesn't cleanly separate files | Deployment fails, score = 0 | Build robust ProjectExtractor with multiple strategies. For Mode C, the orchestration pipeline should produce cleaner file separation than Mode A. |
| **Backend won't start** — missing deps, import errors, port conflicts | Score = 0 for that task | Add retry logic: try `pip install` with different requirement sets. Catch common errors (missing `__init__.py`, wrong module paths). |
| **Endpoint contract mismatch** — the #1 failure mode across all agents | Low backend score | Mode B should directly address this by injecting REST API standards. Mode C's write-spec step should formalize endpoints before implementation. |
| **Frontend doesn't connect to backend** — CORS, wrong port, wrong API URL | Frontend score = 0 | Add CORS middleware injection if missing. Check for common config issues. |
| **Only 1 public task** — AIMultiple published only Task 6 | Limited comparison data | Design our own 9 tasks at similar complexity. Calibrate against Task 6 results. |
| **Cost blowup for Mode C** — full pipeline per task is expensive | Budget | Mode C on 10 tasks is ~10 orchestration runs. Budget ~$50-100 per full run. Start with Task 6 only. |

---

## 10. Why This Benchmark Matters Most

1. **Kiro is on it.** If Ozzie wants to compete on benchmarks, this is the one where Kiro has published results.

2. **It tests what our pipeline does.** Full-stack app generation from a spec is literally our use case. SWE-bench tests bug fixing. Aider Polyglot tests function completion. This benchmark tests "build the whole thing from a description."

3. **The failure modes are addressable.** The #1 failure across all agents is REST endpoint contract compliance. Our standards injection (Mode B) and spec formalization (Mode C) should directly improve this.

4. **The scoring is automated and reproducible.** YAML smoke tests + Playwright = anyone can verify. No human judgment required.

5. **The comparison is direct.** We can put our score in the same table as Cursor, Kiro, Claude Code, Codex, and Aider.

---

*Spec version: 1.0 · 2026-03-28 · For review*
