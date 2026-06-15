# Quick Start - Local Containerized Environment

Get started with the Standards Extractor in a local containerized environment in just a few minutes.

## Prerequisites

- **Python 3.11+**: [Download Python](https://www.python.org/downloads/)
- **Node.js 18+**: [Download Node.js](https://nodejs.org/)
- **Git**: [Download Git](https://git-scm.com/)

## Setup (5 minutes)

### Linux / macOS

```bash
# 1. Clone the repository
git clone <repository-url>
cd standards-extractor

# 2. Run setup
./setup-local-env.sh

# 3. Configure API keys
nano .env.local  # Add your OPENAI_API_KEY or ANTHROPIC_API_KEY

# 4. Run the application
./run-local.sh
```

### Windows (PowerShell)

```powershell
# 1. Clone the repository
git clone <repository-url>
cd standards-extractor

# 2. Run setup
.\setup-local-env.ps1

# 3. Configure API keys
notepad .env.local  # Add your OPENAI_API_KEY or ANTHROPIC_API_KEY

# 4. Run the application
.\run-local.ps1
```

## What Gets Installed?

The setup script creates a **completely isolated environment**:

1. **Python Virtual Environment** (`.venv-local/`)
   - All Python packages from `requirements.txt`
   - Isolated from your system Python

2. **Claude Code CLI** (`node_modules/`)
   - Installed locally via npm
   - Not installed globally on your system

3. **Configuration** (`.env.local`)
   - Your API keys and settings
   - Separate from Docker configuration

4. **Workspace Directories**
   - `api_workspace/` - API operations
   - `workspace/` - General workspace
   - `logs/orchestration/` - Logs
   - `output/` - Generated files

## Running the Application

### Run the Main Script

**Linux/macOS:**
```bash
./run-local.sh
```

**Windows:**
```powershell
.\run-local.ps1
```

### Run the API Server

**Linux/macOS:**
```bash
./run-local.sh api
```

**Windows:**
```powershell
.\run-local.ps1 api
```

The API will be available at: http://localhost:8000

### Run Tests

**Linux/macOS:**
```bash
./run-local.sh test
```

**Windows:**
```powershell
.\run-local.ps1 test
```

## Configuration

Edit `.env.local` to configure:

```bash
# Required: Choose your LLM provider
LLM_PROVIDER=openai  # or anthropic, azure, custom

# Required: Set your API key
OPENAI_API_KEY=sk-...  # Your OpenAI API key
# OR
ANTHROPIC_API_KEY=sk-ant-...  # Your Anthropic API key

# Required: Choose your model
LLM_MODEL=gpt-4  # or claude-sonnet-4-20250514

# Optional: GitHub token for private repos
GITHUB_TOKEN=ghp_...
```

## Example Usage

### Generate Global Standards

```python
from pathlib import Path
from run import StandardsExtractorClient

client = StandardsExtractorClient(env_file='.env.local')

response = client.generate_global_standards(
    global_dir=Path("./global-standards"),
    sources=["./my-codebase"],
    technical_documents={
        "tech_stack": ["https://github.com/org/repo/blob/main/docs/ARCHITECTURE.md"]
    }
)

print(f"Success: {response.success}")
print(f"Output: {response.output_dir}")
```

### Generate Product Standards

```python
response = client.generate_product_standards(
    project_dir=Path("./my-project"),
    global_dir=Path("./global-standards")
)

print(f"Success: {response.success}")
```

## Troubleshooting

### Setup Issues

**Problem**: `python: command not found`
**Solution**: Install Python 3.11+ from https://www.python.org/

**Problem**: `node: command not found`
**Solution**: Install Node.js from https://nodejs.org/

### Runtime Issues

**Problem**: `Virtual environment not found`
**Solution**: Run the setup script first: `./setup-local-env.sh` or `.\setup-local-env.ps1`

**Problem**: API key errors
**Solution**: Check `.env.local` has your API keys set correctly

## Next Steps

- Read the full documentation: [LOCAL_ENVIRONMENT.md](LOCAL_ENVIRONMENT.md)
- Check the API documentation: [docs/API.md](docs/API.md)
- Review the main README: [README.md](README.md)

## Support

For issues or questions, open an issue on the GitHub repository.
