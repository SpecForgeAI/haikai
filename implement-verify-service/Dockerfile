# Dockerfile for Standards Extractor API with Haikai Orchestration
# Production-ready Python FastAPI service with Claude Code CLI

FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies and Node.js
RUN apt-get update && apt-get install -y \
    curl \
    git \
    build-essential \
    dos2unix \
    universal-ctags \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies (tree-sitter needs build-essential, already installed above)
RUN pip install --no-cache-dir -r requirements.txt

# Install Claude Code CLI from NPM
RUN npm install -g @anthropic-ai/claude-code

# Copy Haikai profiles
COPY haikai-profiles /app/haikai-profiles

# Set environment variable for Claude to find profiles
ENV HAIKAI_PROFILES_PATH=/app/haikai-profiles

# Haikai Configuration Flags
# Set to false to disable interactive prompts in /orchestrate-tasks
ENV use_claude_code_subagents=false
ENV standards_as_claude_code_skills=false

# Create non-root user for running the application
# (Claude CLI refuses --dangerously-skip-permissions as root)
RUN useradd -m -s /bin/bash appuser

# Create Claude CLI config directory for the non-root user
RUN mkdir -p /home/appuser/.claude
COPY config/claude/config.json /home/appuser/.claude/config.json
COPY config/claude/settings.json /home/appuser/.claude/settings.json
RUN chown -R appuser:appuser /home/appuser/.claude

# Copy application code
COPY . .

# Fix line endings for shell scripts (Windows compatibility) and setup Claude commands
RUN find /app/scripts -name "*.sh" -type f -exec dos2unix {} \; && \
    chmod +x /app/scripts/docker/setup_claude_commands.sh && \
    /app/scripts/docker/setup_claude_commands.sh

# Create workspace directories for Haikai operations
RUN mkdir -p /app/workspace /app/logs/orchestration

# Set ownership for all app directories to the non-root user
RUN chown -R appuser:appuser /app

# Copy Claude commands to the non-root user's home. Fail-loud if missing —
# the prior `cp ... 2>/dev/null || true` swallowed the error silently when
# `setup_claude_commands.sh` (above) didn't produce /root/.claude/commands,
# leaving the agent with no commands available at runtime.
RUN if [ -d /root/.claude/commands ]; then \
        cp -r /root/.claude/commands /home/appuser/.claude/; \
    else \
        echo "ERROR: /root/.claude/commands missing — setup_claude_commands.sh failed" >&2; \
        exit 1; \
    fi && \
    chown -R appuser:appuser /home/appuser/.claude

# Switch to non-root user
USER appuser

# Set HOME environment for the non-root user
ENV HOME=/home/appuser

# Configure git identity for automated commits (must be after USER switch)
RUN git config --global user.name "Haikai Bot" && \
    git config --global user.email "bot@haikai.ai"

# Expose API port
EXPOSE 8000

# Health check (uses localhost — bind addr is 0.0.0.0, but the check runs
# inside the container so loopback is the right target).
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Run the API server
CMD ["python3", "-m", "src.entrypoints.run_api", "--host", "0.0.0.0", "--port", "8000"]
