#!/usr/bin/env python
"""
Diagnostic script to verify Claude Code CLI configuration for local containerized environment.
Run this from the project root directory.
"""

import os
import sys
import subprocess
from pathlib import Path


def get_project_root():
    """Get the project root directory."""
    # Assume script is in scripts/local/
    return Path(__file__).parent.parent.parent.absolute()


def check_claude_cli():
    """Check if Claude CLI is installed and accessible."""
    print("1. Checking if Claude CLI is installed...")
    
    # Check in local node_modules first
    project_root = get_project_root()
    local_claude = project_root / "node_modules" / ".bin" / "claude"
    
    if local_claude.exists():
        print(f"   ✓ Claude CLI found at: {local_claude}")
        try:
            version_result = subprocess.run(
                [str(local_claude), "--version"],
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
    
    # Fallback to system PATH
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
            return True
        else:
            print("   ✗ Claude CLI not found")
            print("   Run ./setup-local-env.sh to install it")
            return False
    except Exception as e:
        print(f"   ✗ Error checking Claude CLI: {e}")
        return False


def check_api_key():
    """Check if ANTHROPIC_API_KEY is set."""
    print("\n2. Checking ANTHROPIC_API_KEY environment variable...")
    
    # Check .env.local file
    project_root = get_project_root()
    env_file = project_root / ".env.local"
    
    if env_file.exists():
        print(f"   ✓ .env.local file found at: {env_file}")
        try:
            with open(env_file) as f:
                for line in f:
                    if line.startswith("ANTHROPIC_API_KEY="):
                        key_value = line.split("=", 1)[1].strip()
                        if key_value and not key_value.startswith("your-"):
                            key_preview = f"{key_value[:10]}...{key_value[-4:]}"
                            print(f"   ✓ ANTHROPIC_API_KEY is set in .env.local: {key_preview}")
                            return True
                        else:
                            print("   ⚠ ANTHROPIC_API_KEY is set but appears to be a placeholder")
                            print("   Update .env.local with your actual API key")
                            return False
        except Exception as e:
            print(f"   ⚠ Error reading .env.local: {e}")
    else:
        print(f"   ✗ .env.local file not found")
        print("   Run ./setup-local-env.sh to create it")
        return False
    
    print("   ✗ ANTHROPIC_API_KEY not found in .env.local")
    return False


def check_profiles():
    """Check if Haikai profiles are accessible."""
    print("\n3. Checking Haikai profiles...")
    project_root = get_project_root()
    profiles_dir = project_root / "haikai-profiles"
    
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
    print("\n4. Checking HAIKAI_PROFILES_PATH configuration...")
    project_root = get_project_root()
    expected_path = str(project_root / "haikai-profiles")
    
    # Check .env.local file
    env_file = project_root / ".env.local"
    if env_file.exists():
        try:
            with open(env_file) as f:
                for line in f:
                    if line.startswith("HAIKAI_PROFILES_PATH="):
                        profiles_path = line.split("=", 1)[1].strip()
                        print(f"   ✓ HAIKAI_PROFILES_PATH is set to: {profiles_path}")
                        if profiles_path == expected_path:
                            print(f"   ✓ Path matches expected location")
                        return True
        except Exception as e:
            print(f"   ⚠ Error reading .env.local: {e}")
    
    print("   ✗ HAIKAI_PROFILES_PATH not set in .env.local")
    print(f"   Expected: {expected_path}")
    return False


def check_venv():
    """Check if Python virtual environment exists."""
    print("\n5. Checking Python virtual environment...")
    project_root = get_project_root()
    venv_dir = project_root / ".venv-local"
    
    if venv_dir.exists():
        print(f"   ✓ Virtual environment exists: {venv_dir}")
        
        # Check if it's activated
        if sys.prefix == str(venv_dir):
            print("   ✓ Virtual environment is activated")
        else:
            print("   ⚠ Virtual environment is not activated")
            print("   Run: source .venv-local/bin/activate (Linux/macOS)")
            print("   Or: .venv-local\\Scripts\\activate (Windows)")
        
        return True
    else:
        print(f"   ✗ Virtual environment not found: {venv_dir}")
        print("   Run ./setup-local-env.sh to create it")
        return False


def check_workspace():
    """Check API workspace directory."""
    print("\n6. Checking API workspace directory...")
    project_root = get_project_root()
    workspace_dir = project_root / "api_workspace"
    
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
    print("Local Containerized Environment Check")
    print("=" * 50)
    print()
    
    results = {
        "claude_cli": check_claude_cli(),
        "api_key": check_api_key(),
        "profiles": check_profiles(),
        "profiles_path": check_profiles_path(),
        "venv": check_venv(),
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
        print("\n✓ All checks passed! Local environment is properly configured.")
        return 0
    elif results["claude_cli"] and results["api_key"]:
        print("\n⚠ Basic configuration is OK, but some checks failed.")
        print("  The environment should work, but there may be issues.")
        return 1
    else:
        print("\n✗ Critical configuration issues detected.")
        print("  Run ./setup-local-env.sh to set up the environment.")
        return 2


if __name__ == "__main__":
    sys.exit(main())
