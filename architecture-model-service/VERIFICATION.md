# Integration Verification Guide

This document describes manual verification steps for the Architecture Model Service.

## Prerequisites

1. PostgreSQL 15+ installed and running
2. Java 21 installed
3. Maven 3.9+ installed

## Database Setup

### 1. Create Database and User

```bash
# Connect to PostgreSQL as superuser
psql -U postgres

# Create database and user
CREATE DATABASE architecture_model;
CREATE USER arch_model_user WITH PASSWORD 'arch_model_password';
GRANT ALL PRIVILEGES ON DATABASE architecture_model TO arch_model_user;
\c architecture_model
GRANT ALL ON SCHEMA public TO arch_model_user;
\q
```

### 2. Execute Schema

```bash
# From the architecture-model-service directory
psql -U arch_model_user -d architecture_model -f db/schema.sql
```

### 3. Verify Tables Created

```bash
psql -U arch_model_user -d architecture_model -c "\dt"
```

Expected output: 27 tables including:
- model_files
- business_users, business_processes, process_activities, business_points
- applications, application_components, services, interfaces, endpoints, application_points
- logical_data_entities, logical_data_attributes
- physical_data_entities, physical_data_attributes
- app_business_points, interactions
- business_user_business_points, application_point_business_points
- logical_data_entity_relationships, logical_data_entity_physical_data_entities
- logical_data_attribute_physical_data_attributes, data_movements, interface_logical_entities
- diagrams, diagram_nodes, diagram_edges, diagram_interaction_edges, diagram_decorations

## Application Startup

### 1. Build the Application

```bash
cd architecture-model-service
mvn clean package -DskipTests
```

### 2. Run the Application

```bash
mvn spring-boot:run
```

Or:

```bash
java -jar target/architecture-model-service-1.0.0-SNAPSHOT.jar
```

The service starts on port 8080.

## API Verification

### 1. List Model Files (Empty)

```bash
curl -X GET http://localhost:8080/api/model/filenames
```

Expected: `[]`

### 2. Save a Model

```bash
curl -X PUT "http://localhost:8080/api/model?filename=test-model" \
  -H "Content-Type: application/json" \
  -d '{
    "metaModel": {
      "entities": {
        "business_users": [{"id": "bu-1", "name": "Test User", "description": "A user", "tags": "test"}],
        "business_processes": [],
        "process_activities": [],
        "business_points": [],
        "applications": [{"id": "app-1", "name": "Test App", "description": "An app", "app_type": "WEB", "status": "ACTIVE", "tags": "", "valid_from": "2024-Q1", "valid_to": null}],
        "app_components": [],
        "services": [],
        "interfaces": [],
        "endpoints": [],
        "application_points": [],
        "logical_data_entities": [],
        "logical_data_attributes": [],
        "physical_data_entities": [],
        "physical_data_attributes": [],
        "interactions": [],
        "app_business_points": []
      },
      "relationships": {
        "business_user_business_points": [],
        "application_point_business_points": [],
        "logical_data_entity_relationships": [],
        "logical_data_entity_physical_data_entities": [],
        "logical_data_attribute_physical_data_attributes": [],
        "data_movements": [],
        "interface_logical_entities": []
      }
    },
    "diagrams": []
  }'
```

Expected: `{"id":"...","filename":"test-model","description":null,...}`

### 3. List Model Files (With Data)

```bash
curl -X GET http://localhost:8080/api/model/filenames
```

Expected: Array with one entry containing "test-model"

### 4. Load Model

```bash
curl -X GET "http://localhost:8080/api/model?filename=test-model"
```

Expected: Full model JSON with business_users containing "Test User"

### 5. Delete Model

```bash
curl -X DELETE "http://localhost:8080/api/model?filename=test-model"
```

Expected: 204 No Content

### 6. Verify Deletion

```bash
curl -X GET http://localhost:8080/api/model/filenames
```

Expected: `[]`

## Frontend Integration Notes

### Property Naming
All JSON properties use `snake_case` to match frontend TypeScript types:
- `business_process_id` (not `businessProcessId`)
- `valid_from` / `valid_to` (not `validFrom` / `validTo`)
- `source_node_id` (not `sourceNodeId`)

### ID Format
All IDs are strings (TEXT in database) to match frontend string IDs.

### JSONB Fields
The following fields are stored as JSONB:
- `diagram_nodes.style_override`
- `diagram_nodes.embedded_attribute_ids`
- `diagram_nodes.selected_attribute_ids`
- `diagram_nodes.embedded_endpoint_ids`
- `diagram_nodes.embedded_entity_ids`
- `diagram_edges.style_override`
- `diagram_edges.edge_points`
- `diagram_interaction_edges.edge_points`
- `diagram_interaction_edges.user_link_edge_points`
- `diagram_decorations.line_points`
- `diagrams.settings`

### CORS
CORS is configured to allow requests from:
- http://localhost:5173 (Vite)
- http://localhost:3000 (React)
- http://localhost:8080 (same-origin)

## Running Tests

```bash
mvn test
```

Expected: All tests pass (~15 tests).

## Troubleshooting

### Connection Refused
Ensure PostgreSQL is running and accepting connections on port 5432.

### Permission Denied
Verify the database user has correct permissions:
```sql
GRANT ALL ON SCHEMA public TO arch_model_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO arch_model_user;
```

### Schema Validation Failed
If JPA validation fails, the schema may be out of sync. Re-run:
```bash
psql -U arch_model_user -d architecture_model -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql -U arch_model_user -d architecture_model -f db/schema.sql
```

### JSON Parsing Errors
Ensure request Content-Type is `application/json` and property names use snake_case.
