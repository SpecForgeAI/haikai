# Haikai Configuration

This document explains the configuration flags used to control Haikai behavior in the Standards Extractor API.

## Environment Variables

### `use_claude_code_subagents`

**Default**: `false`

**Purpose**: Controls whether the `/orchestrate-tasks` command uses Claude Code subagents for parallel task execution.

**Behavior**:

- **`false` (default)**: 
  - Disables subagent assignment prompt
  - Generates individual prompt files for each task group
  - Prompts are stored in `haikai/specs/[spec]/implementation/prompts/`
  - Tasks are executed sequentially
  - **Fully automated** - no user interaction required

- **`true`**:
  - Enables subagent assignment prompt
  - Asks user to assign subagent names to each task group
  - Delegates tasks to multiple Claude Code instances
  - Tasks can be executed in parallel
  - **Interactive** - requires user input

**When to enable**:
- You have multiple Claude Code subagents configured
- You want parallel task execution
- You're comfortable with interactive orchestration

**Configuration**:
```dockerfile
# In Dockerfile or Dockerfile.dev
ENV use_claude_code_subagents=false
```

---

### `standards_as_claude_code_skills`

**Default**: `false`

**Purpose**: Controls whether the `/orchestrate-tasks` command prompts for standards assignment to guide implementation.

**Behavior**:

- **`false` (default)**:
  - Asks user to assign standards to each task group
  - Standards are coding guidelines/preferences stored in `standards/` directory
  - User specifies which standards apply to each task group
  - **Interactive** - requires user input

- **`true`**:
  - Assumes standards are available as Claude Code skills
  - Skips the standards assignment prompt
  - **Automated** - no user interaction required

**When to enable**:
- You have standards integrated as Claude Code skills
- You don't use custom coding standards
- You want fully automated orchestration

**Configuration**:
```dockerfile
# In Dockerfile or Dockerfile.dev
ENV standards_as_claude_code_skills=false
```

---

## Current Configuration

As of the latest build, both flags are set to **`false`** to enable **fully automated, non-interactive** workflow execution:

```dockerfile
# Haikai Configuration Flags
# Set to false to disable interactive prompts in /orchestrate-tasks
ENV use_claude_code_subagents=false
ENV standards_as_claude_code_skills=false
```

This configuration ensures:
- ✅ No subagent assignment prompts
- ✅ No standards assignment prompts (currently asks for standards)
- ✅ Programmatic execution via API
- ✅ Sequential task execution

---

## Future Enhancements

See `docs/TODO_HAIKAI_FEATURES.md` for planned improvements:

1. **Subagent Support**: Enable parallel task execution with multiple Claude instances
2. **Standards Integration**: Auto-assign standards or integrate as Claude Code skills
3. **Fully Automated Orchestration**: Remove all interactive prompts

---

## How Haikai Uses These Flags

The flags are used in conditional blocks within Haikai command files:

### Subagent Flag Usage

```markdown
{{IF use_claude_code_subagents}}
### NEXT: Ask user to assign subagents to each task group
...interactive prompt...
{{ENDIF use_claude_code_subagents}}
```

When `use_claude_code_subagents=false`, this entire section is skipped.

### Standards Flag Usage

```markdown
{{UNLESS standards_as_claude_code_skills}}
### NEXT: Ask user to assign standards to each task group
...interactive prompt...
{{ENDUNLESS standards_as_claude_code_skills}}
```

When `standards_as_claude_code_skills=true`, this entire section is skipped.

---

## Troubleshooting

### `/orchestrate-tasks` still asks for input

**Check**:
1. Environment variables are set in Dockerfile
2. Docker image was rebuilt after adding variables
3. Variables are visible in container: `docker-compose exec standards-extractor-api env | grep claude`

**Solution**:
```bash
docker-compose build standards-extractor-api
docker-compose up -d standards-extractor-api
```

### Want to enable subagents

**Steps**:
1. Set `use_claude_code_subagents=true` in Dockerfile
2. Rebuild Docker image
3. Configure Claude Code subagents
4. Run `/orchestrate-tasks` and provide subagent names when prompted

---

## Related Documentation

- `docs/HAIKAI_CHANGELOG.md` - History of Haikai modifications
- `config/claude/PERMISSIONS.md` - Claude CLI permission configuration
- `docs/TODO_HAIKAI_FEATURES.md` - Planned features and improvements
