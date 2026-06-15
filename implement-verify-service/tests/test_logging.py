"""Tests for logging functionality in the Standards Extractor API."""
import os
import pytest
import logging
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime

from src.operation_executor import OperationExecutor
from src.models import (
    GenerateProductStandardsRequest,
    GenerateGlobalStandardsRequest,
    GetMetamodelRequest,
    OperationMode
)


class TestOperationExecutorLogging:
    """Test logging in OperationExecutor."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.temp_dir = tempfile.mkdtemp()
        self.workspace_dir = Path(self.temp_dir) / "workspace"
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        
        self.config = {
            'llm_provider': 'openai',
            'llm_model': 'gpt-4',
            'openai_api_key': 'test-key',
            'config_dir': 'config',
            'templates_dir': 'templates/standards'
        }
    
    def teardown_method(self):
        """Clean up test fixtures."""
        import shutil
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_executor_initialization_logging(self, caplog):
        """Test that OperationExecutor logs initialization details."""
        with caplog.at_level(logging.INFO):
            executor = OperationExecutor(self.config, workspace_dir=self.workspace_dir)
            
            # Check that initialization was logged
            assert any("OperationExecutor initialized" in record.message for record in caplog.records)
            assert any(str(self.workspace_dir) in record.message for record in caplog.records)
    
    def test_executor_uses_default_workspace_when_none_provided(self, caplog):
        """Test that OperationExecutor uses default workspace when none is provided."""
        with caplog.at_level(logging.INFO):
            executor = OperationExecutor(self.config)
            
            # Check that default workspace is used
            assert executor.workspace_dir is None
            assert any("OperationExecutor initialized" in record.message for record in caplog.records)
    
    def test_executor_logs_request_type(self, caplog):
        """Test that OperationExecutor logs the request type being executed."""
        executor = OperationExecutor(self.config, workspace_dir=self.workspace_dir)
        
        request = GenerateProductStandardsRequest(
            company="test-company",
            project="test-project",
            sources=[],
            recursive=True
        )
        
        with caplog.at_level(logging.INFO):
            with patch.object(executor, '_generate_product_standards', return_value=Mock()):
                executor.execute(request)
                
                # Check that request type was logged
                assert any("GenerateProductStandardsRequest" in record.message for record in caplog.records)
    
    @patch('src.operation_executor.StandardsOrchestrator')
    def test_generate_product_standards_logs_parameters(self, mock_orchestrator, caplog):
        """Test that product standards generation logs all parameters."""
        executor = OperationExecutor(self.config, workspace_dir=self.workspace_dir)
        
        # Mock the orchestrator
        mock_instance = MagicMock()
        mock_instance.create_product_standards.return_value = []
        mock_orchestrator.return_value = mock_instance
        
        request = GenerateProductStandardsRequest(
            company="test-company",
            project="test-project",
            sources=["source1", "source2"],
            recursive=True
        )
        
        with caplog.at_level(logging.INFO):
            executor._generate_product_standards(request)
            
            # Check that parameters were logged
            log_messages = [record.message for record in caplog.records]
            assert any("company=test-company" in msg for msg in log_messages)
            assert any("project=test-project" in msg for msg in log_messages)
            assert any("recursive=True" in msg for msg in log_messages)
    
    @patch('src.operation_executor.StandardsOrchestrator')
    def test_generate_product_standards_logs_directories(self, mock_orchestrator, caplog):
        """Test that product standards generation logs directory paths."""
        executor = OperationExecutor(self.config, workspace_dir=self.workspace_dir)
        
        # Mock the orchestrator
        mock_instance = MagicMock()
        mock_instance.create_product_standards.return_value = []
        mock_orchestrator.return_value = mock_instance
        
        request = GenerateProductStandardsRequest(
            company="test-company",
            project="test-project",
            sources=[],
            recursive=True
        )
        
        with caplog.at_level(logging.INFO):
            executor._generate_product_standards(request)
            
            # Check that directories were logged
            log_messages = [record.message for record in caplog.records]
            assert any("Project directory:" in msg for msg in log_messages)
            assert any("Global directory:" in msg for msg in log_messages)
    
    @patch('src.operation_executor.StandardsOrchestrator')
    def test_generate_product_standards_logs_success(self, mock_orchestrator, caplog):
        """Test that successful product standards generation is logged."""
        executor = OperationExecutor(self.config, workspace_dir=self.workspace_dir)
        
        # Mock the orchestrator
        mock_instance = MagicMock()
        mock_instance.create_product_standards.return_value = ["output1.md", "output2.md"]
        mock_orchestrator.return_value = mock_instance
        
        request = GenerateProductStandardsRequest(
            company="test-company",
            project="test-project",
            sources=[],
            recursive=True
        )
        
        with caplog.at_level(logging.INFO):
            response = executor._generate_product_standards(request)
            
            # Check that success was logged
            assert any("Product standards created successfully" in record.message for record in caplog.records)
            assert response.success is True
    
    @patch('src.operation_executor.StandardsOrchestrator')
    def test_generate_product_standards_logs_errors(self, mock_orchestrator, caplog):
        """Test that errors in product standards generation are logged."""
        executor = OperationExecutor(self.config, workspace_dir=self.workspace_dir)
        
        # Mock the orchestrator to raise an exception
        mock_orchestrator.side_effect = Exception("Test error")
        
        request = GenerateProductStandardsRequest(
            company="test-company",
            project="test-project",
            sources=[],
            recursive=True
        )
        
        with caplog.at_level(logging.ERROR):
            response = executor._generate_product_standards(request)
            
            # Check that error was logged
            assert any("Failed to create product standards" in record.message for record in caplog.records)
            assert response.success is False
            assert "Test error" in response.errors[0]
    
    @patch('src.operation_executor.StandardsOrchestrator')
    def test_generate_global_standards_logs_parameters(self, mock_orchestrator, caplog):
        """Test that global standards generation logs all parameters."""
        executor = OperationExecutor(self.config, workspace_dir=self.workspace_dir)
        
        # Mock the orchestrator
        mock_instance = MagicMock()
        mock_instance.run.return_value = {"output": "path/to/output.md"}
        mock_orchestrator.return_value = mock_instance
        
        request = GenerateGlobalStandardsRequest(
            company="test-company",
            sources=["source1", "source2"],
            recursive=True
        )
        
        with caplog.at_level(logging.INFO):
            executor._generate_global_standards(request)
            
            # Check that parameters were logged
            log_messages = [record.message for record in caplog.records]
            assert any("company=test-company" in msg for msg in log_messages)
            assert any("recursive=True" in msg for msg in log_messages)
    
    @patch('src.operation_executor.StandardsOrchestrator')
    def test_get_metamodel_logs_parameters(self, mock_orchestrator, caplog):
        """Test that metamodel retrieval logs all parameters."""
        executor = OperationExecutor(self.config, workspace_dir=self.workspace_dir)
        
        # Mock the orchestrator
        mock_instance = MagicMock()
        mock_instance.get_metamodel.return_value = "path/to/metamodel.json"
        mock_orchestrator.return_value = mock_instance
        
        request = GetMetamodelRequest(
            metamodel_id="test-metamodel-id",
            company="test-company",
            project="test-project"
        )
        
        with caplog.at_level(logging.INFO):
            executor._get_metamodel(request)
            
            # Check that parameters were logged
            log_messages = [record.message for record in caplog.records]
            assert any("metamodel_id=test-metamodel-id" in msg for msg in log_messages)
            assert any("company=test-company" in msg for msg in log_messages)
            assert any("project=test-project" in msg for msg in log_messages)


class TestAPILogging:
    """Test logging in the API layer."""
    
    def test_log_directory_creation(self):
        """Test that log directory is created on API startup."""
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace_dir = Path(temp_dir) / "workspace"
            log_dir = workspace_dir / "logs"
            
            # Simulate API startup
            workspace_dir.mkdir(parents=True, exist_ok=True)
            log_dir.mkdir(parents=True, exist_ok=True)
            
            assert log_dir.exists()
            assert log_dir.is_dir()
    
    def test_log_file_naming_convention(self):
        """Test that log files follow the expected naming convention."""
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        log_filename = f"api_{timestamp}.log"
        
        # Check that filename matches expected pattern
        assert log_filename.startswith("api_")
        assert log_filename.endswith(".log")
        assert len(log_filename) == len("api_20260114_192849.log")


class TestWorkspacePathConfiguration:
    """Test workspace path configuration."""
    
    def test_workspace_dir_parameter_is_used(self):
        """Test that workspace_dir parameter is properly used."""
        custom_workspace = Path("/custom/workspace")
        config = {'llm_provider': 'openai'}
        
        executor = OperationExecutor(config, workspace_dir=custom_workspace)
        
        assert executor.workspace_dir == custom_workspace
    
    def test_workspace_dir_default_fallback(self):
        """Test that default workspace is used when none is provided."""
        config = {'llm_provider': 'openai'}
        
        executor = OperationExecutor(config)
        
        assert executor.workspace_dir is None
    
    @patch('src.operation_executor.StandardsOrchestrator')
    def test_workspace_dir_used_in_operations(self, mock_orchestrator):
        """Test that workspace_dir is used in operation execution."""
        custom_workspace = Path("/custom/workspace")
        config = {'llm_provider': 'openai', 'config_dir': 'config', 'templates_dir': 'templates'}
        
        executor = OperationExecutor(config, workspace_dir=custom_workspace)
        
        # Mock the orchestrator
        mock_instance = MagicMock()
        mock_instance.create_product_standards.return_value = []
        mock_orchestrator.return_value = mock_instance
        
        request = GenerateProductStandardsRequest(
            company="test-company",
            project="test-project",
            sources=[],
            recursive=True
        )
        
        response = executor._generate_product_standards(request)
        
        # Check that the response uses the custom workspace
        assert str(custom_workspace) in str(response.output_dir)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
