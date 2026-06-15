# Standards Extractor

Automatically extract coding standards from your existing codebase using AI-powered analysis. This tool scans your projects, analyzes code patterns, and generates comprehensive coding standard documents based on your actual implementation practices.

## Quick Start

### Prerequisites
- **Python 3.11+**: [Download Python](https://www.python.org/downloads/)
- **Node.js 18+**: [Download Node.js](https://nodejs.org/)
- **Git**: [Download Git](https://git-scm.com/)

### Local Setup (5 minutes)

**1. Clone the repository:**
```bash
git clone <repository-url>
cd standards-extractor
```

**2. Run setup:**
```bash
# Linux/macOS
./setup-local-env.sh

# Windows PowerShell
.\setup-local-env.ps1
```

**3. Configure API keys:**
```bash
# Edit .env.local and add your API keys
nano .env.local  # Linux/macOS
notepad .env.local  # Windows
```

Required configuration:
```bash
# Choose your LLM provider
LLM_PROVIDER=openai  # or anthropic, azure, custom

# Set your API key
OPENAI_API_KEY=sk-...  # Your OpenAI API key
# OR
ANTHROPIC_API_KEY=sk-ant-...  # Your Anthropic API key

# Choose your model
LLM_MODEL=gpt-4  # or claude-sonnet-4-20250514
```

**4. Run the server:**
```bash
# Linux/macOS
./run-local.sh

# Windows PowerShell
.\run-local.ps1
```

The API will be available at: **http://localhost:8000**

**Interactive Documentation:**
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

---

## Features

- **Conversational Chat API**: Interactive streaming interface for iterative specification refinement with Claude Code
- **Haikai Orchestration**: Automate complete spec-driven development workflows (write-spec → create-tasks → implement-tasks)
- **Three Operational Modes**: Generate global standards, product-specific standards, or fetch architectural metamodels
- **Directory-Based Workspaces**: Uses `company/project` hierarchy for clean, predictable output
- **Multi-Source Support**: Analyze local directories or remote repositories (GitHub, GitLab, Bitbucket)
- **Intelligent Categorization**: Automatically categorizes files into backend, frontend, testing, and global standards
- **AI-Powered Analysis**: Uses LLMs to extract patterns, conventions, and best practices from your code
- **Template-Based Synthesis**: Generates well-structured standard documents based on provided templates
- **Multiple LLM Providers**: Supports OpenAI, Anthropic, Azure OpenAI, and custom API endpoints
- **Structural Code Analysis**: Two-tier code intelligence using ctags (symbols) + tree-sitter (call graphs, imports, assignments)
- **8 Language Support**: Python, TypeScript, Go, Java, C#, C, Rust, C++ — 17 file extensions
- **8 Diagram Types**: Class, inheritance, dependency, component, package, pattern-map, sequence, and data-flow diagrams
- **4 Output Formats**: Mermaid, PlantUML, Graphviz DOT, and architecture metamodel JSON
- **Config-Driven Languages**: Add new language support via YAML config + extractor class

## API Usage

### Haikai Orchestrator

The API includes a powerful orchestrator for running complete Haikai workflows programmatically.

**Endpoint:** `POST /api/v1/orchestrations`

**Workflow:**
1. **Write Spec:** Runs `/write-spec` to generate `spec.md` (requires existing spec folder with requirements.md)
2. **Create Tasks:** Runs `/create-tasks` to generate `tasks.md`
3. **Implement Tasks:** Runs `/implement-tasks` to implement all tasks and create a verification report

**Prerequisites:** Spec folders with `planning/requirements.md` must be created by an upstream process before orchestration.

**Example Request:**
```bash
# First, run shape-spec to create the spec folder and establish a session:
curl -X POST http://localhost:8000/api/v1/shape-spec/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer changeit" \
  -d '{
    "company": "acme",
    "project": "backend",
    "message": "I need a user authentication system with OAuth2",
    "session_mode": "new"
  }'

# Then orchestrate (session_id is resolved automatically from the active session):
curl -X POST http://localhost:8000/api/v1/orchestrations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer changeit" \
  -d '{
    "company": "acme",
    "project": "backend",
    "spec_intents": [
      {"spec_name": "2026-03-15-user-authentication"}
    ],
    "options": {
      "stop_on_error": true
    }
  }'
```

**Example Response:**
```json
{
  "success": true,
  "spec_names": ["2026-03-15-user-authentication"],
  "session_ids": {"2026-03-15-user-authentication": "a3512afe-e19e-4d74-a234-d8af0b4f0c53"},
  "results": [
    {
      "step": 1,
      "command": "/write-spec",
      "status": "success",
      "output_paths": ["haikai/specs/2026-03-15-user-authentication/spec.md"],
      "execution_time_seconds": 32.1,
      "log_file": "/app/workspace/logs/orchestration/20260315_143000/step-1-write-spec.json"
    },
    {
      "step": 2,
      "command": "/create-tasks",
      "status": "success",
      "output_paths": ["haikai/specs/2026-03-15-user-authentication/tasks.md"],
      "execution_time_seconds": 28.5,
      "log_file": "/app/workspace/logs/orchestration/20260315_143000/step-2-create-tasks.json"
    },
    {
      "step": 3,
      "command": "/implement-tasks",
      "status": "success",
      "output_paths": ["haikai/specs/2026-03-15-user-authentication/verification-report.md"],
      "execution_time_seconds": 180.5,
      "log_file": "/app/workspace/logs/orchestration/20260315_143000/step-3-implement-tasks.json"
    }
  ],
  "total_execution_time_seconds": 286.3,
  "orchestration_log": "/app/workspace/logs/orchestration/20260315_143000/orchestration.json"
}
```

### Conversational Chat API

Interact with Claude Code through a streaming conversational interface for iterative specification refinement. The chat API provides real-time token-by-token streaming responses with full access to all Haikai skills, enabling natural back-and-forth dialogue for requirements gathering and specification development.

**Start or Continue Conversation:** `POST /api/v1/shape-spec/stream`

```bash
# Start new shape-spec conversation (automatic /shape-spec prefix)
curl -X POST http://localhost:8000/api/v1/shape-spec/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer changeit" \
  -d '{
    "company": "acme",
    "project": "backend",
    "message": "I need a user authentication system with OAuth2",
    "session_mode": "new"
  }'

# Continue existing conversation
curl -X POST http://localhost:8000/api/v1/shape-spec/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer changeit" \
  -d '{
    "company": "acme",
    "project": "backend",
    "message": "Can you add Google OAuth support?"
  }'
```

**Session Modes:**
- `resume` (default): Continue existing conversation or start new if none exists. Messages sent as-is.
- `new`: Clear existing session and start fresh conversation. Automatically prefixes message with `/shape-spec`.

**Response:** Server-Sent Events (SSE) stream with real-time content, skill invocations, and file modifications.

```
data: {"type": "content", "delta": "I'll help you"}
data: {"type": "content", "delta": " define the requirements..."}
data: {"type": "skill_invoked", "skill": "write-spec"}
data: {"type": "file_modified", "path": "haikai/specs/user-auth/spec.md"}
data: {"type": "done"}
```

**Get Conversation History:** `GET /api/v1/shape-spec/history`

```bash
curl "http://localhost:8000/api/v1/shape-spec/history?company=acme&project=backend" \
  -H "Authorization: Bearer changeit"
```

**Clear Conversation:** `DELETE /api/v1/shape-spec`

```bash
curl -X DELETE http://localhost:8000/api/v1/shape-spec \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer changeit" \
  -d '{"company": "acme", "project": "backend"}'
```

**Key Features:**
- **Real-time streaming**: Token-by-token delivery via Server-Sent Events (SSE) using Claude CLI's stream-json format
- **Session persistence**: Deterministic UUID-based sessions per company/project using uuid.uuid5
- **Haikai integration**: Full access to all skills (/write-spec, /create-tasks, /implement-tasks, /shape-spec, /plan-product)
- **Audit logging**: Complete conversation history in JSONL format with thread-safe operations
- **Cross-platform**: Windows and Unix support with proper path encoding
- **Permission handling**: Automated via --dangerously-skip-permissions flag (safe in project scope)
- **Session modes**: Resume existing conversations or start fresh with explicit session control

**Implementation Details:**
- Uses Claude CLI wrapper pattern with subprocess management
- Project-scoped commands in `.claude/commands/` directory
- Session files stored in `~/.claude/projects/{encoded_path}/{uuid}.jsonl`
- Audit logs in `api_workspace/{company}/{project}/chat_logs/messages.jsonl`
- Supports skill invocation tracking and file modification notifications

**Detailed Documentation:** [CHAT_API.md](docs/CHAT_API.md)

### Shape-Spec Endpoints

For more granular control, use the shape-spec endpoints to create spec folders without running the full workflow.

**Create Shape-Specs:** `POST /api/v1/haikai/shape-specs`

```bash
curl -X POST http://localhost:8000/api/v1/haikai/shape-specs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer changeit" \
  -d '{
    "company": "acme",
    "project": "backend",
    "spec_intents": [
      "title: User Registration\n\ncontext: Users need accounts...\n\ngoal: Implement registration...\n\nrequirements:\n  - Email validation\n  - Password hashing"
    ]
  }'
```

**Get All Specs:** `GET /api/v1/haikai/shape-specs/{company}/{project}`

```bash
curl http://localhost:8000/api/v1/haikai/shape-specs/acme/backend \
  -H "Authorization: Bearer changeit"
```

### Standards Generation Endpoints

**Generate Global Standards:** `POST /api/v1/standards/global/generate`

```bash
curl -X POST http://localhost:8000/api/v1/standards/global/generate?company=acme \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer changeit" \
  -d '{
    "sources": ["./my-codebase"],
    "technical_documents": {
      "tech_stack": ["https://github.com/org/repo/blob/main/docs/ARCHITECTURE.md"]
    }
  }'
```

**Generate Product Standards:** `POST /api/v1/standards/product/generate`

```bash
curl -X POST http://localhost:8000/api/v1/standards/product/generate?company=acme&project=backend \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer changeit" \
  -d '{
    "sources": []
  }'
```

**All API Endpoints (27 total):**

*Standards Generation:*
- `POST /api/v1/standards/global/generate` - Generate global standards
- `POST /api/v1/standards/product/generate` - Generate product standards
- `GET /api/v1/metamodels/{company}/{project}/{metamodel_id}` - Retrieve metamodel

*Haikai CRUD:*
- `GET /api/v1/specs/{company}/{project}` - List all specs
- `GET /api/v1/specs/{company}/{project}/{spec_id}` - Get spec detail
- `POST /api/v1/specs/{company}/{project}/write-spec` - Write spec
- `DELETE /api/v1/specs/{company}/{project}/{spec_id}` - Delete spec
- `GET /api/v1/specs/{company}/{project}/{spec_id}/tasks` - Get tasks
- `POST /api/v1/specs/{company}/{project}/{spec_id}/tasks/generate` - Generate tasks
- `POST /api/v1/specs/{company}/{project}/{spec_id}/implement` - Implement tasks

*Orchestrations:*
- `POST /api/v1/orchestrations` - Run full workflow
- `GET /api/v1/orchestrations/{id}/status` - Check status
- `GET /api/v1/orchestrations/{id}/logs` - View logs

*Streaming Chat:*
- `POST /api/v1/shape-spec/stream` - Shape-spec conversation
- `POST /api/v1/plan-product/stream` - Product planning conversation
- `POST /api/v1/story-component-anchor/stream` - Story component anchoring
- `GET /api/v1/shape-spec/history` | `GET /api/v1/plan-product/history` - History
- `DELETE /api/v1/shape-spec` | `DELETE /api/v1/plan-product` - Clear session
- `POST /api/v1/haikai/shape-specs` - Create shape-spec folders
- `GET /api/v1/haikai/shape-specs/{company}/{project}` - List shape-specs

*Async Jobs:*
- `POST /api/v1/jobs/orchestrations` - Queue async job
- `GET /api/v1/jobs/{job_id}` | `GET /api/v1/jobs` - Job status/list
- `DELETE /api/v1/jobs/{job_id}` - Cancel job

See [docs/API.md](docs/API.md) for complete API reference.
## Installation Options

### Option 1: Local Environment (Recommended)

See [Quick Start](#quick-start) section above.

**What Gets Installed:**
- Python Virtual Environment (`.venv-local/`)
- Claude Code CLI (`node_modules/`)
- Configuration (`.env.local`)
- Workspace directories (`api_workspace/`, `logs/`, `output/`)

**Detailed Documentation:** [QUICKSTART_LOCAL.md](docs/QUICKSTART_LOCAL.md)

### Option 2: Docker

Run Standards Extractor in a Docker container:

```bash
# Clone the repository
git clone <repository-url>
cd standards-extractor

# Create .env from the template and set your API keys
cp .env.docker .env
nano .env  # or notepad .env on Windows

# Start the service
docker-compose up --build
```

The API will be available at http://localhost:8000

> **Note:** Project workspace data is persisted at `~/.haikai` on your host machine (mounted as `/app/workspace` inside the container). This directory is created automatically on first run.

**Detailed Documentation:** [DOCKER.md](docs/DOCKER.md)

### Option 3: Standard Python Installation

**Prerequisites:**
- Python 3.11 or higher
- pip package manager

**Setup:**

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd standards-extractor
   ```

2. **Install dependencies:**
   ```bash
   pip3 install -r requirements.txt
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env and set your API keys
   ```

4. **Run the server:**
   ```bash
   python3 -m src.entrypoints.run_api --host 0.0.0.0 --port 8000
   ```

   Entry points live in `src/entrypoints/` and are launched as modules
   (`python -m src.entrypoints.<name>`) — run from the repo root:

   | Command | What it starts |
   |---|---|
   | `python -m src.entrypoints.run_api` | API server (production launcher; `--help` for flags) |
   | `python -m src.entrypoints.main` | API server (minimal uvicorn launcher; `API_HOST`/`API_PORT` env) |
   | `python -m src.entrypoints.debug_api` | API server with debug logging (for IDE breakpoints) |
   | `python -m src.entrypoints.debug_worker` | Background job-queue worker |
   | `python -m src.entrypoints.mock_server` | Mock API server (for client/integration testing) |
   | `python -m src.entrypoints.run` | SDK example script (programmatic usage) |

   Or use the convenience scripts: `./run-local.sh` (Linux/macOS, Git Bash) /
   `.\run-local.ps1` (Windows PowerShell) — start the API server; pass `worker`
   to start the worker, `test` to run the suite.

## CLI Usage

The Standards Extractor CLI operates in one of three mutually exclusive modes.

### 1. Generate Global Standards

Generate a set of global, baseline standards from one or more codebases.

```bash
standards-extractor generate-global-standards \
  --global-dir /path/to/your/global-standards \
  --sources ./my-project-code \
  --sources https://github.com/my-org/another-repo
```

**Parameters:**
- `--global-dir` (required): Directory where global standards will be written
- `--sources` (required, multiple): Local paths or remote repository URLs to analyze

### 2. Generate Product Standards

Generate product-specific technical standards that build upon the global baseline.

```bash
standards-extractor generate-product-standards \
  --project-dir /path/to/your/project-workspace \
  --global-dir /path/to/your/global-standards
```

**Parameters:**
- `--project-dir` (required): Workspace for the specific product
- `--global-dir` (required): Directory containing pre-existing global standards

### 3. Get Metamodel

Fetch an architectural metamodel from an external system (e.g., SpecForge).

```bash
standards-extractor get-metamodel \
  --metamodel-id "your-project-identifier" \
  --project-dir /path/to/your/project-workspace
```

**Parameters:**
- `--metamodel-id` (required): Unique identifier for the project
- `--project-dir` (required): Directory where the metamodel will be saved

## Programmatic Usage (SDK)

Use the `StandardsExtractorClient` for programmatic access.

```python
from run import StandardsExtractorClient
from pathlib import Path

client = StandardsExtractorClient(env_file='.env.local')

# Generate global standards
response = client.generate_global_standards(
    global_dir=Path("./global-standards"),
    sources=["./my-codebase"],
    technical_documents={
        "tech_stack": ["https://github.com/org/repo/blob/main/docs/ARCHITECTURE.md"]
    }
)

if response.success:
    print(f"Successfully created standards at: {response.output_dir}")
else:
    print(f"Error: {response.error}")
```

## How It Works

The Standards Extractor uses a multi-stage pipeline:

1. **Source Collection**: Gathers code from local directories or remote repositories
2. **File Analysis**: Categorizes files and extracts relevant code patterns
3. **AI-Powered Extraction**: Uses LLMs to identify conventions and best practices
4. **Template-Based Synthesis**: Generates structured standard documents
5. **Output Generation**: Creates markdown files organized by category

## Documentation

- **[API Documentation](docs/API.md)** - Complete REST API reference
- **[Conversational Chat API](docs/CHAT_API.md)** - Streaming chat interface guide
- **[Shape-Spec API](docs/API_SHAPE_SPEC.md)** - Shape-spec endpoint details
- **[Architecture](docs/ARCHITECTURE.md)** - System architecture and design
- **[Haikai Configuration](docs/HAIKAI_CONFIGURATION.md)** - Haikai setup guide
- **[Quick Start Guide](docs/QUICKSTART_LOCAL.md)** - Get started in 5 minutes
- **[Docker Setup](docs/DOCKER.md)** - Docker deployment guide
- **[Changelog](docs/CHANGELOG.md)** - Version history and updates

## Configuration

### LLM Provider Configuration

The Standards Extractor supports multiple LLM providers. Configure in `.env.local`:

**OpenAI:**
```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4
```

**Anthropic:**
```bash
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-20250514
```

**Azure OpenAI:**
```bash
LLM_PROVIDER=azure
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_DEPLOYMENT=your-deployment-name
AZURE_OPENAI_API_VERSION=2024-02-15-preview
```

**Custom API:**
```bash
LLM_PROVIDER=custom
CUSTOM_API_KEY=...
CUSTOM_API_BASE=https://your-api.com/v1
LLM_MODEL=your-model-name
```

### Workspace Configuration

Configure workspace directories in `.env.local`:

```bash
# API workspace (for orchestration)
API_WORKSPACE_DIR=/app/api_workspace

# General workspace (for CLI)
WORKSPACE_DIR=/app/workspace

# Output directory
OUTPUT_DIR=/app/output

# Logs directory
ORCHESTRATION_LOG_DIR=/app/logs/orchestration
```

## Troubleshooting

### Setup Issues

**Problem:** `python: command not found`  
**Solution:** Install Python 3.11+ from https://www.python.org/

**Problem:** `node: command not found`  
**Solution:** Install Node.js from https://nodejs.org/

### Runtime Issues

**Problem:** Virtual environment not found  
**Solution:** Run the setup script first: `./setup-local-env.sh` or `.\setup-local-env.ps1`

**Problem:** API key errors  
**Solution:** Check `.env.local` has your API keys set correctly

**Problem:** Orchestration timeout  
**Solution:** Set `"timeout_seconds": null` in options for unlimited timeout

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting pull requests.

## License

[Your License Here]

## Support

For issues or questions, open an issue on the GitHub repository.
