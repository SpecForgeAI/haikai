# Local Containerized Environment

This document describes how to run the Standards Extractor in a **containerized local environment** on your computer, completely isolated from Docker and your system-wide installations.

## Overview

The local containerized environment provides:

- **Isolated Python Virtual Environment**: Uses its own Python packages, separate from your system Python
- **Local Claude SDK**: Installs Claude Code CLI locally via npm in the project directory
- **Dedicated Configuration**: Uses `.env.local` for API keys and settings
- **Haikai Profiles**: Includes its own Haikai profiles for orchestration
- **Cross-Platform Support**: Works on Linux, macOS, and Windows

This setup is ideal when you want to run the standards extractor **without Docker** but still maintain complete isolation from your system environment.

## Prerequisites

Before setting up the local containerized environment, ensure you have:

1. **Python 3.11+** installed on your system
   - Download from: https://www.python.org/downloads/
   - Verify: `python --version` (Linux/macOS) or `python --version` (Windows)

2. **Node.js 18+** and npm installed
   - Download from: https://nodejs.org/
   - Verify: `node --version` and `npm --version`

3. **Git** (for cloning the repository)
   - Download from: https://git-scm.com/

## Setup Instructions

### Linux / macOS

1. **Clone the repository** (if you haven't already):
   ```bash
   git clone <repository-url>
   cd standards-extractor
   ```

2. **Run the setup script**:
   ```bash
   ./setup-local-env.sh
   ```

   This script will:
   - Create a Python virtual environment in `.venv-local/`
   - Install all Python dependencies from `requirements.txt`
   - Install Claude Code CLI locally in `node_modules/`
   - Create necessary workspace directories
   - Set up Claude configuration in `~/.claude-local/`
   - Create `.env.local` if it doesn't exist

3. **Configure your API keys**:
   ```bash
   nano .env.local  # or use your preferred editor
   ```

   At minimum, set:
   - `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (depending on your LLM provider)
   - `LLM_PROVIDER` (e.g., `openai` or `anthropic`)
   - `LLM_MODEL` (e.g., `gpt-4` or `claude-sonnet-4-20250514`)

### Windows (PowerShell)

1. **Clone the repository** (if you haven't already):
   ```powershell
   git clone <repository-url>
   cd standards-extractor
   ```

2. **Run the setup script**:
   ```powershell
   .\setup-local-env.ps1
   ```

   This script will:
   - Create a Python virtual environment in `.venv-local\`
   - Install all Python dependencies from `requirements.txt`
   - Install Claude Code CLI locally in `node_modules\`
   - Create necessary workspace directories
   - Set up Claude configuration in `%USERPROFILE%\.claude-local\`
   - Create `.env.local` if it doesn't exist

3. **Configure your API keys**:
   ```powershell
   notepad .env.local  # or use your preferred editor
   ```

   At minimum, set:
   - `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (depending on your LLM provider)
   - `LLM_PROVIDER` (e.g., `openai` or `anthropic`)
   - `LLM_MODEL` (e.g., `gpt-4` or `claude-sonnet-4-20250514`)

## Running the Application

### Linux / macOS

**Run the main script:**
```bash
./run-local.sh
```

**Run the API server:**
```bash
./run-local.sh api
```
The API will be available at http://localhost:8000

**Run tests:**
```bash
./run-local.sh test
```

**Open an interactive shell with the environment activated:**
```bash
./run-local.sh shell
```

### Windows (PowerShell)

**Run the main script:**
```powershell
.\run-local.ps1
```

**Run the API server:**
```powershell
.\run-local.ps1 api
```
The API will be available at http://localhost:8000

**Run tests:**
```powershell
.\run-local.ps1 test
```

**Open an interactive shell with the environment activated:**
```powershell
.\run-local.ps1 shell
```

## Manual Activation

If you prefer to activate the environment manually:

### Linux / macOS

```bash
# Activate virtual environment
source .venv-local/bin/activate

# Set environment variables
export CLAUDE_PROFILES_PATH=$(pwd)/haikai-profiles
export PATH=$(pwd)/node_modules/.bin:$PATH
export NODE_PATH=$(pwd)/node_modules

# Load environment variables from .env.local
export $(grep -v '^#' .env.local | xargs)

# Run Python scripts
python3 run.py
```

### Windows (PowerShell)

```powershell
# Activate virtual environment
.\.venv-local\Scripts\Activate.ps1

# Set environment variables
$env:CLAUDE_PROFILES_PATH = "$(Get-Location)\haikai-profiles"
$env:PATH = "$(Get-Location)\node_modules\.bin;$env:PATH"
$env:NODE_PATH = "$(Get-Location)\node_modules"

# Load environment variables from .env.local
Get-Content ".env.local" | ForEach-Object {
    if ($_ -match '^([^#][^=]+)=(.*)$') {
        $name = $matches[1].Trim()
        $value = $matches[2].Trim()
        Set-Item -Path "env:$name" -Value $value
    }
}

# Run Python scripts
python run.py
```

## Directory Structure

After setup, your project will have the following structure:

```
standards-extractor/
├── .venv-local/              # Python virtual environment (isolated)
├── node_modules/             # Node.js packages including Claude CLI (isolated)
├── haikai-profiles/        # Haikai profiles for orchestration
├── api_workspace/            # API workspace for operations
├── workspace/                # General workspace directory
├── logs/orchestration/       # Orchestration logs
├── output/                   # Generated output files
├── .env.local                # Local environment configuration
├── setup-local-env.sh        # Setup script (Linux/macOS)
├── setup-local-env.ps1       # Setup script (Windows)
├── run-local.sh              # Run script (Linux/macOS)
├── run-local.ps1             # Run script (Windows)
└── ... (other project files)
```

## Environment Variables

The `.env.local` file contains all configuration for the local containerized environment. Key variables include:

### Required Variables

- `LLM_PROVIDER`: Your LLM provider (`openai`, `anthropic`, `azure`, or `custom`)
- `LLM_MODEL`: The model to use (e.g., `gpt-4`, `claude-sonnet-4-20250514`)
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`: Your API key for the chosen provider

### Optional Variables

- `GITHUB_TOKEN`: For accessing private GitHub repositories
- `GITLAB_TOKEN`: For accessing private GitLab repositories
- `MAX_FILE_SIZE_KB`: Maximum file size to process (default: 500)
- `MAX_CONCURRENT_FILES`: Maximum concurrent file processing (default: 5)
- `OUTPUT_DIR`: Output directory for generated files (default: `./output`)

See `.env.local` for the complete list of available configuration options.

## Comparison with Docker

| Feature | Docker | Local Containerized |
|---------|--------|---------------------|
| **Isolation** | Full OS-level containerization | Python venv + local npm packages |
| **Setup Complexity** | Requires Docker installation | Requires Python + Node.js |
| **Startup Time** | Container startup overhead | Immediate (after activation) |
| **Resource Usage** | Higher (full container) | Lower (native processes) |
| **Portability** | Highly portable | Requires Python/Node on host |
| **Development** | Requires rebuilds | Direct code changes |
| **API Keys** | `.env.docker` | `.env.local` |
| **Claude SDK** | Installed in container | Installed in `node_modules/` |
| **Haikai** | Container-based profiles | Local profiles |

## Troubleshooting

### Virtual Environment Not Found

**Error**: `Virtual environment not found`

**Solution**: Run the setup script first:
```bash
./setup-local-env.sh  # Linux/macOS
.\setup-local-env.ps1  # Windows
```

### Claude CLI Not Found

**Error**: `claude: command not found`

**Solution**: Ensure the environment is properly activated and `node_modules/.bin` is in your PATH:
```bash
export PATH=$(pwd)/node_modules/.bin:$PATH  # Linux/macOS
$env:PATH = "$(Get-Location)\node_modules\.bin;$env:PATH"  # Windows
```

### API Key Errors

**Error**: `API key not found` or authentication errors

**Solution**: Check that `.env.local` has the correct API keys set:
```bash
cat .env.local | grep API_KEY  # Linux/macOS
Get-Content .env.local | Select-String "API_KEY"  # Windows
```

### Python Package Errors

**Error**: `ModuleNotFoundError` or import errors

**Solution**: Reinstall dependencies in the virtual environment:
```bash
source .venv-local/bin/activate  # Linux/macOS
.\.venv-local\Scripts\Activate.ps1  # Windows

pip install -r requirements.txt
```

## Updating the Environment

To update dependencies or Claude CLI:

### Linux / macOS

```bash
# Activate environment
source .venv-local/bin/activate

# Update Python packages
pip install --upgrade -r requirements.txt

# Update Claude CLI
npm update @anthropic-ai/claude-code
```

### Windows (PowerShell)

```powershell
# Activate environment
.\.venv-local\Scripts\Activate.ps1

# Update Python packages
pip install --upgrade -r requirements.txt

# Update Claude CLI
npm update @anthropic-ai/claude-code
```

## Cleaning Up

To remove the local containerized environment:

### Linux / macOS

```bash
rm -rf .venv-local
rm -rf node_modules
rm -rf ~/.claude-local
```

### Windows (PowerShell)

```powershell
Remove-Item -Recurse -Force .venv-local
Remove-Item -Recurse -Force node_modules
Remove-Item -Recurse -Force $env:USERPROFILE\.claude-local
```

Then re-run the setup script to start fresh.

## Support

For issues or questions:

1. Check the main [README.md](README.md) for general documentation
2. Review [DOCKER.md](DOCKER.md) for Docker-specific information
3. Open an issue on the GitHub repository

## License

Same as the main project.
