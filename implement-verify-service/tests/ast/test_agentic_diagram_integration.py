"""Integration tests for agentic diagram generation.

Tests the full flow:
1. Pipeline generates mechanical diagrams at Step 8a
2. Agentic discoverer produces enrichment-dependent diagrams at Step 8b
3. Serialisers handle all diagram types including generic fallback
4. Merge logic replaces mechanical data-flow with enriched version

Uses real structural data from this repo's src/ast/ files + synthetic
enrichment data to simulate a fully-enriched pipeline run.
"""
import json
import os
import shutil
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.ast.store import FileStore
from src.ast.diagram_generator import DiagramGenerator
from src.ast.diagram_model import DiagramModel, DiagramEntity, DiagramRelationship
from src.ast.mermaid_serialiser import MermaidSerialiser
from src.ast.plantuml_serialiser import PlantUMLSerialiser
from src.ast.graphviz_serialiser import GraphvizSerialiser
from src.ast.metamodel_serialiser import MetamodelSerialiser


# --- Test data simulating piggymetrics-style microservice architecture ---

PIGGY_ENDPOINTS = """# file\tmethod\tpath\tprotocol\thandler_class\thandler_function\tframework
account-service/src/main/java/com/piggymetrics/account/controller/AccountController.java\tGET\t/accounts/{name}\tREST\tAccountController\tgetAccountByName\tspring_mvc
account-service/src/main/java/com/piggymetrics/account/controller/AccountController.java\tPUT\t/accounts/{name}\tREST\tAccountController\tsaveCurrentAccount\tspring_mvc
account-service/src/main/java/com/piggymetrics/account/controller/AccountController.java\tPOST\t/accounts/\tREST\tAccountController\tcreateNewAccount\tspring_mvc
statistics-service/src/main/java/com/piggymetrics/statistics/controller/StatisticsController.java\tGET\t/statistics/{accountName}\tREST\tStatisticsController\tgetStatisticsByAccountName\tspring_mvc
statistics-service/src/main/java/com/piggymetrics/statistics/controller/StatisticsController.java\tPUT\t/statistics/{accountName}\tREST\tStatisticsController\tsaveStatistics\tspring_mvc
notification-service/src/main/java/com/piggymetrics/notification/controller/RecipientController.java\tGET\t/recipients/current\tREST\tRecipientController\tgetCurrentNotificationsSettings\tspring_mvc
notification-service/src/main/java/com/piggymetrics/notification/controller/RecipientController.java\tPUT\t/recipients/current\tREST\tRecipientController\tsaveCurrentNotificationsSettings\tspring_mvc
"""

PIGGY_INTERACTIONS = """# file\ttarget\tmechanism\tdirection\tsource_class\tcall_site\tdata_hint
account-service/src/main/java/com/piggymetrics/account/service/AccountServiceImpl.java\taccount-db\tMongoDB\tWRITE\tAccountServiceImpl\taccountRepository.save()\tAccount
account-service/src/main/java/com/piggymetrics/account/service/AccountServiceImpl.java\tstatistics-service\tHTTP\tWRITE\tAccountServiceImpl\tstatisticsClient.updateStatistics()\tAccount
account-service/src/main/java/com/piggymetrics/account/service/AccountServiceImpl.java\tauth-service\tHTTP\tWRITE\tAccountServiceImpl\tauthClient.createUser()\tUser
statistics-service/src/main/java/com/piggymetrics/statistics/service/StatisticsServiceImpl.java\tstatistics-db\tMongoDB\tWRITE\tStatisticsServiceImpl\trepository.save()\tDataPoint
statistics-service/src/main/java/com/piggymetrics/statistics/service/StatisticsServiceImpl.java\texchange-rates-service\tHTTP\tREAD\tStatisticsServiceImpl\tratesClient.getRates()\tExchangeRatesContainer
notification-service/src/main/java/com/piggymetrics/notification/service/RecipientServiceImpl.java\tnotification-db\tMongoDB\tWRITE\tRecipientServiceImpl\trecipientRepository.save()\tRecipient
notification-service/src/main/java/com/piggymetrics/notification/service/NotificationServiceImpl.java\temail-service\tSMTP\tWRITE\tNotificationServiceImpl\tmailSender.send()\tMimeMessage
"""

PIGGY_INDEX = """# file\tname\tkind\tscope\tsignature
account-service/src/main/java/com/piggymetrics/account/controller/AccountController.java\tAccountController\tclass\t\t
account-service/src/main/java/com/piggymetrics/account/service/AccountServiceImpl.java\tAccountServiceImpl\tclass\t\t
account-service/src/main/java/com/piggymetrics/account/domain/Account.java\tAccount\tclass\t\t
statistics-service/src/main/java/com/piggymetrics/statistics/controller/StatisticsController.java\tStatisticsController\tclass\t\t
statistics-service/src/main/java/com/piggymetrics/statistics/service/StatisticsServiceImpl.java\tStatisticsServiceImpl\tclass\t\t
notification-service/src/main/java/com/piggymetrics/notification/controller/RecipientController.java\tRecipientController\tclass\t\t
notification-service/src/main/java/com/piggymetrics/notification/service/RecipientServiceImpl.java\tRecipientServiceImpl\tclass\t\t
"""


@pytest.fixture
def piggy_snapshot(tmp_path):
    """Create a snapshot directory mimicking piggymetrics after full pipeline."""
    snapshot = tmp_path / "piggymetrics" / "abc123"
    snapshot.mkdir(parents=True)

    (snapshot / "_endpoints.txt").write_text(PIGGY_ENDPOINTS)
    (snapshot / "_interactions.txt").write_text(PIGGY_INTERACTIONS)
    (snapshot / "_index.txt").write_text(PIGGY_INDEX)
    (snapshot / "_calls.txt").write_text("# file\tcaller\tcallee\tconfidence\n")
    (snapshot / "_imports.txt").write_text("# file\tmodule\timport_name\n")
    (snapshot / "_inheritance.txt").write_text("# child\tparent\trelation\n")

    return snapshot


# Simulated agentic DiagramModels that the LLM would produce for piggymetrics
def _piggy_agentic_models():
    """What the LLM would output for piggymetrics."""
    return [
        DiagramModel(
            diagram_type="api_surface",
            title="API Surface — AccountController, StatisticsController, RecipientController",
            entities=[
                DiagramEntity(id="ctrl-account", name="AccountController", entity_type="controller"),
                DiagramEntity(id="ep-get-account", name="GET /accounts/{name}", entity_type="endpoint",
                              parent_id="ctrl-account", properties={"method": "GET", "path": "/accounts/{name}"}),
                DiagramEntity(id="ep-put-account", name="PUT /accounts/{name}", entity_type="endpoint",
                              parent_id="ctrl-account", properties={"method": "PUT", "path": "/accounts/{name}"}),
                DiagramEntity(id="ep-post-account", name="POST /accounts/", entity_type="endpoint",
                              parent_id="ctrl-account", properties={"method": "POST", "path": "/accounts/"}),
                DiagramEntity(id="ctrl-stats", name="StatisticsController", entity_type="controller"),
                DiagramEntity(id="ep-get-stats", name="GET /statistics/{accountName}", entity_type="endpoint",
                              parent_id="ctrl-stats"),
                DiagramEntity(id="ep-put-stats", name="PUT /statistics/{accountName}", entity_type="endpoint",
                              parent_id="ctrl-stats"),
                DiagramEntity(id="ctrl-recipient", name="RecipientController", entity_type="controller"),
                DiagramEntity(id="ep-get-recipient", name="GET /recipients/current", entity_type="endpoint",
                              parent_id="ctrl-recipient"),
                DiagramEntity(id="ep-put-recipient", name="PUT /recipients/current", entity_type="endpoint",
                              parent_id="ctrl-recipient"),
            ],
            relationships=[],
        ),
        DiagramModel(
            diagram_type="interaction_flow",
            title="External Interactions — Microservices → MongoDB, HTTP, SMTP",
            entities=[
                DiagramEntity(id="svc-account", name="AccountServiceImpl", entity_type="service"),
                DiagramEntity(id="svc-stats", name="StatisticsServiceImpl", entity_type="service"),
                DiagramEntity(id="svc-recipient", name="RecipientServiceImpl", entity_type="service"),
                DiagramEntity(id="svc-notification", name="NotificationServiceImpl", entity_type="service"),
                DiagramEntity(id="ext-account-db", name="account-db", entity_type="database"),
                DiagramEntity(id="ext-stats-db", name="statistics-db", entity_type="database"),
                DiagramEntity(id="ext-notif-db", name="notification-db", entity_type="database"),
                DiagramEntity(id="ext-stats-svc", name="statistics-service", entity_type="external_api"),
                DiagramEntity(id="ext-auth-svc", name="auth-service", entity_type="external_api"),
                DiagramEntity(id="ext-rates-svc", name="exchange-rates-service", entity_type="external_api"),
                DiagramEntity(id="ext-email", name="email-service", entity_type="external_api"),
            ],
            relationships=[
                DiagramRelationship(source_id="svc-account", target_id="ext-account-db", rel_type="writes", label="MongoDB — Account"),
                DiagramRelationship(source_id="svc-account", target_id="ext-stats-svc", rel_type="calls_http", label="HTTP — Account"),
                DiagramRelationship(source_id="svc-account", target_id="ext-auth-svc", rel_type="calls_http", label="HTTP — User"),
                DiagramRelationship(source_id="svc-stats", target_id="ext-stats-db", rel_type="writes", label="MongoDB — DataPoint"),
                DiagramRelationship(source_id="svc-stats", target_id="ext-rates-svc", rel_type="reads", label="HTTP — ExchangeRatesContainer"),
                DiagramRelationship(source_id="svc-recipient", target_id="ext-notif-db", rel_type="writes", label="MongoDB — Recipient"),
                DiagramRelationship(source_id="svc-notification", target_id="ext-email", rel_type="writes", label="SMTP — MimeMessage"),
            ],
        ),
        DiagramModel(
            diagram_type="erd",
            title="Entity Relationships — Account, DataPoint, Recipient",
            entities=[
                DiagramEntity(id="ent-account", name="Account", entity_type="entity",
                              properties={"attributes": [
                                  {"name": "name", "type": "String", "primary_key": True},
                                  {"name": "incomes", "type": "List<Item>"},
                                  {"name": "expenses", "type": "List<Item>"},
                                  {"name": "saving", "type": "Saving"},
                              ]}),
                DiagramEntity(id="ent-datapoint", name="DataPoint", entity_type="entity",
                              properties={"attributes": [
                                  {"name": "id", "type": "String", "primary_key": True},
                                  {"name": "account", "type": "String", "foreign_key": True},
                                  {"name": "rates", "type": "Map<Currency,BigDecimal>"},
                              ]}),
                DiagramEntity(id="ent-recipient", name="Recipient", entity_type="entity",
                              properties={"attributes": [
                                  {"name": "accountName", "type": "String", "primary_key": True},
                                  {"name": "email", "type": "String"},
                                  {"name": "scheduledNotifications", "type": "Map"},
                              ]}),
            ],
            relationships=[
                DiagramRelationship(source_id="ent-account", target_id="ent-datapoint",
                                    rel_type="has_many", label="statistics"),
            ],
        ),
        DiagramModel(
            diagram_type="enriched_data_flow",
            title="Data Flow — Piggymetrics Services",
            entities=[
                DiagramEntity(id="proc-account", name="AccountService", entity_type="process"),
                DiagramEntity(id="proc-stats", name="StatisticsService", entity_type="process"),
                DiagramEntity(id="store-account-db", name="account-db", entity_type="store"),
                DiagramEntity(id="store-stats-db", name="statistics-db", entity_type="store"),
                DiagramEntity(id="ext-rates", name="exchange-rates", entity_type="external"),
            ],
            relationships=[
                DiagramRelationship(source_id="proc-account", target_id="store-account-db", rel_type="writes", label="Account"),
                DiagramRelationship(source_id="proc-stats", target_id="store-stats-db", rel_type="writes", label="DataPoint"),
                DiagramRelationship(source_id="ext-rates", target_id="proc-stats", rel_type="reads", label="ExchangeRates"),
            ],
        ),
    ]


class TestEndToEndDiagramGeneration:
    """Full end-to-end: mechanical + agentic diagrams for piggymetrics."""

    def test_mechanical_diagrams_generate(self, piggy_snapshot):
        """Step 8a: mechanical builders generate from store files."""
        gen = DiagramGenerator()
        gen.generate_all(piggy_snapshot)

        diagrams_dir = piggy_snapshot / "diagrams"
        assert diagrams_dir.exists()
        # At least some mechanical diagrams should generate from the index
        mmd_files = list(diagrams_dir.glob("*.mmd"))
        assert len(mmd_files) >= 1, f"Expected at least 1 mechanical diagram, got {len(mmd_files)}"

    def test_agentic_diagrams_serialise(self, piggy_snapshot):
        """Step 8b: agentic models serialise correctly."""
        gen = DiagramGenerator()
        # First generate mechanical diagrams
        gen.generate_all(piggy_snapshot)

        # Then serialise agentic models
        models = _piggy_agentic_models()
        gen.serialise_models(models, piggy_snapshot)

        diagrams_dir = piggy_snapshot / "diagrams"

        # Check all 4 agentic diagram files were created
        assert (diagrams_dir / "api-surface.mmd").exists()
        assert (diagrams_dir / "interaction-flow.mmd").exists()
        assert (diagrams_dir / "erd.mmd").exists()
        assert (diagrams_dir / "enriched-data-flow.mmd").exists()

    def test_merge_replaces_mechanical_data_flow(self, piggy_snapshot):
        """enriched_data_flow replaces mechanical data-flow."""
        gen = DiagramGenerator()

        # Step 8a: mechanical (may or may not produce data-flow depending on data)
        gen.generate_all(piggy_snapshot)
        diagrams_dir = piggy_snapshot / "diagrams"

        # Plant a fake mechanical data-flow to ensure merge logic works
        (diagrams_dir / "data-flow.mmd").write_text("old mechanical")

        # Step 8b: agentic
        models = _piggy_agentic_models()
        gen.serialise_models(models, piggy_snapshot)

        # Mechanical file should be gone
        assert not (diagrams_dir / "data-flow.mmd").exists()
        # Enriched version should exist
        enriched = diagrams_dir / "enriched-data-flow.mmd"
        assert enriched.exists()
        content = enriched.read_text()
        assert "AccountService" in content
        assert "old mechanical" not in content

    def test_all_formats_produce_output(self, piggy_snapshot):
        """All serialiser formats produce non-empty output for agentic models."""
        models = _piggy_agentic_models()

        mermaid = MermaidSerialiser()
        plantuml = PlantUMLSerialiser()
        graphviz = GraphvizSerialiser()
        metamodel = MetamodelSerialiser()

        for model in models:
            mmd_out = mermaid.serialise(model)
            puml_out = plantuml.serialise(model)
            dot_out = graphviz.serialise(model)
            meta_out = metamodel.serialise(model)

            assert mmd_out, f"Mermaid empty for {model.diagram_type}"
            assert puml_out, f"PlantUML empty for {model.diagram_type}"
            assert dot_out, f"Graphviz empty for {model.diagram_type}"
            assert meta_out, f"Metamodel empty for {model.diagram_type}"

    def test_api_surface_content_quality(self, piggy_snapshot):
        """API surface diagram has correct structure."""
        models = _piggy_agentic_models()
        api_model = [m for m in models if m.diagram_type == "api_surface"][0]

        mermaid = MermaidSerialiser()
        out = mermaid.serialise(api_model)

        # Should have all 3 controllers
        assert "AccountController" in out
        assert "StatisticsController" in out
        assert "RecipientController" in out
        # Should have endpoint details
        assert "GET" in out
        assert "POST" in out
        assert "PUT" in out

    def test_interaction_flow_content_quality(self, piggy_snapshot):
        """Interaction flow shows services and external systems."""
        models = _piggy_agentic_models()
        flow_model = [m for m in models if m.diagram_type == "interaction_flow"][0]

        mermaid = MermaidSerialiser()
        out = mermaid.serialise(flow_model)

        # Services
        assert "AccountServiceImpl" in out
        assert "StatisticsServiceImpl" in out
        # External systems
        assert "account-db" in out or "account_db" in out
        assert "MongoDB" in out
        assert "HTTP" in out

    def test_erd_content_quality(self, piggy_snapshot):
        """ERD has entities with attributes and relationships."""
        models = _piggy_agentic_models()
        erd_model = [m for m in models if m.diagram_type == "erd"][0]

        mermaid = MermaidSerialiser()
        out = mermaid.serialise(erd_model)

        assert "erDiagram" in out
        assert "Account" in out
        assert "DataPoint" in out
        assert "PK" in out

    def test_generic_fallback_for_custom_type(self, piggy_snapshot):
        """Custom diagram types render via generic fallback."""
        custom_model = DiagramModel(
            diagram_type="mongodb_access_map",
            title="MongoDB Access — account-db, statistics-db, notification-db",
            entities=[
                DiagramEntity(id="db-account", name="account-db", entity_type="database"),
                DiagramEntity(id="db-stats", name="statistics-db", entity_type="database"),
                DiagramEntity(id="svc-account", name="AccountService", entity_type="service"),
                DiagramEntity(id="svc-stats", name="StatisticsService", entity_type="service"),
            ],
            relationships=[
                DiagramRelationship(source_id="svc-account", target_id="db-account", rel_type="writes"),
                DiagramRelationship(source_id="svc-stats", target_id="db-stats", rel_type="writes"),
            ],
        )

        for serialiser_cls in [MermaidSerialiser, PlantUMLSerialiser, GraphvizSerialiser]:
            s = serialiser_cls()
            out = s.serialise(custom_model)
            assert out, f"{serialiser_cls.__name__} returned empty for custom type"
            assert "account" in out.lower(), f"{serialiser_cls.__name__} missing content for custom type"

    def test_diagram_count(self, piggy_snapshot):
        """Verify total diagram count: mechanical + agentic."""
        gen = DiagramGenerator()
        gen.generate_all(piggy_snapshot)

        models = _piggy_agentic_models()
        gen.serialise_models(models, piggy_snapshot)

        diagrams_dir = piggy_snapshot / "diagrams"
        all_diagrams = list(diagrams_dir.glob("*.mmd"))

        # Should have mechanical diagrams + 4 agentic (enriched-data-flow replaces data-flow)
        # Exact count depends on what mechanical builders produce from minimal data
        assert len(all_diagrams) >= 4, f"Expected at least 4 diagrams, got {len(all_diagrams)}: {[f.name for f in all_diagrams]}"

    def test_enrichment_tools_read_piggy_data(self, piggy_snapshot):
        """Tools correctly read piggymetrics enrichment data."""
        from src.ast.enrichment_tools import read_endpoints, read_interactions

        endpoints = read_endpoints(str(piggy_snapshot), "")
        assert "AccountController" in endpoints
        assert "StatisticsController" in endpoints
        assert len(endpoints.strip().splitlines()) == 7  # 7 endpoints

        interactions = read_interactions(str(piggy_snapshot), "")
        assert "MongoDB" in interactions
        assert "HTTP" in interactions
        assert "SMTP" in interactions
        assert len(interactions.strip().splitlines()) == 7  # 7 interactions

        # Filter by service
        account_only = read_interactions(str(piggy_snapshot), "AccountServiceImpl")
        assert "AccountServiceImpl" in account_only
        assert "RecipientServiceImpl" not in account_only


class TestDiscovererWithMockLLM:
    """Test diagram_discoverer with a mock LLM that returns canned responses."""

    def test_full_agent_loop(self, piggy_snapshot):
        """Simulate a full agent loop: tool calls → final answer."""
        from src.ast.diagram_discoverer import discover_diagrams

        # Mock LLM: first call reads endpoints, second reads interactions, third returns FINAL_ANSWER
        call_count = 0
        def mock_generate(messages, max_tokens=4000):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return 'TOOL_CALL: read_endpoints("")'
            elif call_count == 2:
                return 'TOOL_CALL: read_interactions("")'
            else:
                return '''FINAL_ANSWER
[
  {
    "diagram_type": "api_surface",
    "title": "API Surface",
    "entities": [
      {"id": "ctrl-account", "name": "AccountController", "entity_type": "controller"},
      {"id": "ep-1", "name": "GET /accounts/{name}", "entity_type": "endpoint", "parent_id": "ctrl-account"}
    ],
    "relationships": []
  }
]'''

        mock_llm = MagicMock()
        mock_llm.generate.side_effect = mock_generate

        models = discover_diagrams(
            llm_client=mock_llm,
            project_root=".",
            snapshot_path=str(piggy_snapshot),
        )

        assert len(models) == 1
        assert models[0].diagram_type == "api_surface"
        assert models[0].entities[0].name == "AccountController"
        assert call_count == 3  # 2 tool calls + 1 final answer

    def test_immediate_final_answer(self, piggy_snapshot):
        """LLM returns FINAL_ANSWER on first call (no tool calls needed)."""
        from src.ast.diagram_discoverer import discover_diagrams

        mock_llm = MagicMock()
        mock_llm.generate.return_value = 'FINAL_ANSWER\n[]'

        models = discover_diagrams(
            llm_client=mock_llm,
            project_root=".",
            snapshot_path=str(piggy_snapshot),
        )

        assert models == []
        assert mock_llm.generate.call_count == 1
