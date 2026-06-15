#!/usr/bin/env python3
"""
Periodic progress update script for Slack.

Monitors recent Slack conversations, identifies ongoing work,
and posts periodic status updates. Handles rate limits gracefully.

Usage:
    python scripts/progress_updates.py [--channel CHANNEL_ID]
    
Can be run via cron or OpenClaw cron job.
"""

import os
import sys
import json
import time
from datetime import datetime, timedelta
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False
    print("Warning: requests not available, using curl fallback")


class ProgressUpdater:
    """Monitors Slack and posts periodic progress updates."""
    
    def __init__(self, slack_token=None, channel_id=None):
        """
        Initialize updater.
        
        Args:
            slack_token: Slack bot token (defaults to SLACK_BOT_TOKEN env var)
            channel_id: Channel to monitor (defaults to SLACK_CHANNEL env var)
        """
        self.slack_token = slack_token or os.getenv('SLACK_BOT_TOKEN')
        self.channel_id = channel_id or os.getenv('SLACK_CHANNEL', 'C0ABW4GCR8E')
        self.state_file = Path(__file__).parent.parent / 'progress_state.json'
        
        if not self.slack_token:
            raise ValueError("SLACK_BOT_TOKEN not set")
    
    def load_state(self):
        """Load last update timestamp."""
        if self.state_file.exists():
            try:
                data = json.loads(self.state_file.read_text())
                return data
            except:
                pass
        return {'last_update': 0, 'last_message_ts': 0}
    
    def save_state(self, state):
        """Save update state."""
        self.state_file.write_text(json.dumps(state, indent=2))
    
    def get_recent_messages(self, hours=1):
        """
        Get recent Slack messages.
        
        Args:
            hours: How many hours back to look
            
        Returns:
            List of message dicts or None on error
        """
        oldest = (datetime.now() - timedelta(hours=hours)).timestamp()
        
        url = 'https://slack.com/api/conversations.history'
        headers = {
            'Authorization': f'Bearer {self.slack_token}',
            'Content-Type': 'application/json'
        }
        params = {
            'channel': self.channel_id,
            'oldest': oldest,
            'limit': 100
        }
        
        try:
            if HAS_REQUESTS:
                response = requests.get(url, headers=headers, params=params, timeout=30)
                data = response.json()
            else:
                # Fallback to curl
                import subprocess
                cmd = [
                    'curl', '-s',
                    '-H', f'Authorization: Bearer {self.slack_token}',
                    f'{url}?channel={self.channel_id}&oldest={oldest}&limit=100'
                ]
                result = subprocess.run(cmd, capture_output=True, text=True)
                data = json.loads(result.stdout)
            
            if data.get('ok'):
                return data.get('messages', [])
            elif data.get('error') == 'rate_limited':
                print(f"Rate limited, will retry later")
                return None
            else:
                print(f"Error fetching messages: {data.get('error')}")
                return None
                
        except Exception as e:
            print(f"Exception fetching messages: {e}")
            return None
    
    def analyze_progress(self, messages):
        """
        Analyze messages to identify progress/blockers.
        
        Args:
            messages: List of Slack message dicts
            
        Returns:
            Dict with progress summary
        """
        if not messages:
            return None
        
        # Simple keyword analysis
        keywords = {
            'progress': ['complete', 'done', 'finished', 'success', 'working', 'running'],
            'blockers': ['blocked', 'error', 'failed', 'issue', 'problem', 'rate limit'],
            'questions': ['?', 'how', 'what', 'when', 'why'],
        }
        
        progress_items = []
        blocker_items = []
        
        for msg in messages[:20]:  # Last 20 messages
            text = msg.get('text', '').lower()
            
            # Skip bot messages
            if msg.get('bot_id'):
                continue
            
            # Check for progress indicators
            if any(kw in text for kw in keywords['progress']):
                progress_items.append(text[:100])
            
            # Check for blockers
            if any(kw in text for kw in keywords['blockers']):
                blocker_items.append(text[:100])
        
        return {
            'message_count': len(messages),
            'progress_indicators': len(progress_items),
            'blocker_indicators': len(blocker_items),
            'recent_progress': progress_items[:3],
            'recent_blockers': blocker_items[:3],
        }
    
    def post_update(self, summary):
        """
        Post progress update to Slack.
        
        Args:
            summary: Progress summary dict
            
        Returns:
            True if posted successfully
        """
        if not summary or summary['message_count'] == 0:
            print("No activity, skipping update")
            return True
        
        # Build update message
        lines = ["**Periodic Progress Update**\n"]
        lines.append(f"📊 Activity: {summary['message_count']} messages in last hour")
        
        if summary['progress_indicators'] > 0:
            lines.append(f"✅ Progress: {summary['progress_indicators']} items")
        
        if summary['blocker_indicators'] > 0:
            lines.append(f"⚠️ Blockers: {summary['blocker_indicators']} items")
        
        if summary.get('recent_progress'):
            lines.append("\n**Recent Progress:**")
            for item in summary['recent_progress']:
                lines.append(f"• {item}")
        
        if summary.get('recent_blockers'):
            lines.append("\n**Blockers/Issues:**")
            for item in summary['recent_blockers']:
                lines.append(f"• {item}")
        
        message = "\n".join(lines)
        
        # Post to Slack
        url = 'https://slack.com/api/chat.postMessage'
        headers = {
            'Authorization': f'Bearer {self.slack_token}',
            'Content-Type': 'application/json'
        }
        payload = {
            'channel': self.channel_id,
            'text': message
        }
        
        try:
            if HAS_REQUESTS:
                response = requests.post(url, headers=headers, json=payload, timeout=30)
                data = response.json()
            else:
                # Fallback to curl
                import subprocess
                cmd = [
                    'curl', '-s', '-X', 'POST',
                    '-H', f'Authorization: Bearer {self.slack_token}',
                    '-H', 'Content-Type: application/json',
                    '-d', json.dumps(payload),
                    url
                ]
                result = subprocess.run(cmd, capture_output=True, text=True)
                data = json.loads(result.stdout)
            
            if data.get('ok'):
                print(f"Posted update successfully")
                return True
            elif data.get('error') == 'rate_limited':
                print(f"Rate limited posting update, will retry later")
                return False
            else:
                print(f"Error posting update: {data.get('error')}")
                return False
                
        except Exception as e:
            print(f"Exception posting update: {e}")
            return False
    
    def run(self, force=False):
        """
        Run periodic update check.
        
        Args:
            force: Force update even if recently updated
            
        Returns:
            True if update completed
        """
        state = self.load_state()
        now = time.time()
        
        # Check if enough time passed (1 hour by default)
        time_since_last = now - state['last_update']
        if not force and time_since_last < 3600:
            print(f"Last update was {int(time_since_last/60)} minutes ago, skipping")
            return True
        
        print(f"Checking for progress updates...")
        
        # Get recent messages
        messages = self.get_recent_messages(hours=1)
        if messages is None:
            # Rate limited or error, but don't fail - will retry later
            print("Could not fetch messages, will retry next time")
            return False
        
        # Analyze progress
        summary = self.analyze_progress(messages)
        
        # Post update
        if summary and summary['message_count'] > 0:
            posted = self.post_update(summary)
            if posted:
                state['last_update'] = now
                self.save_state(state)
                return True
            else:
                print("Failed to post update, will retry later")
                return False
        else:
            print("No activity to report")
            state['last_update'] = now
            self.save_state(state)
            return True


def main():
    """Main entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Post periodic Slack progress updates')
    parser.add_argument('--channel', help='Slack channel ID', default=None)
    parser.add_argument('--force', action='store_true', help='Force update even if recent')
    
    args = parser.parse_args()
    
    try:
        updater = ProgressUpdater(channel_id=args.channel)
        success = updater.run(force=args.force)
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)


if __name__ == '__main__':
    main()
