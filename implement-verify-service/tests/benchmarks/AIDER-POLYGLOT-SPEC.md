# Aider Polyglot Benchmark — Detailed Integration Spec

## 1. What is the Aider Polyglot Benchmark?

The Aider Polyglot benchmark tests an LLM's ability to solve **225 of the hardest Exercism coding problems** across 6 programming languages. It was created by Aider (Dec 2024) to replace their saturated Python-only benchmark.

### How the problems were selected
- Started with **697 total Exercism problems** across C++, Go, Java, JavaScript, Python, Rust
- 7 top coding models each attempted all 697
- Problems were kept only if **3 or fewer** of those 7 models solved them
- Result: 225 hard problems that differentiate frontier models

### Problem distribution by language

| Language | Problems |
|----------|----------|
| C++ | 26 |
| Go | 39 |
| Java | 47 |
| JavaScript | 49 |
| Python | 34 |
| Rust | 30 |
| **Total** | **225** |

### Current leaderboard (top 10, from aider.chat)

| Model | Score | Cost |
|-------|-------|------|
| GPT-5 (high) | 88.0% | $29.08 |
| GPT-5 (medium) | 86.7% | $17.69 |
| o3-pro (high) | 84.9% | $146.32 |
| Gemini 2.5 Pro (32k think) | 83.1% | $49.88 |
| GPT-5 (low) | 81.3% | $10.37 |
| o3 (high) | 81.3% | $21.23 |
| Grok 4 (high) | 79.6% | $59.62 |
| Gemini 2.5 Pro (default think) | 79.1% | $45.60 |
| o3 (high) + gpt-4.1 (architect) | 78.2% | $17.55 |
| o3 | 76.9% | $13.75 |

Notable for our models:
- Claude Opus 4 (32k thinking): **72.0%** / $65.75
- Claude Sonnet 4 (32k thinking): **61.3%** / $26.58
- Claude 3.7 Sonnet (no thinking): **60.4%** / $17.72
- gpt-4.1: **52.4%** / $9.86
- gpt-4.1-mini: **32.4%** / $1.99

---

## 2. Exactly How It Works — The Mechanics

### Source repos
- **Problem data:** `https://github.com/Aider-AI/polyglot-benchmark` (225 problems)
- **Benchmark harness:** `https://github.com/Aider-AI/aider/tree/main/benchmark`

### What's in each problem directory

Each problem lives in a directory like:
```
polyglot-benchmark/exercises/{language}/{problem-name}/
```

The contents vary by language but follow this pattern:

**Python example** (`exercises/python/satellite/`):
```
satellite.py              ← Starter file (empty function/class stubs)
satellite_test.py         ← Test file (unittest/pytest)
.meta/config.json         ← Exercism metadata
.docs/instructions.md     ← Problem description (natural language)
```

**JavaScript example** (`exercises/javascript/satellite/`):
```
satellite.js              ← Starter file (exported function stubs)
satellite.spec.js         ← Test file (Jest)
package.json              ← Dependencies
.meta/config.json
.docs/instructions.md
```

**Rust example** (`exercises/rust/satellite/`):
```
src/lib.rs                ← Starter file
tests/satellite.rs        ← Test file
Cargo.toml
.meta/config.json
.docs/instructions.md
```

**Go, Java, C++** follow similar patterns with their respective test frameworks.

### How Aider runs it

1. For each problem:
   - Create a fresh git repo with the starter files
   - Run `aider` with the model being tested
   - Aider's prompt: the `.docs/instructions.md` content + the starter file
   - Aider generates code edits to the starter file
   - Run the test suite for that language
   - Record pass/fail

2. Each problem gets **2 attempts**:
   - First attempt: run aider → run tests
   - If tests fail: run aider again with the test output as feedback → run tests again
   - `pass_rate_1` = passed on first attempt
   - `pass_rate_2` = passed by second attempt (the headline number)

3. Test execution per language:
   - **Python:** `python -m pytest {test_file}`
   - **JavaScript:** `npx jest {test_file}`
   - **Java:** `gradle test` or `mvn test`
   - **Go:** `go test`
   - **Rust:** `cargo test`
   - **C++:** `cmake && make && ctest`

4. All runs happen **inside Docker** (LLM-generated code could be dangerous)

### Key metrics reported
```yaml
test_cases: 225
pass_rate_1: 57.1        # % passed on first attempt
pass_rate_2: 77.4        # % passed by second attempt (headline number)
percent_cases_well_formed: 99.2  # % where the edit format was correct
total_cost: $3.63        # total API cost for entire run
seconds_per_case: 17.6   # avg time per problem
```

---

## 3. How We Adapt This for Standards Extractor

### The core difference

Aider sends problems directly to the model using its own prompt format and edit protocols (`diff`, `whole`, `architect`). We send problems through the **Standards Extractor API**, which adds our shape-spec layer, standards context, and optionally the full orchestration pipeline.

### Architecture

```
┌─────────────────────────────────────────┐
│  polyglot-benchmark/exercises/{lang}/    │
│  225 Exercism problems                   │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  AiderPolyglotBenchmark                  │  ← NEW adapter class
│  (extends BaseBenchmark)                 │
│                                          │
│  load_dataset():                         │
│    Walk exercises/ dirs                  │
│    For each: read instructions.md,       │
│    starter file, test file               │
│    Return list of problem dicts          │
│                                          │
│  adapt_problem(problem):                 │
│    Build prompt from instructions +      │
│    starter code + language context       │
│                                          │
│  evaluate(generated, problem):           │
│    Write generated code to temp dir      │
│    Run language-specific test command    │
│    Return pass/fail + score              │
└──────────────┬──────────────────────────┘
               │
       ┌───────┼───────┐
       ▼       ▼       ▼
    Mode A   Mode B   Mode C
   (direct) (w/std)  (pipeline)
       │       │       │
       ▼       ▼       ▼
┌─────────────────────────────────────────┐
│  Standards Extractor API                 │
│  /shape-spec/stream                      │
│  /standards/generate                     │
│  /orchestrations                         │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Code Extraction (OutputParser)          │
│  Extract code from SSE response          │
│  Write to {language} source file         │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Test Execution (Docker sandbox)         │
│  Run language-specific test command      │
│  pytest / jest / go test / cargo test    │
│  Return exit code + output               │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Results Pipeline (existing)             │
│  JSON scores + markdown report           │
│  benchmarks/results/polyglot/{model}/    │
└─────────────────────────────────────────┘
```

---

## 4. Detailed Implementation Plan

### 4.1 Dataset Loader

```python
class AiderPolyglotBenchmark(BaseBenchmark):
    name = "polyglot"

    # Language → test runner config
    LANG_CONFIG = {
        "python": {
            "starter_pattern": "*.py",          # excluding *_test.py
            "test_pattern": "*_test.py",
            "test_cmd": ["python", "-m", "pytest", "{test_file}", "-x"],
            "code_fence": "python",
        },
        "javascript": {
            "starter_pattern": "*.js",          # excluding *.spec.js
            "test_pattern": "*.spec.js",
            "test_cmd": ["npx", "jest", "{test_file}", "--no-coverage"],
            "code_fence": "javascript",
        },
        "go": {
            "starter_pattern": "*.go",          # excluding *_test.go
            "test_pattern": "*_test.go",
            "test_cmd": ["go", "test", "-v", "./..."],
            "code_fence": "go",
        },
        "rust": {
            "starter_pattern": "src/lib.rs",
            "test_pattern": "tests/*.rs",
            "test_cmd": ["cargo", "test"],
            "code_fence": "rust",
        },
        "java": {
            "starter_pattern": "src/main/java/**/*.java",
            "test_pattern": "src/test/java/**/*.java",
            "test_cmd": ["gradle", "test"],
            "code_fence": "java",
        },
        "cpp": {
            "starter_pattern": "*.cpp",         # or *.h
            "test_pattern": "*_test.cpp",
            "test_cmd": ["cmake", ".", "&&", "make", "&&", "ctest"],
            "code_fence": "cpp",
        },
    }
```

Each problem dict produced by `load_dataset()`:

```python
{
    "id": "python/satellite",           # language/problem-name
    "language": "python",
    "problem_name": "satellite",
    "instructions": "...",               # from .docs/instructions.md
    "starter_code": "...",               # from satellite.py
    "starter_file": "satellite.py",      # filename to write back
    "test_code": "...",                  # from satellite_test.py
    "test_file": "satellite_test.py",
    "test_cmd": ["python", "-m", "pytest", "satellite_test.py", "-x"],
    "exercise_dir": "/path/to/exercises/python/satellite/",
}
```

### 4.2 Prompt Adaptation

```python
def adapt_problem(self, problem: dict) -> str:
    lang = problem["language"]
    instructions = problem["instructions"]
    starter = problem["starter_code"]
    fence = self.LANG_CONFIG[lang]["code_fence"]

    return (
        f"Solve the following {lang} coding exercise.\n\n"
        f"## Instructions\n\n{instructions}\n\n"
        f"## Starter Code\n\n```{fence}\n{starter}\n```\n\n"
        f"Complete the implementation. Return ONLY the complete source file "
        f"contents in a single ```{fence}``` code block. "
        f"Do not include test code. Do not explain."
    )
```

### 4.3 Code Extraction from API Response

The API returns SSE streams with mixed text and code. We need to extract the right code block:

```python
def extract_code(self, response: str, problem: dict) -> str:
    lang = problem["language"]
    fence = self.LANG_CONFIG[lang]["code_fence"]

    # Strategy 1: Find fenced code blocks for the target language
    pattern = rf"```(?:{fence}|{lang})?\s*\n(.*?)```"
    blocks = re.findall(pattern, response, re.DOTALL)
    if blocks:
        # Return the longest block (most likely the full solution)
        return max(blocks, key=len)

    # Strategy 2: Find ANY fenced code block
    generic_pattern = r"```\w*\s*\n(.*?)```"
    blocks = re.findall(generic_pattern, response, re.DOTALL)
    if blocks:
        return max(blocks, key=len)

    # Strategy 3: Take everything that looks like code
    # (lines with indentation or language-specific patterns)
    return self._extract_code_heuristic(response, lang)
```

### 4.4 Test Execution

Each problem runs in an isolated temp directory with the original exercise files + our generated code replacing the starter file:

```python
def evaluate(self, generated: str, problem: dict) -> tuple[bool, float]:
    code = self.extract_code(generated, problem)

    with tempfile.TemporaryDirectory() as tmpdir:
        # Copy exercise dir to temp
        shutil.copytree(problem["exercise_dir"], tmpdir, dirs_exist_ok=True)

        # Overwrite starter file with generated code
        starter_path = Path(tmpdir) / problem["starter_file"]
        starter_path.write_text(code)

        # Run test command
        try:
            result = subprocess.run(
                problem["test_cmd"],
                cwd=tmpdir,
                capture_output=True,
                text=True,
                timeout=30,
            )
            passed = result.returncode == 0
        except subprocess.TimeoutExpired:
            passed = False

    return passed, 1.0 if passed else 0.0
```

### 4.5 Standards Context (Mode B)

Per-language standards, designed to address common failure patterns:

```python
def get_standards_context(self, problems: list[dict]) -> str:
    # Aggregate: detect which languages are in the problem set
    languages = set(p["language"] for p in problems)
    standards = []

    for lang in sorted(languages):
        standards.append(self.LANGUAGE_STANDARDS[lang])

    return "\n\n---\n\n".join(standards)

LANGUAGE_STANDARDS = {
    "python": """# Python Standards
- Handle edge cases: empty inputs, None, zero, negative numbers
- Use type hints matching signatures
- Prefer list comprehensions for simple transforms
- Use collections.Counter, itertools when appropriate
- Remember: range(n) is 0 to n-1, string slicing s[i:j] excludes j
- Don't modify lists while iterating; iterate over a copy""",

    "javascript": """# JavaScript Standards
- Use strict equality (===) not loose (==)
- Handle undefined and null explicitly
- Use Array methods: map, filter, reduce, find
- Use const by default, let only when reassignment needed
- Template literals for string interpolation
- Arrow functions for short callbacks""",

    "go": """# Go Standards
- Always handle errors (don't use _ for error return)
- Use slices not arrays for dynamic collections
- Prefer switch over if-else chains
- Use goroutines/channels only when concurrent behavior is needed
- strings.Builder for efficient string concatenation
- Use rune for Unicode character operations""",

    "rust": """# Rust Standards
- Use pattern matching (match) for enums and Option/Result
- Prefer iter() + combinators over manual loops
- Handle all Result/Option values (no unwrap in production)
- Use &str for function params, String for owned data
- Implement Display trait for custom string formatting
- Use Vec::with_capacity when size is known""",

    "java": """# Java Standards
- Use Optional<T> instead of returning null
- Prefer enhanced for-loop or streams over index-based iteration
- Use StringBuilder for string concatenation in loops
- Implement equals/hashCode together
- Use List.of(), Map.of() for immutable collections
- Handle checked exceptions properly""",

    "cpp": """# C++ Standards
- Use smart pointers (unique_ptr, shared_ptr) not raw pointers
- Use const references for read-only params: const T&
- Prefer STL algorithms (std::sort, std::find, std::transform)
- Use range-based for loops
- Initialize variables at declaration
- Use std::string not C-style strings""",
}
```

### 4.6 Mode C (Full Pipeline) — Why We Probably Skip It

For function-level coding exercises, the full orchestration pipeline (shape-spec → write-spec → create-tasks → implement-tasks) is **massive overkill**. It's designed for multi-file, multi-step projects.

Running 225 single-function problems through a 4-stage pipeline would:
- Take ~100x longer per problem
- Cost ~50x more in tokens
- Add complexity without adding value

**Recommendation:** Run Mode A and Mode B only. Mode C is for SWE-bench and FeatureBench.

---

## 5. Docker Environment

Aider runs everything in Docker for safety. We should too, since we're executing LLM-generated code.

```dockerfile
# benchmarks/docker/polyglot/Dockerfile
FROM ubuntu:22.04

# Install all 6 language runtimes
RUN apt-get update && apt-get install -y \
    python3.11 python3-pip \
    nodejs npm \
    golang-go \
    default-jdk gradle \
    g++ cmake \
    rustc cargo \
    git curl

# Install test frameworks
RUN pip3 install pytest
RUN npm install -g jest

WORKDIR /benchmark
COPY . /benchmark/

ENTRYPOINT ["python3", "-m", "benchmarks.runner"]
```

---

## 6. Config Addition

Add to `benchmarks/config.yaml`:

```yaml
benchmarks:
  # ... existing ...
  polyglot:
    dataset: "Aider-AI/polyglot-benchmark"
    total_problems: 225
    batch_size: 5             # Lower than HumanEval — tests take longer (multi-lang)
    timeout_per_problem: 60   # Per-problem timeout including test execution
    languages:
      - python
      - javascript
      - go
      - rust
      - java
      - cpp
    attempts: 2               # Match Aider's 2-attempt methodology
```

---

## 7. What We're Measuring

### Primary metrics (comparable to Aider leaderboard)

| Metric | Description |
|--------|-------------|
| `pass_rate_1` | % passed on first attempt |
| `pass_rate_2` | % passed by second attempt (headline number) |
| `total_cost` | Total API cost for entire run |
| `seconds_per_case` | Average wall-clock time per problem |

### Our unique metrics (Mode A vs Mode B)

| Metric | Description |
|--------|-------------|
| `standards_lift` | `pass_rate_B - pass_rate_A` (does standards injection help?) |
| `per_language_lift` | Standards lift broken down by language |
| `cost_delta` | Extra cost of Mode B over Mode A |
| `lift_per_dollar` | Standards lift normalized by cost increase |

### Per-language breakdown

| Language | Mode A pass_rate | Mode B pass_rate | Lift |
|----------|-----------------|-----------------|------|
| Python | ? | ? | ? |
| JavaScript | ? | ? | ? |
| Go | ? | ? | ? |
| Rust | ? | ? | ? |
| Java | ? | ? | ? |
| C++ | ? | ? | ? |

---

## 8. Apples-to-Apples Comparison

### What's comparable
- Same 225 problems
- Same test suites
- Same pass/fail criteria (test exit code)
- Same 2-attempt methodology
- Same languages

### What's different (important caveats)
- **Prompt format:** Aider uses its own `diff`/`whole`/`architect` edit format protocols optimized for code editing. We use free-form natural language through shape-spec. This is a **disadvantage** for us — Aider's format is specifically tuned for code output.
- **Scaffolding:** Aider has file management, git integration, error retry loops built in. Our API is a conversational interface. This is another disadvantage.
- **Standards injection (Mode B):** This is our unique value-add. No one else tests this.

### How to frame the results

We should NOT position this as "we beat Aider." Instead:

> "Using model X through the Standards Extractor API, we achieve Y% on the Aider Polyglot benchmark (comparable to Aider's Z% with the same model). Injecting extracted coding standards improves this by W percentage points."

The story is about **standards lift**, not absolute score.

---

## 9. Implementation Steps

| Step | Task | Effort | Deliverable |
|------|------|--------|-------------|
| 1 | Clone `polyglot-benchmark` repo into benchmarks/ | `XS` | `benchmarks/datasets/polyglot-benchmark/` |
| 2 | Build Docker image with all 6 language runtimes | `S` | `benchmarks/docker/polyglot/Dockerfile` |
| 3 | Write `AiderPolyglotBenchmark` class | `S` | `benchmarks/polyglot/benchmark.py` |
| 4 | Write code extraction logic (multi-language) | `S` | Part of benchmark.py |
| 5 | Write per-language test runners | `S` | Part of benchmark.py |
| 6 | Write per-language standards contexts | `XS` | Part of benchmark.py |
| 7 | Add polyglot to config.yaml | `XS` | Config update |
| 8 | Run Mode A: all 225 problems, 2 models | `S` | Results in benchmarks/results/polyglot/ |
| 9 | Run Mode B: all 225 problems, 2 models | `S` | Results with standards lift data |
| 10 | Write learnings doc | `XS` | Learnings markdown |
| **Total** | | **~1 week** | |

**Effort scale:** `XS` 1 day · `S` 2-3 days · `M` 1 week

---

## 10. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Code extraction fails (LLM returns explanation instead of code) | Pass rate drops artificially | Multi-strategy extraction (fenced blocks → raw code → heuristic). Log extraction failures separately from genuine coding failures. |
| Language runtime issues in Docker (version mismatches) | Tests fail for wrong reasons | Pin exact runtime versions matching Exercism's requirements. Test Docker image on a few problems per language before full run. |
| Shape-spec API adds conversational overhead that hurts code quality | Lower scores than raw model | Expected. The story is standards lift (Mode B - Mode A), not absolute score. |
| Mode B standards are too generic to help | No measurable lift | Iterate on standards content. Try extracting standards FROM the Exercism repos themselves. |
| Cost blowup (225 × 2 attempts × 2 modes × 2 models = 1800 API calls) | Budget | Start with Python-only (34 problems) as a dry run. Estimate cost from that before full run. |

---

*Spec version: 1.0 · 2026-03-28 · For review*
