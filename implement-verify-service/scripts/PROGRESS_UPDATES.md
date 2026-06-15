# Periodic Progress Updates

Automatic Slack progress updates based on conversation activity.

## Overview

The `progress_updates.py` script monitors Slack conversations and posts periodic progress summaries. It handles rate limits gracefully and can run via cron or OpenClaw cron jobs.

## Features

- ✅ Monitors recent Slack messages (last hour)
- ✅ Identifies progress indicators (complete, done, success, etc.)
- ✅ Identifies blockers (error, failed, issue, rate limit, etc.)
- ✅ Posts concise summaries to Slack
- ✅ Handles rate limits (pauses & retries later)
- ✅ Maintains state to avoid duplicate updates
- ✅ Works with or without `requests` library (curl fallback)

## Setup

### Environment Variables

```bash
export SLACK_BOT_TOKEN="xoxb-your-bot-token"
export SLACK_CHANNEL="C0ABW4GCR8E"  # Optional, defaults to #general
```

### Manual Run

```bash
# Run once (respects 1-hour minimum)
python scripts/progress_updates.py

# Force update now
python scripts/progress_updates.py --force

# Custom channel
python scripts/progress_updates.py --channel C1234567890
```

### Cron Setup (Traditional)

```bash
# Run every hour
0 * * * * cd /path/to/standards-extractor && python scripts/progress_updates.py
```

### OpenClaw Cron Setup

Add to gateway config `jobs` array:

```json
{
  "name": "slack-progress-updates",
  "schedule": {
    "kind": "every",
    "everyMs": 3600000
  },
  "payload": {
    "kind": "agentTurn",
    "message": "Run progress update: cd /app && python scripts/progress_updates.py"
  },
  "sessionTarget": "isolated",
  "enabled": true
}
```

Or use wake event from agent:

```
/wake Run Slack progress update via cron
```

Then configure cron job to execute the script.

## How It Works

1. **Check State** - Loads last update timestamp from `progress_state.json`
2. **Time Check** - Skips if updated within last hour (unless forced)
3. **Fetch Messages** - Gets last hour of Slack messages via API
4. **Analyze** - Counts progress/blocker keywords in recent messages
5. **Summarize** - Builds concise update message
6. **Post** - Sends update to Slack
7. **Save State** - Records update timestamp

## Rate Limit Handling

If rate limited:
- Script prints warning and exits gracefully
- State is NOT updated (will retry next run)
- Next cron run will try again
- No errors thrown - continues automatically

## State File

`progress_state.json` stores:
```json
{
  "last_update": 1234567890.0,
  "last_message_ts": 1234567890.0
}
```

## Output Example

**Periodic Progress Update**

📊 Activity: 15 messages in last hour  
✅ Progress: 3 items  
⚠️ Blockers: 1 item

**Recent Progress:**
• optimization test complete - early-exit wins with 32% speedup
• feature branch created and pushed
• docker containers all healthy

**Blockers/Issues:**
• rate limit hit during testing

## Troubleshooting

### No Updates Posted

Check:
1. SLACK_BOT_TOKEN is set and valid
2. Bot has `chat:write` and `channels:history` permissions
3. Bot is in the channel
4. Last update was >1 hour ago (or use `--force`)

### Rate Limited

- Wait 1 minute and try again
- Script will automatically retry on next cron run
- Use `--force` to retry immediately after rate limit clears

### Curl Fallback

If `requests` is not installed, script uses curl. Ensure curl is available:
```bash
which curl  # Should show path
```

## Integration with Main Workflow

This script is designed to run autonomously:
- Commit to main branch
- Push triggers GHCR build
- Deploy container with cron enabled
- Updates run hourly automatically
- Rate limits handled gracefully
- No manual intervention needed

## Deployment

```bash
# Commit to main
git add scripts/progress_updates.py scripts/PROGRESS_UPDATES.md
git commit -m "feat: Add periodic Slack progress updates with rate limit handling"
git push origin main

# GHCR image rebuilds automatically
# Deploy with cron enabled
docker run -e SLACK_BOT_TOKEN=... -e SLACK_CHANNEL=... ghcr.io/specforgeai/standards-extractor:latest
```
