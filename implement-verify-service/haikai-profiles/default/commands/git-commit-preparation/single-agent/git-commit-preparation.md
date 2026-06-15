# Haikai Skill: /git-commit-preparation

**Author:** Agent
**Date:** 2026-03-16
**Version:** 1.0

## 1. Description

This skill prepares a Git repository for a clean commit by detecting frameworks, ensuring proper `.gitignore` coverage, cleaning cached build artifacts, and scanning for leaked secrets. It is safe to run at any time — it never deletes files from disk and never modifies source code.

## 2. Usage

Run `/git-commit-preparation` from the Claude Code CLI, or invoke from the orchestrator. No arguments are required — the skill operates on the current working directory.

## 3. Phases

Execute the following five phases **in sequence**. Do not skip phases. Collect results from each phase for the final summary report.

---

### PHASE 1: Framework Detection

Scan the repository root for the following manifest files and report which frameworks/languages are present:

| Manifest File       | Framework / Language |
|---------------------|----------------------|
| `package.json`      | Node.js / JavaScript |
| `requirements.txt`  | Python               |
| `pyproject.toml`    | Python               |
| `setup.py`          | Python               |
| `Cargo.toml`        | Rust                 |
| `go.mod`            | Go                   |
| `pom.xml`           | Java (Maven)         |
| `build.gradle`      | Java (Gradle)        |
| `Gemfile`           | Ruby                 |

**Actions:**
1. Check for the existence of each file listed above in the repository root.
2. Build a list of detected frameworks (e.g., `["Node.js", "Python"]`).
3. Print a summary to the user:
   ```
   Detected frameworks: Node.js, Python
   ```
4. If no manifest files are found, print `No framework manifest files detected.` and continue — the remaining phases still apply.

---

### PHASE 2: Framework-Specific .gitignore

Based on the frameworks detected in Phase 1, append framework-specific ignore patterns to `.gitignore`.

**Rules:**
- All new patterns MUST be added under the marker line: `# --- Added by Haikai (framework-specific) ---`
- If that marker already exists in `.gitignore`, **skip this phase entirely** (idempotent).
- Never remove or modify existing patterns in `.gitignore`.
- If `.gitignore` does not exist, create it.

**Patterns to add per framework:**

**Node.js:**
```
.turbo/
.cache/
coverage/
.nyc_output/
.parcel-cache/
```

**Python:**
```
*.egg-info/
.pytest_cache/
.mypy_cache/
htmlcov/
.tox/
```

**Rust:**
```
target/debug/
target/release/
```

**Java (Maven or Gradle):**
```
*.class
*.jar
.gradle/
.mvn/wrapper/maven-wrapper.jar
```

**Go:**
No extra patterns needed.

**Ruby:**
```
.bundle/
tmp/
log/
```

**Actions:**
1. Read the current `.gitignore` (or treat as empty if it does not exist).
2. Check whether the marker `# --- Added by Haikai (framework-specific) ---` is already present. If yes, skip this phase.
3. Append a blank line, the marker line, and the framework-specific patterns.
4. Write the updated `.gitignore`.
5. Report what was added.

---

### PHASE 3: Artifact Cleanup

Scan the working tree for common build/test output directories that exist on disk but are not yet covered by `.gitignore`. Remove them from the Git index (cache) without deleting them from disk.

**Directories to check:**
```
coverage/
.nyc_output/
htmlcov/
.pytest_cache/
__pycache__/
.next/
dist/
build/
out/
target/
```

**Actions:**
1. For each directory in the list above, check whether it exists in the working tree.
2. If it exists AND is not already matched by a pattern in `.gitignore`:
   a. Append the directory to `.gitignore` (under a `# --- Added by Haikai (artifact cleanup) ---` marker, if not already present).
   b. Run `git rm -r --cached --ignore-unmatch <dir>` to unstage it from the index.
3. **NEVER** delete files from disk — only remove from the Git cache.
4. **NEVER** touch source code or user-authored files.
5. Report which directories were found and unstaged.

---

### PHASE 4: Secrets Scan (Report Only)

Search tracked files for patterns that indicate leaked secrets. **This phase is report-only — do NOT auto-fix, auto-ignore, or modify any files.**

**Patterns to search for in tracked files:**
- `sk-` (OpenAI API keys)
- `sk-ant-` (Anthropic API keys)
- `ghp_` (GitHub personal access tokens)
- `AKIA` (AWS access key IDs)
- `-----BEGIN.*PRIVATE KEY-----` (private key blocks)

**Additionally:**
- Search for `.env` files that are tracked by Git (but NOT `.env.example` or `.env.template`).
- For any tracked `.env` files found, scan for lines containing high-entropy values (long alphanumeric strings that look like keys or tokens).

**Actions:**
1. Use `git ls-files` to get the list of tracked files.
2. Search tracked files for each secret pattern. Use grep or equivalent.
3. For each match, record the file path and line number.
4. Output clear warnings to the user:
   ```
   WARNING: Potential secret found!
     File: src/config.py, Line 42
     Pattern matched: sk-
   ```
5. If no secrets are found, report: `No potential secrets detected in tracked files.`
6. **Do NOT auto-ignore or auto-fix** — this is informational only so the user can take action.

---

### PHASE 5: Summary Report

Produce a final summary of everything done in Phases 1–4.

**Actions:**
1. Check if there is a spec context available (i.e., a path like `haikai/specs/[this-spec]/`).
2. If a spec context exists:
   - Create the directory `haikai/specs/[this-spec]/implementation/` if it does not exist.
   - Write the summary report to `haikai/specs/[this-spec]/implementation/git-commit-preparation.md`.
3. If no spec context is available, output the summary to stdout only.

**Summary report format:**

```markdown
# Git Commit Preparation Report

**Date:** [current date]
**Repository:** [repo root path]

## Frameworks Detected
- [list of detected frameworks, or "None"]

## .gitignore Patterns Added
- [list of patterns added, or "None (marker already present)" / "None (no frameworks detected)"]

## Artifacts Unstaged
- [list of directories removed from index, or "None found"]

## Secrets Scan Results
- [list of warnings with file paths and line numbers, or "No potential secrets detected"]
```

---

## 4. Safety Guarantees

This skill adheres to the following safety rules at all times:

- **NEVER** deletes files from disk — only removes from Git cache via `git rm --cached`.
- **NEVER** modifies source code or user-authored files.
- **NEVER** auto-fixes secrets — only reports them.
- All `.gitignore` modifications are additive and idempotent.
- The skill is safe to run multiple times without side effects.
