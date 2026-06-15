Now that we've implemented all tasks in tasks.md, we must run final verifications and produce a verification report using the following MULTI-PHASE workflow.

**MANDATORY:** This phase always runs after Phase 2 completes, even when all tests passed on the first try and even when no further implementation work is needed. Step 4 (the verification report at `haikai/specs/[this-spec]/verification/final-verification.md`) is a required deliverable — orchestration validates its existence. Skipping Steps 3 or 4 produces a false-positive "silent failure" verdict downstream.

## Workflow

### Step 1: Ensure tasks.md has been updated

{{workflows/implementation/verification/verify-tasks}}

### Step 2: Update roadmap (if applicable)

{{workflows/implementation/verification/update-roadmap}}

### Step 3: Run entire tests suite

{{workflows/implementation/verification/run-all-tests}}

### Step 4: Create final verification report (MANDATORY)

{{workflows/implementation/verification/create-verification-report}}

The report MUST be written to `haikai/specs/[this-spec]/verification/final-verification.md` even when Steps 1-3 all passed cleanly — record a "✅ Passed" status report rather than skipping the file.
