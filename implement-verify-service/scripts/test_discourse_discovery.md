# Test: Adaptive Agentic Discovery on Discourse (Ruby/Rails)

## Purpose

Validate that the adaptive discovery pipeline works on a language where
tree-sitter can't parse (Ruby). Discourse is the canonical test case:
large Rails app, many controllers, complex routing, ActionMailer, Sidekiq
jobs, Redis/PostgreSQL interactions.

## Setup

1. Clone Discourse (shallow is fine):
   ```bash
   git clone --depth 1 https://github.com/discourse/discourse.git /tmp/discourse
   ```

2. Run the structural store build (ctags-only, tree-sitter will fail on Ruby):
   ```bash
   python -m src.ast.snapshot /tmp/discourse --output /tmp/discourse-snapshot
   ```

3. Verify data availability — imports and calls should be EMPTY, index should have entries:
   ```bash
   wc -l /tmp/discourse-snapshot/_imports.txt   # expect 0 or header-only
   wc -l /tmp/discourse-snapshot/_calls.txt     # expect 0 or header-only
   wc -l /tmp/discourse-snapshot/_index.txt     # expect thousands (ctags)
   wc -l /tmp/discourse-snapshot/_inheritance.txt  # expect entries
   ```

## Test 1: Endpoint Discovery

```bash
python -c "
from src.ast.endpoint_discoverer import discover_endpoints
from src.llm.client import create_llm_client

client = create_llm_client('openai', model='gpt-5.4-mini')
endpoints = discover_endpoints(
    client,
    project_root='/tmp/discourse',
    snapshot_path='/tmp/discourse-snapshot',
    max_turns=30,
)
print(f'Found {len(endpoints)} endpoints')
for ep in endpoints[:20]:
    print(f'  {ep.get(\"method\", \"?\")} {ep.get(\"path\", \"?\")} -> {ep.get(\"file\", \"?\")}:{ep.get(\"line\", \"?\")}')
"
```

### What to check

- Agent should NOT try `read_imports("")` and get stuck on empty results
- Agent SHOULD use `list_files`, `grep`, `read_directory` to explore
- Agent should find `config/routes.rb` and read it
- Agent should find controllers in `app/controllers/`
- Expected: 50+ endpoints (Discourse has hundreds, but with turn limits we won't get all)
- Each endpoint should have file, line, method, path, framework="rails"

### Known failure modes

- **Bulk dump**: agent calls `read_index("")` and gets 5000+ symbols dumped,
  burning context. With pagination (limit=50) this should now page through.
- **Empty data loop**: agent repeatedly tries `read_imports("")` getting empty
  results. The data availability message should prevent this.
- **No exploration tools**: agent has no way to find files without imports/calls.
  Fixed by list_files/grep/read_directory.

## Test 2: Interaction Discovery

```bash
python -c "
from src.ast.interaction_discoverer import discover_interactions
from src.llm.client import create_llm_client

client = create_llm_client('openai', model='gpt-5.4-mini')
interactions = discover_interactions(
    client,
    project_root='/tmp/discourse',
    snapshot_path='/tmp/discourse-snapshot',
    max_turns=30,
)
print(f'Found {len(interactions)} interactions')
for ix in interactions[:20]:
    print(f'  {ix.get(\"target_type\", \"?\")} {ix.get(\"target\", \"?\")} ({ix.get(\"mechanism\", \"?\")})')
"
```

### What to check

- Should find DATABASE interactions (ActiveRecord/PostgreSQL)
- Should find CACHE interactions (Redis)
- Should find MESSAGE_QUEUE interactions (Sidekiq jobs)
- Should find HTTP_SERVICE interactions (if any outbound HTTP)
- Should find EMAIL interactions (ActionMailer)

## Test 3: Token efficiency

Compare token usage before/after pagination:

```bash
# Set OPENAI_LOG=debug or check LLM client logs for token counts
# Before pagination: read_index("") dumps all symbols = massive input tokens
# After pagination: read_index("", limit=50) = bounded input per turn
```

Key metric: total input tokens across all turns should be significantly lower
with pagination. The agent should make more targeted queries instead of fewer
bulk dumps.

## Running the Automated Test Script

The script `scripts/test_discourse.py` builds a ctags snapshot and runs both
endpoint and interaction discovery in one go.

### Prerequisites

- `OPENAI_API_KEY` must be set in your environment
- Clone Discourse locally (shallow clone is fine):
  ```bash
  git clone --depth 1 https://github.com/discourse/discourse.git /tmp/discourse
  ```

### Run with gpt-5.4-mini (default)

```bash
python scripts/test_discourse.py /tmp/discourse
```

### Run with an explicit model

```bash
python scripts/test_discourse.py /tmp/discourse gpt-5.4-mini
```

### What the script does

1. Scans up to 500 `.rb` files (skips vendor/spec/test directories)
2. Runs ctags analysis on those files
3. Writes a structural snapshot (_index.txt, _imports.txt, _calls.txt, _inheritance.txt)
4. Runs endpoint discovery using the specified LLM model
5. Runs interaction discovery using the same model
6. Prints a summary of endpoints and interactions found

### Future improvements

- Assert minimum endpoint/interaction counts
- Assert no single tool result exceeds 100 lines (pagination working)
- Report token usage per turn
