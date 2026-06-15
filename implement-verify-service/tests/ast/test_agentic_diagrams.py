"""Tests for agentic diagram generation.

Covers:
- Phase 2: read_endpoints / read_interactions tools
- Phase 3: diagram_discoverer parsing, DiagramGenerator.serialise_models, merge logic
- Phase 4: serialiser generic fallback + all 6 known agentic diagram types
- Phase 5: pipeline integration (store no longer generates diagrams)
"""
import json
import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.ast.diagram_model import DiagramModel, DiagramEntity, DiagramRelationship
from src.ast.diagram_generator import DiagramGenerator
from src.ast.enrichment_tools import read_endpoints, read_interactions, TOOLS
from src.ast.mermaid_serialiser import MermaidSerialiser
from src.ast.plantuml_serialiser import PlantUMLSerialiser
from src.ast.graphviz_serialiser import GraphvizSerialiser
from src.ast.metamodel_serialiser import MetamodelSerialiser


# --- Fixtures ---

@pytest.fixture
def snapshot_dir(tmp_path):
    """Create a snapshot directory with sample enrichment data."""
    # _endpoints.txt
    endpoints = (
        "# file\tmethod\tpath\tprotocol\thandler_class\thandler_function\tframework\n"
        "src/controllers/OrderController.java\tGET\t/api/orders\tREST\tOrderController\tgetOrders\tspring_mvc\n"
        "src/controllers/OrderController.java\tPOST\t/api/orders\tREST\tOrderController\tcreateOrder\tspring_mvc\n"
        "src/controllers/UserController.java\tGET\t/api/users/{id}\tREST\tUserController\tgetUser\tspring_mvc\n"
    )
    (tmp_path / "_endpoints.txt").write_text(endpoints)

    # _interactions.txt
    interactions = (
        "# file\ttarget\tmechanism\tdirection\tsource_class\tcall_site\tdata_hint\n"
        "src/services/OrderService.java\torders\tJPA\tWRITE\tOrderService\torderRepository.save()\tOrder\n"
        "src/services/OrderService.java\torder.created\tKafka\tPUB\tOrderService\tkafkaTemplate.send()\tOrderEvent\n"
        "src/services/AuthService.java\tsession-cache\tRedis\tREAD\tAuthService\tredisTemplate.get()\tSession\n"
    )
    (tmp_path / "_interactions.txt").write_text(interactions)

    # _index.txt (minimal)
    index = (
        "# file\tname\tkind\tscope\tsignature\n"
        "src/controllers/OrderController.java\tOrderController\tclass\t\t\n"
        "src/services/OrderService.java\tOrderService\tclass\t\t\n"
    )
    (tmp_path / "_index.txt").write_text(index)

    return tmp_path


@pytest.fixture
def sample_api_surface():
    """Sample API surface DiagramModel."""
    return DiagramModel(
        diagram_type="api_surface",
        title="API Surface — OrderController, UserController",
        entities=[
            DiagramEntity(id="ctrl-order", name="OrderController", entity_type="controller"),
            DiagramEntity(id="ep-get-orders", name="GET /api/orders", entity_type="endpoint",
                          parent_id="ctrl-order", properties={"method": "GET", "path": "/api/orders"}),
            DiagramEntity(id="ep-post-orders", name="POST /api/orders", entity_type="endpoint",
                          parent_id="ctrl-order", properties={"method": "POST", "path": "/api/orders"}),
            DiagramEntity(id="ctrl-user", name="UserController", entity_type="controller"),
            DiagramEntity(id="ep-get-user", name="GET /api/users/{id}", entity_type="endpoint",
                          parent_id="ctrl-user", properties={"method": "GET", "path": "/api/users/{id}"}),
        ],
        relationships=[],
    )


@pytest.fixture
def sample_interaction_flow():
    """Sample interaction flow DiagramModel."""
    return DiagramModel(
        diagram_type="interaction_flow",
        title="External Interactions — OrderService, AuthService",
        entities=[
            DiagramEntity(id="svc-order", name="OrderService", entity_type="service"),
            DiagramEntity(id="svc-auth", name="AuthService", entity_type="service"),
            DiagramEntity(id="ext-orders-db", name="orders", entity_type="database"),
            DiagramEntity(id="ext-kafka", name="order.created", entity_type="message_queue"),
            DiagramEntity(id="ext-redis", name="session-cache", entity_type="cache"),
        ],
        relationships=[
            DiagramRelationship(source_id="svc-order", target_id="ext-orders-db",
                                rel_type="writes", label="JPA WRITE — Order"),
            DiagramRelationship(source_id="svc-order", target_id="ext-kafka",
                                rel_type="publishes", label="Kafka PUB — OrderEvent"),
            DiagramRelationship(source_id="svc-auth", target_id="ext-redis",
                                rel_type="reads", label="Redis READ — Session"),
        ],
    )


@pytest.fixture
def sample_erd():
    """Sample ERD DiagramModel."""
    return DiagramModel(
        diagram_type="erd",
        title="Entity Relationships — Order, User, Product",
        entities=[
            DiagramEntity(id="ent-order", name="Order", entity_type="entity",
                          properties={"attributes": [
                              {"name": "id", "type": "long", "primary_key": True},
                              {"name": "user_id", "type": "long", "foreign_key": True},
                              {"name": "total", "type": "decimal"},
                          ]}),
            DiagramEntity(id="ent-user", name="User", entity_type="entity",
                          properties={"attributes": [
                              {"name": "id", "type": "long", "primary_key": True},
                              {"name": "email", "type": "string"},
                          ]}),
        ],
        relationships=[
            DiagramRelationship(source_id="ent-user", target_id="ent-order",
                                rel_type="has_many", label="orders"),
        ],
    )


@pytest.fixture
def sample_blast_radius():
    """Sample blast radius DiagramModel."""
    return DiagramModel(
        diagram_type="blast_radius",
        title="Blast Radius — orders DB, session-cache",
        entities=[
            DiagramEntity(id="ext-db", name="orders DB", entity_type="database"),
            DiagramEntity(id="svc-order", name="OrderService", entity_type="service"),
            DiagramEntity(id="svc-report", name="ReportService", entity_type="service"),
            DiagramEntity(id="ep-post-orders", name="POST /orders", entity_type="endpoint"),
        ],
        relationships=[
            DiagramRelationship(source_id="svc-order", target_id="ext-db",
                                rel_type="depends_on", label="JPA"),
            DiagramRelationship(source_id="svc-report", target_id="ext-db",
                                rel_type="depends_on", label="JDBC"),
            DiagramRelationship(source_id="svc-order", target_id="ep-post-orders",
                                rel_type="exposes"),
        ],
    )


@pytest.fixture
def sample_uml_component():
    """Sample UML component DiagramModel."""
    return DiagramModel(
        diagram_type="uml_component",
        title="Component Diagram — Order Domain",
        entities=[
            DiagramEntity(id="pkg-controllers", name="controllers", entity_type="component"),
            DiagramEntity(id="comp-order-ctrl", name="OrderController", entity_type="controller",
                          parent_id="pkg-controllers"),
            DiagramEntity(id="pkg-services", name="services", entity_type="component"),
            DiagramEntity(id="comp-order-svc", name="OrderService", entity_type="service",
                          parent_id="pkg-services"),
        ],
        relationships=[
            DiagramRelationship(source_id="comp-order-ctrl", target_id="comp-order-svc",
                                rel_type="calls", label="createOrder()"),
        ],
    )


@pytest.fixture
def sample_enriched_data_flow():
    """Sample enriched data flow DiagramModel."""
    return DiagramModel(
        diagram_type="enriched_data_flow",
        title="Data Flow — OrderService",
        entities=[
            DiagramEntity(id="svc-order", name="OrderService", entity_type="process"),
            DiagramEntity(id="ext-db", name="orders DB", entity_type="store"),
            DiagramEntity(id="ext-kafka", name="order.created", entity_type="output"),
        ],
        relationships=[
            DiagramRelationship(source_id="svc-order", target_id="ext-db",
                                rel_type="writes", label="JPA — Order"),
            DiagramRelationship(source_id="svc-order", target_id="ext-kafka",
                                rel_type="publishes", label="Kafka — OrderEvent"),
        ],
    )


@pytest.fixture
def sample_unknown_type():
    """Sample diagram with an unknown/custom type (for generic fallback)."""
    return DiagramModel(
        diagram_type="kafka_topology",
        title="Kafka Topology — order.created, user.updated",
        entities=[
            DiagramEntity(id="topic-order", name="order.created", entity_type="topic"),
            DiagramEntity(id="svc-order", name="OrderService", entity_type="service"),
            DiagramEntity(id="svc-notification", name="NotificationService", entity_type="service"),
        ],
        relationships=[
            DiagramRelationship(source_id="svc-order", target_id="topic-order",
                                rel_type="publishes", label="PUB"),
            DiagramRelationship(source_id="topic-order", target_id="svc-notification",
                                rel_type="subscribes", label="SUB"),
        ],
    )


# === Phase 2: Tool Tests ===

class TestReadEndpoints:
    def test_reads_all(self, snapshot_dir):
        result = read_endpoints(str(snapshot_dir), "")
        assert "OrderController" in result
        assert "UserController" in result
        assert "GET" in result

    def test_filters_by_pattern(self, snapshot_dir):
        result = read_endpoints(str(snapshot_dir), "UserController")
        assert "UserController" in result
        assert "OrderController" not in result

    def test_empty_file(self, tmp_path):
        (tmp_path / "_endpoints.txt").write_text("# header\n")
        result = read_endpoints(str(tmp_path), "")
        assert "no endpoints found" in result

    def test_missing_file(self, tmp_path):
        result = read_endpoints(str(tmp_path), "")
        assert "no endpoints data available" in result

    def test_registered_in_tools(self):
        assert "read_endpoints" in TOOLS
        assert TOOLS["read_endpoints"]["function"] is read_endpoints


class TestReadInteractions:
    def test_reads_all(self, snapshot_dir):
        result = read_interactions(str(snapshot_dir), "")
        assert "OrderService" in result
        assert "Redis" in result

    def test_filters_by_pattern(self, snapshot_dir):
        result = read_interactions(str(snapshot_dir), "AuthService")
        assert "AuthService" in result
        assert "OrderService" not in result

    def test_empty_file(self, tmp_path):
        (tmp_path / "_interactions.txt").write_text("# header\n")
        result = read_interactions(str(tmp_path), "")
        assert "no interactions found" in result

    def test_missing_file(self, tmp_path):
        result = read_interactions(str(tmp_path), "")
        assert "no interactions data available" in result

    def test_registered_in_tools(self):
        assert "read_interactions" in TOOLS
        assert TOOLS["read_interactions"]["function"] is read_interactions


# === Phase 3: Discoverer Tests ===

class TestDiagramDiscoverer:
    def test_no_llm_returns_empty(self):
        from src.ast.diagram_discoverer import discover_diagrams
        result = discover_diagrams(llm_client=None, snapshot_path="/tmp")
        assert result == []

    def test_no_snapshot_returns_empty(self):
        from src.ast.diagram_discoverer import discover_diagrams
        result = discover_diagrams(llm_client=MagicMock(), snapshot_path=None)
        assert result == []

    def test_no_enrichment_data_returns_empty(self, tmp_path):
        from src.ast.diagram_discoverer import discover_diagrams
        # Empty snapshot dir — no _endpoints.txt or _interactions.txt
        result = discover_diagrams(llm_client=MagicMock(), snapshot_path=str(tmp_path))
        assert result == []

    def test_parse_final_answer(self):
        from src.ast.diagram_discoverer import _parse_diagram_answer
        response = '''Some reasoning here.

FINAL_ANSWER
[
  {
    "diagram_type": "api_surface",
    "title": "Test",
    "entities": [{"id": "e1", "name": "Ctrl", "entity_type": "controller"}],
    "relationships": []
  }
]'''
        models = _parse_diagram_answer(response)
        assert len(models) == 1
        assert models[0].diagram_type == "api_surface"
        assert models[0].entities[0].name == "Ctrl"

    def test_parse_with_code_fence(self):
        from src.ast.diagram_discoverer import _parse_diagram_answer
        response = '''FINAL_ANSWER
```json
[{"diagram_type": "erd", "title": "ERD", "entities": [{"id": "e1", "name": "User", "entity_type": "entity"}], "relationships": []}]
```'''
        models = _parse_diagram_answer(response)
        assert len(models) == 1
        assert models[0].diagram_type == "erd"

    def test_parse_bare_json(self):
        from src.ast.diagram_discoverer import _parse_bare_json
        json_str = '[{"diagram_type": "blast_radius", "title": "BR", "entities": [{"id": "e1", "name": "DB", "entity_type": "database"}], "relationships": []}]'
        models = _parse_bare_json(json_str)
        assert len(models) == 1
        assert models[0].diagram_type == "blast_radius"

    def test_parse_empty_array(self):
        from src.ast.diagram_discoverer import _parse_diagram_answer
        response = "FINAL_ANSWER\n[]"
        models = _parse_diagram_answer(response)
        assert models == []


class TestDiagramGeneratorSerialiseModels:
    def test_serialise_models_writes_files(self, tmp_path, sample_api_surface):
        diagrams_dir = tmp_path / "diagrams"
        diagrams_dir.mkdir()

        gen = DiagramGenerator()
        gen.serialise_models([sample_api_surface], tmp_path)

        assert (diagrams_dir / "api-surface.mmd").exists()
        content = (diagrams_dir / "api-surface.mmd").read_text()
        assert "OrderController" in content

    def test_merge_replaces_data_flow(self, tmp_path, sample_enriched_data_flow):
        diagrams_dir = tmp_path / "diagrams"
        diagrams_dir.mkdir()
        # Pre-existing mechanical data-flow
        old_file = diagrams_dir / "data-flow.mmd"
        old_file.write_text("old mechanical data flow")

        gen = DiagramGenerator()
        gen.serialise_models([sample_enriched_data_flow], tmp_path)

        assert not old_file.exists(), "mechanical data-flow should be deleted"
        assert (diagrams_dir / "enriched-data-flow.mmd").exists()

    def test_multiple_models(self, tmp_path, sample_api_surface, sample_erd):
        (tmp_path / "diagrams").mkdir()
        gen = DiagramGenerator()
        gen.serialise_models([sample_api_surface, sample_erd], tmp_path)
        assert (tmp_path / "diagrams" / "api-surface.mmd").exists()
        assert (tmp_path / "diagrams" / "erd.mmd").exists()


# === Phase 4: Serialiser Tests ===

class TestMermaidAgenticTypes:
    def setup_method(self):
        self.s = MermaidSerialiser()

    def test_api_surface(self, sample_api_surface):
        out = self.s.serialise(sample_api_surface)
        assert "graph LR" in out
        assert "OrderController" in out
        assert "GET /api/orders" in out

    def test_interaction_flow(self, sample_interaction_flow):
        out = self.s.serialise(sample_interaction_flow)
        assert "flowchart LR" in out
        assert "OrderService" in out
        assert "JPA WRITE" in out

    def test_erd(self, sample_erd):
        out = self.s.serialise(sample_erd)
        assert "erDiagram" in out
        assert "Order" in out
        assert "User" in out
        assert "PK" in out

    def test_blast_radius(self, sample_blast_radius):
        out = self.s.serialise(sample_blast_radius)
        assert "graph TD" in out
        assert "orders DB" in out

    def test_uml_component(self, sample_uml_component):
        out = self.s.serialise(sample_uml_component)
        assert "graph LR" in out
        assert "controllers" in out
        assert "OrderController" in out

    def test_enriched_data_flow(self, sample_enriched_data_flow):
        out = self.s.serialise(sample_enriched_data_flow)
        assert "flowchart LR" in out
        assert "OrderService" in out

    def test_generic_fallback(self, sample_unknown_type):
        out = self.s.serialise(sample_unknown_type)
        assert out != ""  # Should NOT return empty
        assert "flowchart LR" in out
        assert "order.created" in out
        assert "PUB" in out


class TestPlantUMLAgenticTypes:
    def setup_method(self):
        self.s = PlantUMLSerialiser()

    def test_api_surface(self, sample_api_surface):
        out = self.s.serialise(sample_api_surface)
        assert "@startuml" in out
        assert "OrderController" in out

    def test_interaction_flow(self, sample_interaction_flow):
        out = self.s.serialise(sample_interaction_flow)
        assert "@startuml" in out
        assert "JPA WRITE" in out

    def test_erd(self, sample_erd):
        out = self.s.serialise(sample_erd)
        assert "@startuml" in out
        assert "entity" in out
        assert "Order" in out

    def test_blast_radius(self, sample_blast_radius):
        out = self.s.serialise(sample_blast_radius)
        assert "@startuml" in out

    def test_uml_component(self, sample_uml_component):
        out = self.s.serialise(sample_uml_component)
        assert "@startuml" in out
        assert "package" in out

    def test_enriched_data_flow(self, sample_enriched_data_flow):
        out = self.s.serialise(sample_enriched_data_flow)
        assert "@startuml" in out

    def test_generic_fallback(self, sample_unknown_type):
        out = self.s.serialise(sample_unknown_type)
        assert out != ""
        assert "@startuml" in out
        assert "order.created" in out


class TestGraphvizAgenticTypes:
    def setup_method(self):
        self.s = GraphvizSerialiser()

    def test_api_surface(self, sample_api_surface):
        out = self.s.serialise(sample_api_surface)
        assert "digraph" in out
        assert "OrderController" in out

    def test_interaction_flow(self, sample_interaction_flow):
        out = self.s.serialise(sample_interaction_flow)
        assert "digraph" in out
        assert "OrderService" in out

    def test_erd(self, sample_erd):
        out = self.s.serialise(sample_erd)
        assert "digraph" in out
        assert "Order" in out

    def test_blast_radius(self, sample_blast_radius):
        out = self.s.serialise(sample_blast_radius)
        assert "digraph" in out

    def test_uml_component(self, sample_uml_component):
        out = self.s.serialise(sample_uml_component)
        assert "digraph" in out
        assert "cluster" in out

    def test_enriched_data_flow(self, sample_enriched_data_flow):
        out = self.s.serialise(sample_enriched_data_flow)
        assert "digraph" in out or "DataFlow" in out

    def test_generic_fallback(self, sample_unknown_type):
        out = self.s.serialise(sample_unknown_type)
        assert out != ""
        assert "digraph" in out
        assert "order" in out.lower()


class TestMetamodelAgenticTypes:
    def setup_method(self):
        self.s = MetamodelSerialiser()

    def test_handles_new_entity_types(self, sample_interaction_flow):
        result = self.s.serialise(sample_interaction_flow)
        assert "diagram_nodes" in result
        assert "diagram_edges" in result
        assert len(result["diagram_nodes"]) == 5
        assert len(result["diagram_edges"]) == 3

    def test_entity_type_mapping(self):
        from src.ast.metamodel_serialiser import _map_entity_type
        assert _map_entity_type("database") == "external_systems"
        assert _map_entity_type("message_queue") == "external_systems"
        assert _map_entity_type("service") == "services"
        assert _map_entity_type("controller") == "services"
        assert _map_entity_type("entity") == "classes"


# === Phase 5: Pipeline Integration ===

class TestPipelineIntegration:
    def test_store_no_longer_generates_diagrams(self, tmp_path):
        """Verify store.write_snapshot() no longer calls _generate_diagrams."""
        from src.ast.store import FileStore
        store = FileStore(base_path=str(tmp_path))
        store.auto_generate_diagrams = True

        # Mock _generate_diagrams to verify it's NOT called
        store._generate_diagrams = MagicMock()

        from src.ast.models import StructuralAnalysis
        analyses = {"test.py": StructuralAnalysis(file_path="test.py", language="python")}

        store.write_snapshot(
            repo_name="test-repo",
            commit_sha="abc123",
            branch="main",
            provider="ctags",
            analyses=analyses,
            project_root=str(tmp_path),
        )

        store._generate_diagrams.assert_not_called()
