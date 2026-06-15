# Test Coverage: Tree-sitter Language Expansion

**Date:** 2026-03-31
**Total tests:** 753
**Branch:** `feature/treesitter-language-expansion-2026-03-31`

---

## Coverage Summary

| Category | Tests | % |
|----------|------:|--:|
| Integration tests (real data) | 465 | 61.8% |
| Unit tests covered by integration | 142 | 18.9% |
| Resilience scenarios (functional) | 3 | 0.4% |
| Unit tests (synthetic only) | 142 | 18.9% |
| **Total** | **753** | **100%** |

**Real-data backing: 610 / 753 (81.0%)** — only 142 tests are purely synthetic with no integration coverage.

---

## Integration Test Files

| File | Tests | Real Data |
|------|------:|-----------|
| `tests/ast/test_c_extraction.py` | 13 | src.ast.extractors.c |
| `tests/ast/test_call_graph.py` | 9 | src.ast.models, src.ast.store, src.ast.provider |
| `tests/ast/test_cpp_extraction.py` | 14 | src.ast.extractors.cpp |
| `tests/ast/test_csharp_extraction.py` | 13 | src.ast.extractors.csharp |
| `tests/ast/test_ctags_provider.py` | 16 | src.ast.ctags_provider, src.ast.models |
| `tests/ast/test_diagram_builders.py` | 10 | src.ast.diagram_builders |
| `tests/ast/test_diagram_integration.py` | 35 | src.ast.ctags_provider, src.ast.treesitter_provider, src.ast.provider |
| `tests/ast/test_go_extraction.py` | 17 | src.ast.extractors.go, src.ast.extractors.base, src.ast.treesitter_provider |
| `tests/ast/test_graphviz_serialiser.py` | 4 | src.ast.diagram_model, src.ast.graphviz_serialiser |
| `tests/ast/test_java_extraction.py` | 12 | src.ast.extractors.java |
| `tests/ast/test_kind_mapping_loader.py` | 12 | src.ast.models, src.ast.kind_mapping_loader |
| `tests/ast/test_mermaid_serialiser.py` | 5 | src.ast.diagram_model, src.ast.mermaid_serialiser |
| `tests/ast/test_metamodel_engine.py` | 8 | src.ast.kind_mapping_loader, src.ast.metamodel_engine, src.ast.models |
| `tests/ast/test_metamodel_serialiser.py` | 7 | src.ast.diagram_model, src.ast.metamodel_serialiser |
| `tests/ast/test_multi_language_integration.py` | 9 | src.ast.treesitter_provider |
| `tests/ast/test_multi_language_regression.py` | 13 | src.ast.treesitter_provider, src.ast.treesitter_models, src.ast.treesitter_resolver |
| `tests/ast/test_pipeline_integration.py` | 4 | src.file_analyzer, src.strategies.base_strategy |
| `tests/ast/test_plantuml_serialiser.py` | 4 | src.ast.diagram_model, src.ast.plantuml_serialiser |
| `tests/ast/test_resilience.py` | 8 | src.ast.treesitter_provider, src.ast.extractors.python, src.ast.treesitter_resolver |
| `tests/ast/test_rust_extraction.py` | 14 | src.ast.extractors.rust |
| `tests/ast/test_serialiser_loader.py` | 12 | src.ast.kind_mapping_loader, src.ast.serialiser_loader |
| `tests/ast/test_store.py` | 27 | src.ast.models, src.ast.store |
| `tests/ast/test_structural_diff.py` | 8 | src.ast.models, src.ast.store, src.ast.structural_diff |
| `tests/ast/test_treesitter_extraction.py` | 5 | src.ast.extractors.python, src.ast.treesitter_resolver, src.ast.treesitter_models |
| `tests/ast/test_treesitter_integration.py` | 19 | src.ast.treesitter_provider, src.ast.extractors.python, src.ast.ctags_provider |
| `tests/ast/test_typescript_extraction.py` | 21 | src.ast.extractors.typescript, src.ast.extractors.base, src.ast.treesitter_provider |
| `tests/skills/test_coverage/test_report.py` | 16 | src.skills.test_coverage.discovery, src.skills.test_coverage.classifier, src.skills.test_coverage.mapper |
| `tests/test_api_logging_integration.py` | 10 | src.api |
| `tests/test_file_scanner.py` | 18 | src.file_scanner, src.categories |
| `tests/test_git_commit_preparation_integration.py` | 10 | src.git.git_manager, src.git.git_manager, src.git.git_manager |
| `tests/test_job_queue.py` | 7 | src.job_queue.job_queue, src.job_queue.job_models |
| `tests/test_job_recovery.py` | 11 | src.job_queue.job_queue, src.job_queue.job_models, src.job_queue.job_storage |
| `tests/test_tech_doc_integration.py` | 11 | src.categories, src.strategies.base_strategy, src.standards_orchestrator |
| `tests/test_technical_doc_strategy.py` | 10 | src.strategies.technical_doc_strategy, src.strategies.base_strategy |
| `tests/test_tool_executor.py` | 53 | src.chat.tool_executor |

---

## Unit Test Files + Integration Coverage

| File | Unit | Covered by Integration | Gap |
|------|-----:|----------------------:|----:|
| `tests/api/test_structural_endpoints.py` | 11 | 7 | 4 |
| `tests/ast/test_diagram_generator.py` | 2 | 0 | 2 |
| `tests/ast/test_diagram_model.py` | 1 | 0 | 1 |
| `tests/ast/test_formatter.py` | 4 | 3 | 1 |
| `tests/ast/test_models.py` | 6 | 5 | 1 |
| `tests/ast/test_provider.py` | 6 | 4 | 2 |
| `tests/ast/test_token_reduction.py` | 2 | 2 | 0 |
| `tests/chunking/test_ast_chunker.py` | 8 | 8 | 0 |
| `tests/skills/test_coverage/test_classifier.py` | 8 | 7 | 1 |
| `tests/skills/test_coverage/test_discovery.py` | 10 | 9 | 1 |
| `tests/test_haikai_orchestrator.py` | 21 | 13 | 8 |
| `tests/test_content_extractor.py` | 11 | 0 | 11 |
| `tests/test_file_analyzer.py` | 20 | 17 | 3 |
| `tests/test_file_analyzer_strategies.py` | 15 | 10 | 5 |
| `tests/test_file_parser.py` | 19 | 0 | 19 |
| `tests/test_git_commit_preparation.py` | 6 | 4 | 2 |
| `tests/test_git_commit_preparation_orchestrator.py` | 4 | 4 | 0 |
| `tests/test_git_manager.py` | 15 | 11 | 4 |
| `tests/test_git_v2_endpoints.py` | 24 | 19 | 5 |
| `tests/test_logging.py` | 14 | 0 | 14 |
| `tests/test_oauth_llm_client.py` | 13 | 13 | 0 |
| `tests/test_orchestrator.py` | 8 | 6 | 2 |
| `tests/test_plan_product_sse.py` | 11 | 0 | 11 |
| `tests/test_retry_flow.py` | 1 | 0 | 1 |
| `tests/test_session_persistence.py` | 12 | 0 | 12 |
| `tests/test_shapespec_sse_askquestions.py` | 17 | 0 | 17 |
| `tests/test_technical_doc_manager.py` | 15 | 0 | 15 |
| **Totals** | **284** | **142** | **142** |

---

## Uncovered Tests — Classification

### Edge Cases (35 tests)

These test defensive paths that cannot trigger on real data:

- `TestAnalyzeEndpoint.test_returns_400_for_missing_path` (tests/api/test_structural_endpoints.py) — Tests edge case: missing data handling
- `TestDiagramGeneratorEdgeCases.test_empty_snapshot_no_crash` (tests/ast/test_diagram_generator.py) — Tests edge case: empty input handling
- `TestDiagramModelEdgeCases.test_model_empty_defaults` (tests/ast/test_diagram_model.py) — Tests edge case: empty input handling
- `TestFormatter.test_format_empty` (tests/ast/test_formatter.py) — Tests edge case: empty input handling
- `test_registry_returns_empty_when_no_providers` (tests/ast/test_provider.py) — Tests edge case: empty input handling
- `TestClassifierReal.test_no_empty_category` (tests/skills/test_coverage/test_classifier.py) — Tests edge case: empty input handling
- `TestDiscoveryReal.test_handles_nonexistent_directory` (tests/skills/test_coverage/test_discovery.py) — Tests edge case: None/null value handling
- `TestOrchestrationModels.test_orchestration_request_invalid_empty_intents` (tests/test_haikai_orchestrator.py) — Tests edge case: empty input handling
- `TestHaikaiOrchestrator.test_missing_spec_folder_fails` (tests/test_haikai_orchestrator.py) — Tests edge case: missing data handling
- `TestHaikaiOrchestrator.test_missing_requirements_file_fails` (tests/test_haikai_orchestrator.py) — Tests edge case: missing data handling
- `TestHaikaiOrchestrator.test_missing_initialization_file_fails` (tests/test_haikai_orchestrator.py) — Tests edge case: missing data handling
- `TestFileAnalysisContext.test_context_validation_missing_path` (tests/test_file_analyzer_strategies.py) — Tests edge case: missing data handling
- `TestFileAnalysisContext.test_context_validation_missing_category` (tests/test_file_analyzer_strategies.py) — Tests edge case: missing data handling
- `TestFileAnalysisContext.test_context_validation_missing_standard_file` (tests/test_file_analyzer_strategies.py) — Tests edge case: missing data handling
- `TestCodeAnalysisStrategy.test_get_metadata_with_empty_content` (tests/test_file_analyzer_strategies.py) — Tests edge case: empty input handling
- `TestAnalysisStrategyInterface.test_base_strategy_cannot_be_instantiated_directly` (tests/test_file_analyzer_strategies.py) — Resilience/defensive test — cannot trigger on healthy real data
- `TestFileParser.test_parse_nonexistent_file` (tests/test_file_parser.py) — Tests edge case: None/null value handling
- `TestPrepareForCommit.test_creates_gitignore_when_missing` (tests/test_git_commit_preparation.py) — Tests edge case: missing data handling
- `TestGitConfig.test_load_git_config_missing_provider` (tests/test_git_manager.py) — Tests edge case: missing data handling
- `TestGitConfig.test_load_git_config_missing_github_token` (tests/test_git_manager.py) — Tests edge case: missing data handling
- `TestGitConfig.test_load_git_config_missing_bitbucket_creds` (tests/test_git_manager.py) — Tests edge case: missing data handling
- `TestInitEndpoint.test_init_missing_git_config` (tests/test_git_v2_endpoints.py) — Tests edge case: missing data handling
- `TestV2Endpoints.test_v2_endpoint_returns_400_when_git_config_missing` (tests/test_git_v2_endpoints.py) — Tests edge case: missing data handling
- `TestOperationExecutorLogging.test_executor_uses_default_workspace_when_none_provided` (tests/test_logging.py) — Tests edge case: None/null value handling
- `TestAPILogging.test_log_file_naming_convention` (tests/test_logging.py) — Tests edge case: edge case behavior
- `TestWorkspacePathConfiguration.test_workspace_dir_default_fallback` (tests/test_logging.py) — Tests edge case: default value behavior
- `TestOrchestratorAnalyzeFiles.test_analyze_files_empty_input` (tests/test_orchestrator.py) — Tests edge case: empty input handling
- `TestOrchestratorAnalyzeFiles.test_analyze_files_handles_none_analysis` (tests/test_orchestrator.py) — Tests edge case: None/null value handling
- `TestPersistSessionToSpec.test_skips_when_spec_dir_missing` (tests/test_session_persistence.py) — Tests edge case: missing data handling
- `TestPersistSessionToSpec.test_handles_missing_session_file` (tests/test_session_persistence.py) — Tests edge case: missing data handling
- `TestRestoreSessionFromSpec.test_returns_none_when_no_specs_dir` (tests/test_session_persistence.py) — Tests edge case: None/null value handling
- `TestRestoreSessionFromSpec.test_returns_none_when_no_matching_session` (tests/test_session_persistence.py) — Tests edge case: None/null value handling
- `TestRestoreSessionFromSpec.test_handles_matching_session_but_missing_jsonl_backup` (tests/test_session_persistence.py) — Tests edge case: missing data handling
- `TestParseQuestionsFromContent.test_empty_content_returns_empty_list` (tests/test_shapespec_sse_askquestions.py) — Tests edge case: empty input handling
- `TestAskQuestionsRegressions.test_regression_empty_questions_not_included` (tests/test_shapespec_sse_askquestions.py) — Tests edge case: empty input handling

### Error Handling (28 tests)

These test error conditions:

- `TestRawEndpoint.test_returns_404_for_unknown_repo` (tests/api/test_structural_endpoints.py) — Tests error handling: unknown value handling
- `TestMetamodelPopulateEndpoint.test_version_check_rejects_unknown` (tests/api/test_structural_endpoints.py) — Tests error handling: unknown value handling
- `TestDiagramsGenerateEndpoint.test_returns_404_for_unknown_snapshot` (tests/api/test_structural_endpoints.py) — Tests error handling: unknown value handling
- `TestDiagramGeneratorEdgeCases.test_unknown_format_skipped` (tests/ast/test_diagram_generator.py) — Tests error handling: unknown value handling
- `test_symbol_info_rejects_unknown_kinds` (tests/ast/test_models.py) — Tests error handling: unknown value handling
- `test_registry_skips_unavailable_provider` (tests/ast/test_provider.py) — Tests error handling: unavailability handling
- `TestOrchestrationModels.test_orchestration_request_invalid_short_spec_name` (tests/test_haikai_orchestrator.py) — Tests error handling: invalid input rejection
- `TestOrchestrationModels.test_orchestration_request_invalid_short_session_id` (tests/test_haikai_orchestrator.py) — Tests error handling: invalid input rejection
- `TestClaudeCLIExecutor.test_execute_failure` (tests/test_haikai_orchestrator.py) — Tests error handling: error condition handling
- `TestHaikaiOrchestrator.test_run_workflow_with_failure_stop_on_error` (tests/test_haikai_orchestrator.py) — Tests error handling: error condition handling
- `TestContentExtractor.test_extract_handles_analysis_failure` (tests/test_content_extractor.py) — Tests error handling: error condition handling
- `TestContentExtractor.test_extract_handles_extraction_failure` (tests/test_content_extractor.py) — Tests error handling: error condition handling
- `TestFileAnalyzer.test_analyze_file_llm_error` (tests/test_file_analyzer.py) — Tests error handling: error condition handling
- `TestFileAnalyzer.test_analyze_batch_skips_failed_analyses` (tests/test_file_analyzer.py) — Tests error handling: error condition handling
- `TestFileAnalyzer.test_parse_json_response_invalid_json` (tests/test_file_analyzer.py) — Tests error handling: invalid input rejection
- `TestPDFParser.test_parse_pdf_import_error` (tests/test_file_parser.py) — Tests error handling: error condition handling
- `TestPDFParser.test_parse_pdf_parsing_error` (tests/test_file_parser.py) — Tests error handling: error condition handling
- `TestDOCXParser.test_parse_docx_import_error` (tests/test_file_parser.py) — Tests error handling: error condition handling
- `TestHTMLParser.test_parse_html_import_error` (tests/test_file_parser.py) — Tests error handling: error condition handling
- `TestPrepareForCommit.test_run_git_respects_custom_timeout` (tests/test_git_commit_preparation.py) — Tests error handling: timeout handling
- `TestPRCreation.test_create_pr_raises_on_http_error` (tests/test_git_manager.py) — Tests error handling: error condition handling
- `TestOrchestratorGitIntegration.test_push_failure_does_not_fail_orchestration` (tests/test_git_v2_endpoints.py) — Tests error handling: error condition handling
- `TestOrchestratorGitIntegration.test_pr_failure_does_not_fail_orchestration` (tests/test_git_v2_endpoints.py) — Tests error handling: error condition handling
- `TestGapAnalysis.test_v2_implement_push_fails_but_response_still_has_results` (tests/test_git_v2_endpoints.py) — Tests error handling: error condition handling
- `TestOperationExecutorLogging.test_generate_product_standards_logs_errors` (tests/test_logging.py) — Tests error handling: error condition handling
- `TestRestoreSessionFromSpec.test_handles_corrupt_active_session_json` (tests/test_session_persistence.py) — Tests error handling: corrupt/malformed data handling
- `TestTechnicalDocRepository.test_process_technical_documents_with_errors` (tests/test_technical_doc_manager.py) — Tests error handling: error condition handling
- `TestTechnicalDocRepository.test_download_file_error` (tests/test_technical_doc_manager.py) — Tests error handling: error condition handling

### Genuine Gaps (79 tests)

These test normal behavior with no integration counterpart — **needs remediation**:

- `TestContentExtractor.test_init` (tests/test_content_extractor.py) — Normal behavior with no integration test counterpart
- `TestContentExtractor.test_extract_calls_both_steps` (tests/test_content_extractor.py) — Normal behavior with no integration test counterpart
- `TestContentExtractor.test_analyze_structure_uses_first_5000_chars` (tests/test_content_extractor.py) — Normal behavior with no integration test counterpart
- `TestContentExtractor.test_analyze_structure_handles_short_content` (tests/test_content_extractor.py) — Normal behavior with no integration test counterpart
- `TestContentExtractor.test_extract_relevant_uses_analysis` (tests/test_content_extractor.py) — Normal behavior with no integration test counterpart
- `TestContentExtractor.test_extract_end_to_end_success` (tests/test_content_extractor.py) — Normal behavior with no integration test counterpart
- `TestContentExtractor.test_extract_with_different_use_cases` (tests/test_content_extractor.py) — Normal behavior with no integration test counterpart
- `TestContentExtractor.test_extract_reduces_content_size` (tests/test_content_extractor.py) — Normal behavior with no integration test counterpart
- `TestContentExtractorIntegration.test_realistic_tech_doc_extraction` (tests/test_content_extractor.py) — Normal behavior with no integration test counterpart
- `TestFileParser.test_supported_extensions` (tests/test_file_parser.py) — Normal behavior with no integration test counterpart
- `TestFileParser.test_parse_unsupported_extension` (tests/test_file_parser.py) — Normal behavior with no integration test counterpart
- `TestFileParser.test_parse_routes_to_pdf_parser` (tests/test_file_parser.py) — Normal behavior with no integration test counterpart
- `TestFileParser.test_parse_routes_to_docx_parser` (tests/test_file_parser.py) — Normal behavior with no integration test counterpart
- `TestFileParser.test_parse_routes_to_html_parser` (tests/test_file_parser.py) — Normal behavior with no integration test counterpart
- `TestFileParser.test_parse_routes_to_markdown_parser` (tests/test_file_parser.py) — Normal behavior with no integration test counterpart
- `TestFileParser.test_parse_routes_to_text_parser` (tests/test_file_parser.py) — Normal behavior with no integration test counterpart
- `TestPDFParser.test_parse_pdf_success` (tests/test_file_parser.py) — Normal behavior with no integration test counterpart
- `TestDOCXParser.test_parse_docx_success` (tests/test_file_parser.py) — Normal behavior with no integration test counterpart
- `TestHTMLParser.test_parse_html_success` (tests/test_file_parser.py) — Normal behavior with no integration test counterpart
- `TestMarkdownParser.test_parse_markdown_utf8` (tests/test_file_parser.py) — Normal behavior with no integration test counterpart
- `TestMarkdownParser.test_parse_markdown_latin1_fallback` (tests/test_file_parser.py) — Normal behavior with no integration test counterpart
- `TestTextParser.test_parse_text_utf8` (tests/test_file_parser.py) — Normal behavior with no integration test counterpart
- `TestTextParser.test_parse_text_latin1_fallback` (tests/test_file_parser.py) — Normal behavior with no integration test counterpart
- `TestOperationExecutorLogging.test_executor_initialization_logging` (tests/test_logging.py) — Normal behavior with no integration test counterpart
- `TestOperationExecutorLogging.test_executor_logs_request_type` (tests/test_logging.py) — Normal behavior with no integration test counterpart
- `TestOperationExecutorLogging.test_generate_product_standards_logs_parameters` (tests/test_logging.py) — Normal behavior with no integration test counterpart
- `TestOperationExecutorLogging.test_generate_product_standards_logs_directories` (tests/test_logging.py) — Normal behavior with no integration test counterpart
- `TestOperationExecutorLogging.test_generate_product_standards_logs_success` (tests/test_logging.py) — Normal behavior with no integration test counterpart
- `TestOperationExecutorLogging.test_generate_global_standards_logs_parameters` (tests/test_logging.py) — Normal behavior with no integration test counterpart
- `TestOperationExecutorLogging.test_get_metamodel_logs_parameters` (tests/test_logging.py) — Normal behavior with no integration test counterpart
- `TestAPILogging.test_log_directory_creation` (tests/test_logging.py) — Normal behavior with no integration test counterpart
- `TestWorkspacePathConfiguration.test_workspace_dir_parameter_is_used` (tests/test_logging.py) — Normal behavior with no integration test counterpart
- `TestWorkspacePathConfiguration.test_workspace_dir_used_in_operations` (tests/test_logging.py) — Normal behavior with no integration test counterpart
- `TestExecutorCommandConfig.test_claude_executor_stream_message_accepts_command_name` (tests/test_plan_product_sse.py) — Normal behavior with no integration test counterpart
- `TestExecutorCommandConfig.test_oauth_executor_stream_message_accepts_command_name` (tests/test_plan_product_sse.py) — Normal behavior with no integration test counterpart
- `TestPlanProductTemplateFiles.test_plan_product_command_exists` (tests/test_plan_product_sse.py) — Normal behavior with no integration test counterpart
- `TestPlanProductTemplateFiles.test_plan_product_phase_files_exist` (tests/test_plan_product_sse.py) — Normal behavior with no integration test counterpart
- `TestPlanProductTemplateFiles.test_plan_product_workflow_files_exist` (tests/test_plan_product_sse.py) — Normal behavior with no integration test counterpart
- `TestStreamMessagePlanProduct.test_plan_product_command_prefix_in_new_session` (tests/test_plan_product_sse.py) — Normal behavior with no integration test counterpart
- `TestStreamMessagePlanProduct.test_plan_product_streams_content_events` (tests/test_plan_product_sse.py) — Normal behavior with no integration test counterpart
- `TestStreamMessagePlanProduct.test_plan_product_resume_no_prefix` (tests/test_plan_product_sse.py) — Normal behavior with no integration test counterpart
- `TestPlanProductSSEEndpoint.test_new_plan_product_session_streams_events` (tests/test_plan_product_sse.py) — Normal behavior with no integration test counterpart
- `TestPlanProductRegressions.test_plan_product_template_references_resolved` (tests/test_plan_product_sse.py) — Normal behavior with no integration test counterpart
- `TestPlanProductRegressions.test_oauth_executor_stream_accepts_plan_product` (tests/test_plan_product_sse.py) — Normal behavior with no integration test counterpart
- `test_retry_flow` (tests/test_retry_flow.py) — Normal behavior with no integration test counterpart
- `TestPersistSessionToSpec.test_writes_active_session_json` (tests/test_session_persistence.py) — Normal behavior with no integration test counterpart
- `TestPersistSessionToSpec.test_copies_session_jsonl` (tests/test_session_persistence.py) — Normal behavior with no integration test counterpart
- `TestPersistSessionToSpec.test_overwrites_existing_active_session` (tests/test_session_persistence.py) — Normal behavior with no integration test counterpart
- `TestRestoreSessionFromSpec.test_restores_from_spec_backup` (tests/test_session_persistence.py) — Normal behavior with no integration test counterpart
- `TestRestoreSessionFromSpec.test_skips_when_session_exists` (tests/test_session_persistence.py) — Normal behavior with no integration test counterpart
- `TestRestoreSessionFromSpec.test_creates_parent_dirs_on_restore` (tests/test_session_persistence.py) — Normal behavior with no integration test counterpart
- `TestParseQuestionsFromContent.test_markdown_list_format_single_question` (tests/test_shapespec_sse_askquestions.py) — Normal behavior with no integration test counterpart
- `TestParseQuestionsFromContent.test_markdown_list_format_multiple_questions` (tests/test_shapespec_sse_askquestions.py) — Normal behavior with no integration test counterpart
- `TestParseQuestionsFromContent.test_markdown_list_format_multiline_questions` (tests/test_shapespec_sse_askquestions.py) — Normal behavior with no integration test counterpart
- `TestParseQuestionsFromContent.test_numbered_format_questions` (tests/test_shapespec_sse_askquestions.py) — Normal behavior with no integration test counterpart
- `TestParseQuestionsFromContent.test_numbered_format_filters_section_headers` (tests/test_shapespec_sse_askquestions.py) — Normal behavior with no integration test counterpart
- `TestParseQuestionsFromContent.test_no_questions_in_content` (tests/test_shapespec_sse_askquestions.py) — Normal behavior with no integration test counterpart
- `TestStreamMessageAskQuestions.test_ask_questions_tool_detected_and_questions_yielded` (tests/test_shapespec_sse_askquestions.py) — Normal behavior with no integration test counterpart
- `TestStreamMessageAskQuestions.test_skill_tool_with_ask_questions_detected` (tests/test_shapespec_sse_askquestions.py) — Normal behavior with no integration test counterpart
- `TestStreamMessageAskQuestions.test_no_questions_event_without_ask_questions_invocation` (tests/test_shapespec_sse_askquestions.py) — Normal behavior with no integration test counterpart
- `TestStreamMessageAskQuestions.test_questions_event_comes_after_done` (tests/test_shapespec_sse_askquestions.py) — Normal behavior with no integration test counterpart
- `TestStreamMessageAskQuestions.test_folder_event_yielded_after_questions` (tests/test_shapespec_sse_askquestions.py) — Normal behavior with no integration test counterpart
- `TestShapeSpecSSEEndpoint.test_new_session_shapespec_with_questions` (tests/test_shapespec_sse_askquestions.py) — Normal behavior with no integration test counterpart
- `TestShapeSpecSSEEndpoint.test_resume_session_preserves_context` (tests/test_shapespec_sse_askquestions.py) — Normal behavior with no integration test counterpart
- `TestAskQuestionsRegressions.test_regression_questions_not_wrapped_in_json` (tests/test_shapespec_sse_askquestions.py) — Normal behavior with no integration test counterpart
- `TestAskQuestionsRegressions.test_regression_uuid_format_preserved` (tests/test_shapespec_sse_askquestions.py) — Normal behavior with no integration test counterpart
- `TestTechnicalDocRepository.test_initialization` (tests/test_technical_doc_manager.py) — Normal behavior with no integration test counterpart
- `TestTechnicalDocRepository.test_process_technical_documents_success` (tests/test_technical_doc_manager.py) — Normal behavior with no integration test counterpart
- `TestTechnicalDocRepository.test_download_file_success` (tests/test_technical_doc_manager.py) — Normal behavior with no integration test counterpart
- `TestTechnicalDocRepository.test_download_file_uses_cache` (tests/test_technical_doc_manager.py) — Normal behavior with no integration test counterpart
- `TestTechnicalDocRepository.test_copy_file_success` (tests/test_technical_doc_manager.py) — Normal behavior with no integration test counterpart
- `TestTechnicalDocRepository.test_copy_file_uses_cache` (tests/test_technical_doc_manager.py) — Normal behavior with no integration test counterpart
- `TestTechnicalDocRepository.test_copy_file_not_found` (tests/test_technical_doc_manager.py) — Normal behavior with no integration test counterpart
- `TestTechnicalDocRepository.test_ensure_parsed_file_success` (tests/test_technical_doc_manager.py) — Normal behavior with no integration test counterpart
- `TestTechnicalDocRepository.test_ensure_parsed_file_uses_cache` (tests/test_technical_doc_manager.py) — Normal behavior with no integration test counterpart
- `TestTechnicalDocRepository.test_create_header` (tests/test_technical_doc_manager.py) — Normal behavior with no integration test counterpart
- `TestTechnicalDocRepository.test_clear_cache_all` (tests/test_technical_doc_manager.py) — Normal behavior with no integration test counterpart
- `TestTechnicalDocRepository.test_clear_cache_downloads_only` (tests/test_technical_doc_manager.py) — Normal behavior with no integration test counterpart
- `TestTechnicalDocRepository.test_clear_cache_parsed_only` (tests/test_technical_doc_manager.py) — Normal behavior with no integration test counterpart

