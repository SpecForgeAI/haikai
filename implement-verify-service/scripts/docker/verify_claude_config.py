#!/usr/bin/env python
"""
Diagnostic script to verify Claude Code CLI configuration.
Can be run from inside the Docker container or locally.
"""

import os
import sys
import subprocess
from pathlib import Path


def check_claude_cli():
    """Check if Claude CLI is installed and accessible."""
    print("1. Checking if Claude CLI is installed...")
    try:
        result = subprocess.run(
            ["which", "claude"],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            claude_path = result.stdout.strip()
            print(f"   ✓ Claude CLI found at: {claude_path}")
            
            # Try to get version
            try:
                version_result = subprocess.run(
                    ["claude", "--version"],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                if version_result.returncode == 0:
                    print(f"   ✓ Version: {version_result.stdout.strip()}")
                else:
                    print(f"   ⚠ Could not get version: {version_result.stderr.strip()}")
            except Exception as e:
                print(f"   ⚠ Error getting version: {e}")
            
            return True
        else:
            print("   ✗ Claude CLI not found in PATH")
            return False
    except Exception as e:
        print(f"   ✗ Error checking Claude CLI: {e}")
        return False


def check_api_key():
    """Check if ANTHROPIC_API_KEY is set."""
    print("\n2. Checking ANTHROPIC_API_KEY environment variable...")
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if api_key:
        # Show only first 10 and last 4 characters for security
        key_preview = f"{api_key[:10]}...{api_key[-4:]}"
        print(f"   ✓ ANTHROPIC_API_KEY is set: {key_preview}")
        return True
    else:
        print("   ✗ ANTHROPIC_API_KEY is not set")
        return False


def check_profiles():
    """Check if Haikai profiles are accessible."""
    print("\n3. Checking Haikai profiles...")
    profiles_dir = Path("/app/haikai-profiles")
    
    if profiles_dir.exists():
        print(f"   ✓ Profiles directory exists: {profiles_dir}")
        
        # List profiles
        try:
            profiles = [p.name for p in profiles_dir.iterdir() if p.is_dir()]
            print(f"   Available profiles: {', '.join(profiles)}")
        except Exception as e:
            print(f"   ⚠ Could not list profiles: {e}")
        
        # Check default profile
        default_profile = profiles_dir / "default"
        if default_profile.exists():
            print("   ✓ Default profile found")
            
            # Check commands
            commands_dir = default_profile / "commands"
            if commands_dir.exists():
                try:
                    commands = [c.name for c in commands_dir.iterdir() if c.is_dir()]
                    print(f"   Available commands: {', '.join(commands[:5])}")
                    if len(commands) > 5:
                        print(f"   ... and {len(commands) - 5} more")
                except Exception as e:
                    print(f"   ⚠ Could not list commands: {e}")
            else:
                print("   ✗ Commands directory not found")
        else:
            print("   ✗ Default profile not found")
        
        return True
    else:
        print(f"   ✗ Profiles directory not found: {profiles_dir}")
        return False


def check_profiles_path():
    """Check HAIKAI_PROFILES_PATH environment variable."""
    print("\n4. Checking HAIKAI_PROFILES_PATH environment variable...")
    profiles_path = os.getenv("HAIKAI_PROFILES_PATH")
    if profiles_path:
        print(f"   ✓ HAIKAI_PROFILES_PATH is set to: {profiles_path}")
        return True
    else:
        print("   ✗ HAIKAI_PROFILES_PATH is not set")
        print("   Claude will use default location: ~/.config/claude-code/profiles")
        return False


def test_claude_command():
    """Try to run a simple Claude CLI command."""
    print("\n5. Testing Claude CLI with a simple command...")
    try:
        result = subprocess.run(
            ["claude", "--help"],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0:
            print("   ✓ Claude CLI --help works")
            # Show first few lines of help
            help_lines = result.stdout.split('\n')[:10]
            for line in help_lines:
                if line.strip():
                    print(f"      {line}")
            return True
        else:
            print(f"   ✗ Claude CLI --help failed: {result.stderr}")
            return False
    except subprocess.TimeoutExpired:
        print("   ✗ Command timed out")
        return False
    except Exception as e:
        print(f"   ✗ Error running command: {e}")
        return False


def check_workspace():
    """Check API workspace directory."""
    print("\n6. Checking API workspace directory...")
    workspace_dir = Path(os.getenv("API_WORKSPACE_DIR", "/app/api_workspace"))
    
    if workspace_dir.exists():
        print(f"   ✓ Workspace directory exists: {workspace_dir}")
        try:
            contents = list(workspace_dir.iterdir())
            if contents:
                print(f"   Contents ({len(contents)} items):")
                for item in contents[:5]:
                    print(f"      - {item.name}")
                if len(contents) > 5:
                    print(f"      ... and {len(contents) - 5} more")
            else:
                print("   (Directory is empty)")
        except Exception as e:
            print(f"   ⚠ Could not list contents: {e}")
        return True
    else:
        print(f"   ⚠ Workspace directory does not exist: {workspace_dir}")
        print("   (This is normal if no operations have been run yet)")
        return False


def main():
    """Run all diagnostic checks."""
    print("=" * 50)
    print("Claude Code CLI Configuration Check")
    print("=" * 50)
    print()
    
    results = {
        "claude_cli": check_claude_cli(),
        "api_key": check_api_key(),
        "profiles": check_profiles(),
        "profiles_path": check_profiles_path(),
        "cli_test": test_claude_command(),
        "workspace": check_workspace()
    }
    
    print()
    print("=" * 50)
    print("Configuration Check Summary")
    print("=" * 50)
    
    passed = sum(results.values())
    total = len(results)
    
    for check, status in results.items():
        status_icon = "✓" if status else "✗"
        print(f"{status_icon} {check.replace('_', ' ').title()}")
    
    print()
    print(f"Passed: {passed}/{total} checks")
    
    if passed == total:
        print("\n✓ All checks passed! Claude Code is properly configured.")
        return 0
    elif results["claude_cli"] and results["api_key"]:
        print("\n⚠ Basic configuration is OK, but some checks failed.")
        print("  Claude Code should work, but there may be issues.")
        return 1
    else:
        print("\n✗ Critical configuration issues detected.")
        print("  Claude Code may not work properly.")
        return 2


if __name__ == "__main__":
    sys.exit(main())
