"""ivs's own per-repo files (.haikai/, conversation history, chat logs) must be
in the enforced .gitignore so `git add -A` never commits them into the user's
repo — committing .haikai/config.json then losing it on a branch switch broke
every subsequent orchestrate/repair with "Project config not found".
"""

from src.git.git_manager import GitManager


def test_gitignore_ignores_haikai_internal():
    patterns = GitManager._load_gitignore_patterns()
    assert ".haikai/" in patterns
    assert ".conversation_history.json" in patterns
    assert "chat_logs/" in patterns
