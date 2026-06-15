# Docker Setup for Standards Extractor

This guide explains how to run the Standards Extractor API using Docker.

## Quick Start

### 1. Prerequisites

- Docker Engine 20.10+
- Docker Compose V2+

### 2. Configuration

Copy the environment template and configure your API keys:

```bash
cp .env.docker .env
```

Edit `.env` and set:
- `STANDARDS_API_KEY` - Your API authentication key
- `OPENAI_API_KEY` - Your OpenAI API key (required for LLM operations)

### 3. Start the Service

**Development mode** (with hot reload):
```bash
docker-compose up --build
```

**Production mode**:
```bash
docker build -t standards-extractor:latest .
docker run -p 8000:8000 --env-file .env standards-extractor:latest
```

### 4. Verify the Service

Check health status:
```bash
curl http://localhost:8000/health
```

Expected response:
```json
{
  "status": "healthy",
  "service": "standards-extractor"
}
```

### 5. Access API Documentation

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## Docker Compose Services

### standards-extractor-api

The main API service running on port 8000.

**Volumes:**
- `~/.haikai:/app/workspace` - Persistent workspace directory (contains company/project workspaces, specs, session data, and job queue). Mapped to the host's `~/.haikai` directory so data survives container restarts.

**Environment Variables:**
- `STANDARDS_API_KEY` - API authentication key
- `ANTHROPIC_API_KEY` - Anthropic API key (required for Claude CLI / Haikai orchestration)
- `OPENAI_API_KEY` - OpenAI API key (required if LLM_PROVIDER=openai)
- `LLM_PROVIDER` - LLM provider (default: openai)
- `LLM_MODEL` - LLM model for standards extraction
- `API_WORKSPACE_DIR` - API workspace directory (default: /app/workspace)

## Development Workflow

### Hot Reload

The development Docker image (`Dockerfile.dev`) includes hot reload support. Changes to source files will automatically restart the server.

### Logs

View service logs:
```bash
docker-compose logs -f standards-extractor-api
```

### Shell Access

Access the container shell:
```bash
docker-compose exec standards-extractor-api bash
```

### Stop Services

```bash
docker-compose down
```

## Production Deployment

### Build Production Image

```bash
docker build -t standards-extractor:latest -f Dockerfile .
```

### Run Production Container

```bash
docker run -d \
  --name standards-extractor \
  -p 8000:8000 \
  -v $(pwd)/api_workspace:/app/api_workspace \
  --env-file .env \
  standards-extractor:latest
```

### Health Check

The container includes a health check that runs every 30 seconds:
```bash
docker ps --filter name=standards-extractor
```

## Troubleshooting

### Container won't start

Check logs:
```bash
docker-compose logs standards-extractor-api
```

### API key errors

Ensure `.env` file exists and contains valid keys:
```bash
cat .env | grep API_KEY
```

### Port conflicts

If port 8000 is already in use, modify `docker-compose.yml`:
```yaml
ports:
  - "8001:8000"  # Map to different host port
```

### Volume permissions

If you encounter permission issues with volumes:
```bash
sudo chown -R $(id -u):$(id -g) api_workspace workspace
```

## Network Configuration

The service runs on a dedicated Docker network: `standards-extractor-network`

To connect other services:
```yaml
services:
  your-service:
    networks:
      - standards-extractor-network

networks:
  standards-extractor-network:
    external: true
```

## Environment Variables Reference
| Variable | Required | Default | Description ||----------|----------|---------|-------------|| `STANDARDS_API_KEY` | Yes | - | API authentication key || `ANTHROPIC_API_KEY` | Yes* | - | Anthropic API key (required if LLM_PROVIDER=anthropic) || `OPENAI_API_KEY` | Yes* | - | OpenAI API key (required if LLM_PROVIDER=openai) || `API_WORKSPACE_DIR` | No | `/app/api_workspace` | API workspace directory || `LLM_PROVIDER` | No | `anthropic` | LLM provider (anthropic, openai, azure, custom) || `LLM_MODEL` | No | `claude-haiku-4-5-20251001` | LLM model for orchestration || `CHAT_MODEL` | No | `claude-sonnet-4-5-20250929` | Model for chat/streaming endpoints || `JOBS_DB_PATH` | No | `<workspace>/jobs.db` | SQLite job queue database path || `LOG_DIR` | No | `<workspace>/logs` | Log directory || `ORCHESTRATION_LOG_DIR` | No | `<workspace>/logs/orchestration` | Orchestration log directory || `STANDARD_EXTRACTION_MAX_FILES` | No | unlimited | Max files for standard extraction || `GITHUB_TOKEN` | No | - | GitHub personal access token || `GITLAB_TOKEN` | No | - | GitLab personal access token || `BITBUCKET_USERNAME` | No | - | Bitbucket username || `BITBUCKET_APP_PASSWORD` | No | - | Bitbucket app password |*One of ANTHROPIC_API_KEY or OPENAI_API_KEY is required depending on LLM_PROVIDER.
## Security Considerations

1. **Never commit `.env` file** - It contains sensitive API keys
2. **Use strong API keys** - Generate secure random keys for `STANDARDS_API_KEY`
3. **Limit network exposure** - Only expose necessary ports
4. **Use secrets management** - For production, use Docker secrets or vault services
5. **Regular updates** - Keep base images and dependencies updated

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Build and Push Docker Image

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Build Docker image
        run: docker build -t standards-extractor:${{ github.sha }} .
      - name: Push to registry
        run: |
          echo "${{ secrets.DOCKER_PASSWORD }}" | docker login -u "${{ secrets.DOCKER_USERNAME }}" --password-stdin
          docker push standards-extractor:${{ github.sha }}
```

## Support

For issues or questions:
- GitHub Issues: https://github.com/SpecForgeAI/standards-extractor/issues
- Documentation: See `docs/API.md` for API reference
