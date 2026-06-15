# Claude Code Configuration Verification Guide

This guide explains how to verify that Claude Code CLI is properly configured in the Standards Extractor Docker environment for Haikai orchestration.

## Overview

The Haikai Orchestrator requires Claude Code CLI to be properly installed and configured with:
- Claude CLI binary accessible in PATH
- Valid Anthropic API key
- Haikai profiles directory
- Correct environment variables

## Quick Verification

Run the diagnostic script inside the Docker container:

```bash
docker-compose exec standards-extractor-api python3 /app/scripts/verify_claude_config.py
```

**Expected output:**
```
==================================================
Claude Code CLI Configuration Check
==================================================

✓ Claude Cli
✓ Api Key
✓ Profiles
✓ Profiles Path
✓ Cli Test
✓ Workspace

Passed: 6/6 checks

✓ All checks passed! Claude Code is properly configured.
```

---

## Detailed Verification Steps

### 1. Verify Docker Container is Running

```bash
docker-compose ps
```

Expected output should show `standards-extractor-api` as `Up`.

### 2. Enter the Container

```bash
docker-compose exec standards-extractor-api bash
```

### 3. Check Claude CLI Installation

```bash
which claude
claude --version
```

**Expected:**
- Path: `/usr/local/bin/claude` (or similar)
- Version: `claude-code v1.x.x`

**If not found:**
- Check Dockerfile build logs for errors during Claude Code installation
- Rebuild the container: `docker-compose build --no-cache`

### 4. Verify API Key

```bash
echo $ANTHROPIC_API_KEY | cut -c1-10
```

**Expected:**
- Should show first 10 characters of your API key (e.g., `sk-ant-api`)

**If empty:**
- Check `.env.docker` file has `ANTHROPIC_API_KEY=sk-ant-...`
- Verify `docker-compose.yml` loads `.env.docker` with `env_file: .env.docker`
- Restart container: `docker-compose down && docker-compose up`

### 5. Check Haikai Profiles

```bash
ls -la /app/haikai-profiles/
ls -la /app/haikai-profiles/default/commands/
```

**Expected:**
- Directory exists: `/app/haikai-profiles/`
- Contains `default/` profile
- Commands directory has: `write-spec/`, `create-tasks/`, `implement-tasks/`

**If missing:**
- Check if `haikai-profiles/` directory exists in project root
- Verify Dockerfile copies profiles: `COPY haikai-profiles/ /app/haikai-profiles/`
- Rebuild container: `docker-compose build --no-cache`

### 6. Verify Profiles Path Environment Variable

```bash
echo $CLAUDE_PROFILES_PATH
```

**Expected:**
- Should show: `/app/haikai-profiles`

**If empty:**
- Check Dockerfile sets: `ENV CLAUDE_PROFILES_PATH=/app/haikai-profiles`
- Rebuild container

### 7. Test Claude CLI Functionality

```bash
claude --help
```

**Expected:**
- Should display help text without errors

**If fails:**
- Check permissions: `ls -la $(which claude)`
- Verify Node.js is installed: `node --version`
- Check Claude CLI logs for errors

### 8. Test Simple Claude Command

```bash
claude --print "Hello, test"
```

**Expected:**
- Should return a response from Claude
- May take a few seconds

**If fails:**
- Check API key is valid
- Verify network connectivity
- Check Anthropic API status

---

## Common Issues and Solutions

### Issue: Claude CLI Not Found

**Symptoms:**
```
bash: claude: command not found
```

**Solutions:**
1. Check if Claude Code was cloned during build:
   ```bash
   ls -la /tmp/claude-code
   ```

2. Verify installation in Dockerfile:
   ```dockerfile
   RUN cd /tmp/claude-code && npm install -g .
   ```

3. Rebuild container:
   ```bash
   docker-compose build --no-cache
   docker-compose up
   ```

### Issue: ANTHROPIC_API_KEY Not Set

**Symptoms:**
```
✗ ANTHROPIC_API_KEY is not set
```

**Solutions:**
1. Check `.env.docker` file:
   ```bash
   cat .env.docker | grep ANTHROPIC_API_KEY
   ```

2. Verify docker-compose.yml loads it:
   ```yaml
   env_file:
     - .env.docker
   ```

3. Restart container:
   ```bash
   docker-compose down
   docker-compose up
   ```

### Issue: Haikai Profiles Not Found

**Symptoms:**
```
✗ Profiles directory not found: /app/haikai-profiles
```

**Solutions:**
1. Check if profiles exist in project:
   ```bash
   ls -la haikai-profiles/
   ```

2. Verify Dockerfile copies them:
   ```dockerfile
   COPY haikai-profiles/ /app/haikai-profiles/
   ```

3. Rebuild container:
   ```bash
   docker-compose build --no-cache
   ```

### Issue: Claude Command Times Out

**Symptoms:**
```
✗ Command timed out after 10s
```

**Solutions:**
1. Check API key is valid
2. Verify network connectivity from container:
   ```bash
   curl -I https://api.anthropic.com
   ```
3. Check Anthropic API status: https://status.anthropic.com
4. Increase timeout in orchestrator settings

### Issue: Permission Denied

**Symptoms:**
```
bash: /usr/local/bin/claude: Permission denied
```

**Solutions:**
1. Check file permissions:
   ```bash
   ls -la $(which claude)
   ```

2. Fix permissions in Dockerfile:
   ```dockerfile
   RUN chmod +x /usr/local/bin/claude
   ```

3. Rebuild container

---

## Testing the Full Orchestrator

Once configuration is verified, test the full Haikai orchestrator:

### 1. Create a Test Project Directory

```bash
docker-compose exec standards-extractor-api mkdir -p /app/api_workspace/test-project
```

### 2. Call the Orchestration API

```bash
curl -X POST "http://localhost:8000/api/v1/haikai/orchestrate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "feature_description": "Add user authentication with OAuth2",
    "project_dir": "/app/api_workspace/test-project"
  }'
```

### 3. Monitor Logs

```bash
docker-compose logs -f standards-extractor-api
```

**Expected log output:**
```
[Haikai Orchestrator] Starting orchestration...
[Haikai Orchestrator] Step 1/3: write-spec
[Claude CLI] Executing: /write-spec
[Haikai Orchestrator] Step 1 completed successfully
[Haikai Orchestrator] Step 2/3: create-tasks
...
```

### 4. Check Generated Files

```bash
docker-compose exec standards-extractor-api ls -la /app/api_workspace/test-project/haikai/specs/
```

**Expected structure:**
```
haikai/
└── specs/
    └── [spec-name]/
        ├── spec.md
        ├── tasks.md
        └── implementation files...
```

---

## Automated Verification Script

For convenience, use the provided diagnostic script:

```bash
# From host machine
docker-compose exec standards-extractor-api python3 /app/scripts/verify_claude_config.py

# Or from inside container
docker-compose exec standards-extractor-api bash
python3 /app/scripts/verify_claude_config.py
```

The script checks all configuration points and provides a summary report.

---

## Environment Variables Reference

| Variable | Purpose | Example | Required |
|----------|---------|---------|----------|
| `ANTHROPIC_API_KEY` | Claude API authentication | `sk-ant-api03-...` | Yes |
| `CLAUDE_PROFILES_PATH` | Haikai profiles location | `/app/haikai-profiles` | Yes |
| `API_WORKSPACE_DIR` | Workspace for generated files | `/app/api_workspace` | Yes |
| `LLM_PROVIDER` | LLM provider (for other features) | `openai` | No |
| `OPENAI_API_KEY` | OpenAI key (for other features) | `sk-proj-...` | No |

---

## Next Steps

After verifying configuration:

1. **Test the orchestrator** with a simple feature description
2. **Review generated files** to ensure quality
3. **Monitor logs** for any errors or warnings
4. **Adjust configuration** as needed (timeouts, model selection, etc.)

For more information, see:
- [Haikai Orchestrator Specification](../haikai_orchestrator_spec.md)
- [Diagnostic Scripts README](../scripts/README.md)
- [Main README](../README.md)
