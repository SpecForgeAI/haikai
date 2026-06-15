# Scripts Directory

This directory contains diagnostic and utility scripts for the Standards Extractor project, organized by deployment environment.

## Directory Structure

```
scripts/
├── docker/          # Scripts for Docker containerized environment
├── local/           # Scripts for local containerized environment
└── README.md        # This file
```

## Docker Scripts (`docker/`)

Scripts designed to run inside the Docker container with Docker-specific paths and configurations.

### Available Scripts

| Script | Description |
|--------|-------------|
| `verify_claude_config.py` | Verify Claude CLI configuration in Docker |
| `verify_claude_config.sh` | Bash version of the verification script |
| `setup_claude_commands.sh` | Setup Claude commands from Haikai profiles |
| `test_claude_profiles.sh` | Test Claude CLI profile access |
| `test_haikai_commands.sh` | Test Haikai command execution |

### Usage

Run from your host machine:

```bash
# Python verification script
docker-compose exec standards-extractor-api python3 /app/scripts/docker/verify_claude_config.py

# Bash verification script
docker-compose exec standards-extractor-api /app/scripts/docker/verify_claude_config.sh

# Test Claude profiles
docker-compose exec standards-extractor-api /app/scripts/docker/test_claude_profiles.sh
```

Or enter the container first:

```bash
docker-compose exec standards-extractor-api bash
cd /app/scripts/docker
python3 verify_claude_config.py
```

## Local Scripts (`local/`)

Scripts designed for the local containerized environment (without Docker), using local paths and the `.venv-local` virtual environment.

### Available Scripts

| Script | Description |
|--------|-------------|
| `verify_claude_config.py` | Verify local environment configuration |
| `test_claude_profiles.sh` | Test Claude CLI profile access in local environment |
| `test_haikai_commands.sh` | Create test project structure for Haikai testing |

### Usage

Run from the project root directory:

```bash
# Activate virtual environment first
source .venv-local/bin/activate  # Linux/macOS/Git Bash
# OR
.venv-local\Scripts\activate     # Windows PowerShell

# Run verification
python scripts/local/verify_claude_config.py
```

Or use the run-local script:

```bash
./run-local.sh shell
python scripts/local/verify_claude_config.py
```

**Test Claude profiles:**

```bash
./scripts/local/test_claude_profiles.sh
```

**Create Haikai test project:**

```bash
./scripts/local/test_haikai_commands.sh
```

## What the Verification Scripts Check

### Docker Environment

1. **Claude CLI Installation** - Verifies `claude` command is available at `/usr/local/bin/claude`
2. **API Key** - Checks if `ANTHROPIC_API_KEY` environment variable is set
3. **Haikai Profiles** - Verifies profiles directory exists at `/app/haikai-profiles`
4. **Profiles Path** - Checks if `HAIKAI_PROFILES_PATH` is configured
5. **CLI Test** - Runs `claude --help` to test functionality
6. **Workspace Directory** - Verifies `/app/api_workspace` exists

### Local Environment

1. **Claude CLI Installation** - Checks for Claude in `node_modules/.bin/`
2. **API Key** - Verifies `ANTHROPIC_API_KEY` is set in `.env.local`
3. **Haikai Profiles** - Checks `haikai-profiles/` directory
4. **Profiles Path** - Verifies `HAIKAI_PROFILES_PATH` in `.env.local`
5. **Virtual Environment** - Checks if `.venv-local` exists and is activated
6. **Workspace Directory** - Verifies `api_workspace/` directory

## Expected Output

### All Checks Pass

```
==================================================
Configuration Check Summary
==================================================
✓ Claude Cli
✓ Api Key
✓ Profiles
✓ Profiles Path
✓ Cli Test / Venv
✓ Workspace

Passed: 6/6 checks

✓ All checks passed! Environment is properly configured.
```

### Some Checks Fail

```
==================================================
Configuration Check Summary
==================================================
✓ Claude Cli
✓ Api Key
✗ Profiles
✗ Profiles Path
✓ Cli Test / Venv
⚠ Workspace

Passed: 3/6 checks

⚠ Basic configuration is OK, but some checks failed.
  The environment should work, but there may be issues.
```

## Troubleshooting

### Docker Environment

**Claude CLI not found:**
```bash
docker-compose build --no-cache
docker-compose up
```

**API key not set:**
- Check `.env.docker` file
- Restart container: `docker-compose down && docker-compose up`

**Profiles not found:**
```bash
docker-compose exec standards-extractor-api ls -la /app/haikai-profiles
docker-compose build --no-cache
```

### Local Environment

**Claude CLI not found:**
```bash
./setup-local-env.sh  # Run setup again
```

**API key not set:**
- Edit `.env.local` and add your `ANTHROPIC_API_KEY`

**Virtual environment not found:**
```bash
./setup-local-env.sh  # Run setup again
```

**Profiles not found:**
- Check if `haikai-profiles/` directory exists in project root
- Clone the repository again if missing

## Adding New Scripts

When adding new scripts:

1. **Determine the target environment** - Docker or local?
2. **Place in the appropriate directory** - `docker/` or `local/`
3. **Use environment-specific paths**:
   - Docker: `/app/...`
   - Local: Relative to project root or use `get_project_root()`
4. **Update this README** with script description and usage
5. **Make scripts executable**: `chmod +x script-name.sh`

## See Also

- [QUICKSTART.md](../docs/QUICKSTART.md) - Quick start guide for all setup methods
- [QUICKSTART_LOCAL.md](../QUICKSTART_LOCAL.md) - Detailed local environment guide
- [DOCKER.md](../DOCKER.md) - Docker setup and usage
- [LOCAL_ENVIRONMENT.md](../LOCAL_ENVIRONMENT.md) - Comprehensive local environment documentation

---

**Maintained by:** SpecForgeAI Team  
**Last Updated:** January 2026
