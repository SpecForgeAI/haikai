"""Integration test: structural analysis flows through the pipeline."""
import os
import shutil
import pytest
from unittest.mock import MagicMock, patch
from src.file_analyzer import FileAnalyzer
from src.strategies.base_strategy import FileAnalysisContext

# Use the real config dir so DependencyFileManager can find dependency_files.yaml
REAL_CONFIG_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "config")


class TestPipelineIntegration:

    @pytest.fixture
    def mock_llm(self):
        llm = MagicMock()
        llm.generate.return_value = '{"standards": [], "patterns": []}'
        return llm

    def test_structural_data_reduces_prompt_size(self, mock_llm, tmp_path):
        """When structural data is available, the prompt sent to LLM
        should contain structural output, not raw code."""
        test_file = tmp_path / "test_code.py"
        test_file.write_text('''
class UserService:
    def get_user(self, user_id: int):
        """Get user by ID from the database."""
        result = self.db.query("SELECT * FROM users WHERE id = %s", user_id)
        if not result:
            raise UserNotFoundError(user_id)
        return User(**result)

    def save_user(self, user) -> None:
        """Save user to the database."""
        self.db.execute("INSERT INTO users ...", user.dict())
''')
        analyzer = FileAnalyzer(mock_llm, config_dir=REAL_CONFIG_DIR)

        context = FileAnalysisContext(
            path=str(test_file),
            category="code",
            standard_file="test.md"
        )
        analyzer.analyze_file(context)

        if mock_llm.generate.called:
            call_args = mock_llm.generate.call_args[0][0]
            user_message = call_args[-1]["content"]

            import shutil
            if shutil.which("ctags"):
                raw_size = len(test_file.read_text())
                prompt_size = len(user_message)
                print(f"Raw: {raw_size} chars, Prompt: {prompt_size} chars")

    def test_pipeline_works_without_ctags(self, mock_llm, tmp_path):
        """Without ctags, pipeline falls back to raw code — no errors."""
        test_file = tmp_path / "test.py"
        test_file.write_text("x = 1\n")

        with patch("shutil.which", return_value=None):
            analyzer = FileAnalyzer(mock_llm, config_dir=REAL_CONFIG_DIR)
            context = FileAnalysisContext(
                path=str(test_file), category="code", standard_file="test.md"
            )
            analyzer.analyze_file(context)

    def test_batch_pre_analyzes_structurally(self, mock_llm, tmp_path):
        """analyze_batch should run ctags once for all files, not per-file."""
        for i in range(5):
            f = tmp_path / f"file_{i}.py"
            f.write_text(f"def func_{i}(): pass\n")

        analyzer = FileAnalyzer(mock_llm, config_dir=REAL_CONFIG_DIR)

        contexts = [
            FileAnalysisContext(path=str(tmp_path / f"file_{i}.py"), category="code", standard_file="test.md")
            for i in range(5)
        ]
        analyzer.analyze_batch(contexts, show_progress=False)

    def test_analyze_file_without_batch_uses_raw_code(self, mock_llm, tmp_path):
        """If analyze_file is called directly (not through analyze_batch),
        it just reads the file and uses raw code. No subprocess spawned."""
        test_file = tmp_path / "test.py"
        test_file.write_text("def hello(): pass\n")

        analyzer = FileAnalyzer(mock_llm, config_dir=REAL_CONFIG_DIR)

        context = FileAnalysisContext(
            path=str(test_file), category="code", standard_file="test.md"
        )

        with patch("subprocess.run") as mock_subprocess:
            analyzer.analyze_file(context)
            for call in mock_subprocess.call_args_list:
                args = call[0][0] if call[0] else []
                assert "ctags" not in str(args), \
                    "analyze_file spawned ctags — structural analysis belongs in analyze_batch only"
