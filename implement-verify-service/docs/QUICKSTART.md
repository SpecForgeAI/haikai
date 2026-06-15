# Quickstart Guide

Get started with Standards Extractor in 5 minutes!

## Choose Your Setup Method

You can run Standards Extractor in three ways:

1. **Local Containerized Environment** (Recommended for local development) - Isolated dependencies without Docker
2. **Docker** - Fully containerized with Docker
3. **Direct Installation** - Install directly on your system

---

## Method 1: Local Containerized Environment (Recommended)

This method creates an isolated environment with its own Python virtual environment, Claude SDK, and configuration.

### Step 1: Run Setup

**On Linux/macOS/Git Bash:**
```bash
cd standards-extractor
./setup-local-env.sh
```

**On Windows PowerShell:**
```powershell
cd standards-extractor
.\setup-local-env.ps1
```

### Step 2: Configure API Keys

Edit `.env.local` and add your API keys:

```env
# For Anthropic Claude (recommended)
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-5-20250929
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### Step 3: Start the API Server

```bash
./run-local.sh
```

The API will be available at http://localhost:8000 with docs at http://localhost:8000/docs

**For more details, see [QUICKSTART_LOCAL.md](QUICKSTART_LOCAL.md) in the root directory.**

---

## Method 2: Docker

See [DOCKER.md](DOCKER.md) for Docker setup instructions.

---

## Method 3: Direct Installation

### Step 1: Install Dependencies

```bash
cd standards-extractor
python3 -m venv venv
source venv/bin/activate
pip3 install -r requirements.txt
```

## Step 2: Configure API Keys

```bash
cp .env.example .env
```

Edit `.env` and add your API key:

```env
# For Anthropic Claude (recommended)
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-5-20250929
ANTHROPIC_API_KEY=sk-ant-your-key-here

# OR for OpenAI
LLM_PROVIDER=openai
LLM_MODEL=gpt-4-turbo
OPENAI_API_KEY=sk-your-key-here
```

## Step 3: Run Your First Extraction

### Option A: Analyze a Local Project

```bash
source venv/bin/activate
python3 -m src.cli -s /path/to/your/project -p my-project
```

### Option B: Analyze a GitHub Repository

```bash
source venv/bin/activate
python3 -m src.cli -s https://github.com/username/repo -p my-project
```

## Step 4: Review the Results

Check the output directory:

```bash
cd my-project-standards/
ls -la
```

You'll find:
- Standard documents in `backend/`, `frontend/`, `testing/`, `global/`
- A summary report in `REPORT.md`
- Detailed data in `report.json`

## Step 5: Customize (Optional)

### Adjust Exclusion Patterns

Edit `config/exclusions.yaml` to exclude specific files or directories.

### Modify Templates

Edit files in `templates/standards/` to change the output format.

### Change LLM Settings

Update `.env` to use a different model or provider.

## Common Use Cases

### Analyze Multiple Directories

```bash
python3 -m src.cli \
  -s ./backend \
  -s ./frontend \
  -s ./shared \
  -p my-monorepo
```

### Analyze with Custom Output Directory

```bash
python3 -m src.cli \
  -s ./my-project \
  -p my-project \
  -o ./custom-output-dir
```

### Analyze Only Top-Level Files (No Recursion)

```bash
python3 -m src.cli \
  -s ./my-project \
  -p my-project \
  --no-recursive
```

## Troubleshooting

### "LLM API key not found"
- Make sure you've created `.env` from `.env.example`
- Check that your API key is correctly set in `.env`

### "Module not found" errors
- Make sure you've activated the virtual environment: `source venv/bin/activate`
- Reinstall dependencies: `pip3 install -r requirements.txt`

### Files not being analyzed
- Check `config/exclusions.yaml` - you might be excluding them
- Verify file extensions are in the `include_extensions` list
- Use `--max-file-size` to increase the size limit if needed

## Next Steps

1. **Review** the generated standards in detail
2. **Customize** templates to match your documentation style
3. **Integrate** standards into your team's workflow
4. **Iterate** - run multiple times with different configurations

## Additional Resources

- **Local Environment:** [QUICKSTART_LOCAL.md](QUICKSTART_LOCAL.md) - Detailed local containerized setup guide
- **Docker:** [DOCKER.md](DOCKER.md) - Docker setup and usage
- **Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) - System design and components
- **API Reference:** [API.md](API.md) - API endpoints and usage

For more details, see the full [README.md](../README.md).
