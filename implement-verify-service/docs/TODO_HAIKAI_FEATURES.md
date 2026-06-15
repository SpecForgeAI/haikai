# TODO: Haikai Future Features

This document tracks planned enhancements for Haikai integration in the Standards Extractor API.

---

## 1. Subagent Support for Parallel Task Execution

**Status**: 🔴 Not Started  
**Priority**: Medium  
**Complexity**: High

### Description

Enable the `/orchestrate-tasks` command to delegate tasks to multiple Claude Code subagents for parallel execution.

### Current State

- `use_claude_code_subagents` flag is set to `false` by default
- When enabled, `/orchestrate-tasks` prompts user to assign subagent names to each task group
- Interactive prompt blocks automated execution

### Goal

Support fully automated subagent assignment without user interaction.

### Implementation Options

#### Option A: Auto-assign default subagent
```yaml
# Automatically assign a default subagent to all task groups
task_groups:
  - name: authentication-system
    claude_code_subagent: default-agent
  - name: user-dashboard
    claude_code_subagent: default-agent
```

#### Option B: Intelligent subagent selection
```yaml
# Use task group characteristics to select appropriate subagent
task_groups:
  - name: authentication-system
    claude_code_subagent: backend-specialist  # Auto-detected from keywords
  - name: user-dashboard
    claude_code_subagent: frontend-specialist  # Auto-detected from keywords
```

#### Option C: Configuration-based assignment
```yaml
# Define subagent assignment rules in config file
subagent_rules:
  - pattern: "*-api|*-backend|*-database"
    subagent: backend-specialist
  - pattern: "*-ui|*-frontend|*-dashboard"
    subagent: frontend-specialist
  - default: full-stack-agent
```

### Tasks

- [ ] Research Claude Code subagent API and capabilities
- [ ] Design subagent assignment strategy (choose option A, B, or C)
- [ ] Implement auto-assignment logic
- [ ] Update `/orchestrate-tasks` command to use auto-assignment when `use_claude_code_subagents=true`
- [ ] Add configuration file for subagent rules (if using Option C)
- [ ] Test parallel task execution with multiple subagents
- [ ] Document subagent configuration and usage
- [ ] Update `docs/HAIKAI_CONFIGURATION.md` with new behavior

### Related Code

- `haikai-profiles/default/commands/orchestrate-tasks/orchestrate-tasks.md` (lines 38-78)
- Conditional block: `{{IF use_claude_code_subagents}}`

---

## 2. Standards Integration and Auto-Assignment

**Status**: 🔴 Not Started  
**Priority**: Medium  
**Complexity**: Medium

### Description

Automate the assignment of coding standards to task groups during orchestration.

### Current State

- `standards_as_claude_code_skills` flag is set to `false` by default
- When `false`, `/orchestrate-tasks` prompts user to assign standards to each task group
- User must manually specify which standards apply to each task group
- Interactive prompt blocks automated execution

### Goal

Support fully automated standards assignment without user interaction.

### Implementation Options

#### Option A: Assign all standards to all tasks
```yaml
# Simple approach: apply all standards to every task group
task_groups:
  - name: authentication-system
    standards:
      - all
  - name: user-dashboard
    standards:
      - all
```

#### Option B: Intelligent standards selection
```yaml
# Use task group characteristics to select relevant standards
task_groups:
  - name: authentication-system
    standards:
      - backend/*
      - global/security.md
      - global/error-handling.md
  - name: user-dashboard
    standards:
      - frontend/*
      - global/accessibility.md
```

#### Option C: Configuration-based assignment
```yaml
# Define standards assignment rules in config file
standards_rules:
  - pattern: "*-api|*-backend"
    standards:
      - backend/*
      - global/error-handling.md
  - pattern: "*-ui|*-frontend"
    standards:
      - frontend/*
      - global/accessibility.md
  - default:
      - all
```

#### Option D: Integrate as Claude Code Skills
- Convert standards documents into Claude Code skills
- Set `standards_as_claude_code_skills=true`
- Claude automatically applies relevant standards

### Tasks

- [ ] Analyze existing standards directory structure
- [ ] Design standards assignment strategy (choose option A, B, C, or D)
- [ ] Implement auto-assignment logic
- [ ] Update `/orchestrate-tasks` command to use auto-assignment
- [ ] Add configuration file for standards rules (if using Option C)
- [ ] Test standards application in generated code
- [ ] Document standards configuration and usage
- [ ] Update `docs/HAIKAI_CONFIGURATION.md` with new behavior

### Related Code

- `haikai-profiles/default/commands/orchestrate-tasks/orchestrate-tasks.md` (lines 80-138)
- Conditional block: `{{UNLESS standards_as_claude_code_skills}}`
- Workflow: `{{workflows/implementation/compile-implementation-standards}}`

---

## 3. Fully Automated Orchestration

**Status**: 🟡 In Progress  
**Priority**: High  
**Complexity**: Low

### Description

Remove all interactive prompts from `/orchestrate-tasks` to enable fully automated workflow execution.

### Current State

- ✅ `/write-spec` - No interactive prompts (completed)
- ✅ `/create-tasks` - No interactive prompts (completed)
- 🟡 `/implement-tasks` - Needs testing with sufficient API credits
- 🟡 `/orchestrate-tasks` - Has conditional interactive prompts

### Goal

All Haikai commands should run without user interaction when invoked programmatically.

### Remaining Work

#### `/orchestrate-tasks` Prompts

1. **Subagent assignment prompt** (lines 39-52)
   - Currently skipped when `use_claude_code_subagents=false` ✅
   - Need to implement auto-assignment when enabled (see TODO #1)

2. **Standards assignment prompt** (lines 82-98)
   - Currently active when `standards_as_claude_code_skills=false` ❌
   - Need to implement auto-assignment (see TODO #2)
   - **Temporary workaround**: Set `standards_as_claude_code_skills=true` to skip prompt

### Tasks

- [x] Set `use_claude_code_subagents=false` in Docker (completed)
- [x] Set `standards_as_claude_code_skills=false` in Docker (completed)
- [ ] Implement auto-assignment for subagents (TODO #1)
- [ ] Implement auto-assignment for standards (TODO #2)
- [ ] Test full workflow with sufficient API credits
- [ ] Verify no interactive prompts appear
- [ ] Document fully automated workflow usage

---

## 4. API Workspace Integration

**Status**: 🟢 Completed  
**Priority**: High  
**Complexity**: Low

### Description

Ensure Haikai commands create files in the correct workspace directory with proper permissions.

### Current State

- ✅ Claude CLI permissions configured for `/app/api_workspace/`
- ✅ Can read/write/edit/delete in workspace
- ✅ Global read access for context
- ✅ Security protections in place

### Completed Tasks

- [x] Configure Claude CLI `settings.json` with workspace permissions
- [x] Set up `/app/api_workspace/` directory in Docker
- [x] Test file creation in workspace
- [x] Document permission configuration

### Related Documentation

- `config/claude/PERMISSIONS.md`
- `config/claude/settings.json`

---

## 5. Enhanced Error Handling and Logging

**Status**: 🔴 Not Started  
**Priority**: Low  
**Complexity**: Medium

### Description

Improve error handling and logging for Haikai command execution.

### Goals

- Capture Claude CLI output and errors
- Log command execution progress
- Provide detailed error messages when commands fail
- Track file creation and modification
- Monitor API credit usage

### Tasks

- [ ] Add logging wrapper around Claude CLI invocations
- [ ] Capture stdout/stderr from Claude commands
- [ ] Parse Claude output for errors and warnings
- [ ] Store execution logs in `/app/logs/orchestration/`
- [ ] Add API credit usage tracking
- [ ] Implement retry logic for transient failures
- [ ] Create dashboard for monitoring command execution
- [ ] Document logging configuration

---

## 6. Testing Infrastructure

**Status**: 🟡 In Progress  
**Priority**: Medium  
**Complexity**: Medium

### Description

Comprehensive testing for Haikai workflow execution.

### Current State

- ✅ Basic test script: `scripts/test_haikai_commands.sh`
- ✅ Tests all 4 commands in sequence
- ✅ Verifies file creation
- ❌ No automated CI/CD tests
- ❌ No mock/stub for Claude API

### Goals

- Automated testing in CI/CD pipeline
- Mock Claude API responses for testing
- Integration tests for full workflow
- Performance benchmarks

### Tasks

- [ ] Create mock Claude CLI for testing
- [ ] Add unit tests for orchestration service
- [ ] Add integration tests for full workflow
- [ ] Set up CI/CD pipeline with automated tests
- [ ] Add performance benchmarks
- [ ] Test with various spec complexities
- [ ] Document testing procedures

---

## Priority Matrix

| Feature | Priority | Complexity | Status |
|---------|----------|------------|--------|
| Fully Automated Orchestration | 🔴 High | 🟢 Low | 🟡 In Progress |
| API Workspace Integration | 🔴 High | 🟢 Low | ✅ Completed |
| Subagent Support | 🟡 Medium | 🔴 High | 🔴 Not Started |
| Standards Integration | 🟡 Medium | 🟡 Medium | 🔴 Not Started |
| Testing Infrastructure | 🟡 Medium | 🟡 Medium | 🟡 In Progress |
| Error Handling & Logging | 🟢 Low | 🟡 Medium | 🔴 Not Started |

---

## Contributing

When working on these TODOs:

1. Update the status indicator (🔴 Not Started, 🟡 In Progress, 🟢 Completed, ✅ Done)
2. Check off completed tasks with `[x]`
3. Document implementation decisions
4. Update related documentation
5. Add entry to `docs/HAIKAI_CHANGELOG.md`
6. Test thoroughly before marking as completed

---

## Questions or Ideas?

If you have suggestions for additional features or improvements to these TODOs, please:

1. Add them to this document
2. Discuss in team meetings
3. Create GitHub issues for tracking
4. Update priority/complexity as needed
