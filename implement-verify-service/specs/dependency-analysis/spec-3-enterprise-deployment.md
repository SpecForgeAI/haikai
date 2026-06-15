# Implementation Spec: Large-Scale Enterprise Deployment for Standards Extractor

**Version:** 1.0  
**Created:** 2026-04-24  
**Status:** Draft  
**Target:** Standards Extractor Python Application  
**Depends On:** Spec 1 (Deep Dependency Analysis), Spec 2 (Refactoring Impact Analysis)

---

## Executive Summary

Transform Standards Extractor from a single-project tool into an enterprise-ready platform supporting multi-project workspaces, organization-wide standards, centralized deployment, monitoring, and scalability for large codebases.

**Key Enterprise Features:**
- **Multi-Project Registry:** Centralized catalog of all analyzed projects
- **Organization-Wide Standards:** Global standards library shared across projects
- **Project Groups:** Logical grouping of related projects (monorepos, microservices)
- **Deployment Options:** Docker Compose, Kubernetes, cloud-native
- **Monitoring & Observability:** Metrics, health checks, audit logs
- **Performance at Scale:** Caching, connection pooling, async processing
- **Security Hardening:** RBAC, API key management, audit trails

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Multi-Project Registry](#multi-project-registry)
3. [Organization-Wide Standards](#organization-wide-standards)
4. [Project Groups](#project-groups)
5. [Deployment Strategies](#deployment-strategies)
6. [Monitoring & Observability](#monitoring--observability)
7. [Performance Optimization](#performance-optimization)
8. [Security Hardening](#security-hardening)
9. [Implementation Tasks](#implementation-tasks)
10. [Migration Guide](#migration-guide)

---

## 1. Architecture Overview

### Enterprise Topology

```
┌────────────────────────────────────────────────────────┐
│              Load Balancer / Ingress                    │
│              (nginx / Traefik / ALB)                   │
└───────────────────┬────────────────────────────────────┘
                    │
        ┌───────────┴────────────┐
        │                        │
┌───────▼────────┐    ┌─────────▼─────────┐
│  API Instance  │    │   API Instance    │
│  (Pod/Container)│    │  (Pod/Container)  │
│                │    │                   │
│  • FastAPI     │    │   • FastAPI       │
│  • Redis cache │    │   • Redis cache   │
│  • Metrics     │    │   • Metrics       │
└───────┬────────┘    └─────────┬─────────┘
        │                        │
        └───────────┬────────────┘
                    │
        ┌───────────▼────────────────┐
        │   Shared Storage Layer     │
        │                            │
        │  ┌──────────────────────┐ │
        │  │ PostgreSQL           │ │
        │  │ • Project registry   │ │
        │  │ • Org standards      │ │
        │  │ • Audit logs         │ │
        │  └──────────────────────┘ │
        │                            │
        │  ┌──────────────────────┐ │
        │  │ Redis                │ │
        │  │ • Analysis cache     │ │
        │  │ • Rate limiting      │ │
        │  │ • Session store      │ │
        │  └──────────────────────┘ │
        │                            │
        │  ┌──────────────────────┐ │
        │  │ S3 / MinIO           │ │
        │  │ • Dependency graphs  │ │
        │  │ • AST outputs        │ │
        │  │ • Generated docs     │ │
        │  └──────────────────────┘ │
        └────────────────────────────┘
```

### Multi-Tenancy Model

**Hierarchy:**
```
Organization (enterprise customer)
  └── Projects (individual codebases)
      └── Dependency Graphs (per project)
```

**Isolation:**
- API Key per organization
- Database schema separation (PostgreSQL schemas)
- Object storage buckets per organization
- Rate limits per organization

---

## 2. Multi-Project Registry

### PostgreSQL Schema

**Location:** `migrations/001_project_registry.sql`

```sql
-- Organizations table
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(255),
    tier VARCHAR(50) DEFAULT 'free',  -- free, pro, enterprise
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    metadata JSONB
);

-- Projects table
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    display_name VARCHAR(255),
    repository_url TEXT,
    repository_type VARCHAR(50),  -- git, github, gitlab, bitbucket
    default_branch VARCHAR(100) DEFAULT 'main',
    status VARCHAR(50) DEFAULT 'active',  -- active, archived, deleted
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_analyzed_at TIMESTAMP,
    metadata JSONB,
    
    UNIQUE(org_id, name)
);

-- Project analysis history
CREATE TABLE project_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    commit_hash VARCHAR(64),
    analysis_type VARCHAR(50),  -- full, incremental, standards, dependency
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    status VARCHAR(50),  -- pending, running, completed, failed
    stats JSONB,  -- {files: 123, symbols: 456, edges: 789, ...}
    error_message TEXT,
    
    INDEX idx_analyses_project (project_id),
    INDEX idx_analyses_status (status),
    INDEX idx_analyses_started (started_at)
);

-- API keys table
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    key_hash VARCHAR(128) NOT NULL UNIQUE,
    key_prefix VARCHAR(20),  -- First few chars for identification
    name VARCHAR(255),
    scopes TEXT[],  -- ['read', 'write', 'admin']
    expires_at TIMESTAMP,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    revoked_at TIMESTAMP,
    
    INDEX idx_keys_org (org_id),
    INDEX idx_keys_hash (key_hash)
);
```

### Project Registry Service

**Location:** `src/enterprise/project_registry.py`

```python
"""
Project Registry Service

Centralized catalog of all analyzed projects.
"""

from typing import List, Dict, Optional
from uuid import UUID
import asyncpg
from dataclasses import dataclass


@dataclass
class Organization:
    id: UUID
    name: str
    display_name: str
    tier: str
    created_at: datetime
    metadata: Dict


@dataclass
class Project:
    id: UUID
    org_id: UUID
    name: str
    display_name: str
    repository_url: str
    status: str
    last_analyzed_at: Optional[datetime]
    metadata: Dict


class ProjectRegistry:
    """
    Manages multi-project catalog.
    """
    
    def __init__(self, db_pool: asyncpg.Pool):
        self.pool = db_pool
    
    async def register_project(
        self,
        org_name: str,
        project_name: str,
        repository_url: str,
        metadata: Optional[Dict] = None
    ) -> Project:
        """
        Register a new project for analysis.
        
        Creates project entry and initializes workspace.
        """
        async with self.pool.acquire() as conn:
            # Get or create organization
            org = await self._get_or_create_org(conn, org_name)
            
            # Create project
            row = await conn.fetchrow("""
                INSERT INTO projects (org_id, name, repository_url, metadata)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (org_id, name) DO UPDATE
                SET repository_url = EXCLUDED.repository_url,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()
                RETURNING *
            """, org.id, project_name, repository_url, metadata or {})
            
            return Project(**dict(row))
    
    async def list_projects(
        self,
        org_name: str,
        status: Optional[str] = None
    ) -> List[Project]:
        """List all projects for an organization."""
        async with self.pool.acquire() as conn:
            org = await self._get_org(conn, org_name)
            
            query = """
                SELECT * FROM projects
                WHERE org_id = $1
            """
            params = [org.id]
            
            if status:
                query += " AND status = $2"
                params.append(status)
            
            query += " ORDER BY name"
            
            rows = await conn.fetch(query, *params)
            return [Project(**dict(row)) for row in rows]
    
    async def get_project(
        self,
        org_name: str,
        project_name: str
    ) -> Optional[Project]:
        """Get a specific project."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("""
                SELECT p.* FROM projects p
                JOIN organizations o ON p.org_id = o.id
                WHERE o.name = $1 AND p.name = $2
            """, org_name, project_name)
            
            return Project(**dict(row)) if row else None
    
    async def update_analysis_status(
        self,
        project_id: UUID,
        status: str,
        stats: Optional[Dict] = None,
        error: Optional[str] = None
    ):
        """Update project analysis status."""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                UPDATE project_analyses
                SET status = $1,
                    stats = COALESCE($2, stats),
                    error_message = $3,
                    completed_at = CASE WHEN $1 IN ('completed', 'failed') THEN NOW() ELSE completed_at END
                WHERE project_id = $4 AND status = 'running'
            """, status, stats, error, project_id)
            
            if status == 'completed':
                await conn.execute("""
                    UPDATE projects
                    SET last_analyzed_at = NOW()
                    WHERE id = $1
                """, project_id)
    
    async def _get_or_create_org(self, conn, org_name: str) -> Organization:
        """Get or create organization."""
        row = await conn.fetchrow("""
            INSERT INTO organizations (name, display_name)
            VALUES ($1, $1)
            ON CONFLICT (name) DO UPDATE SET updated_at = NOW()
            RETURNING *
        """, org_name)
        
        return Organization(**dict(row))
    
    async def _get_org(self, conn, org_name: str) -> Organization:
        """Get organization or raise error."""
        row = await conn.fetchrow("""
            SELECT * FROM organizations WHERE name = $1
        """, org_name)
        
        if not row:
            raise ValueError(f"Organization not found: {org_name}")
        
        return Organization(**dict(row))
```

---

## 3. Organization-Wide Standards

### Global Standards Library

**Concept:**
- Some standards apply to ALL projects in an organization
- Examples: coding style, security policies, architectural principles
- Stored separately from project-specific standards

**PostgreSQL Schema:**

```sql
CREATE TABLE global_standards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    category VARCHAR(100),  -- backend, frontend, testing, security, etc.
    name VARCHAR(255),
    content TEXT NOT NULL,
    format VARCHAR(50) DEFAULT 'markdown',  -- markdown, json, yaml
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    created_by VARCHAR(255),
    
    UNIQUE(org_id, category, name)
);

CREATE TABLE standard_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    standard_id UUID NOT NULL REFERENCES global_standards(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    created_by VARCHAR(255),
    changelog TEXT,
    
    UNIQUE(standard_id, version)
);
```

### Global Standards Service

**Location:** `src/enterprise/global_standards.py`

```python
"""
Global Standards Management

Organization-wide standards shared across all projects.
"""

class GlobalStandardsService:
    """
    Manages organization-wide standards library.
    """
    
    async def create_standard(
        self,
        org_name: str,
        category: str,
        name: str,
        content: str,
        created_by: str
    ) -> Dict:
        """Create a new global standard."""
        async with self.pool.acquire() as conn:
            org = await self._get_org(conn, org_name)
            
            row = await conn.fetchrow("""
                INSERT INTO global_standards (org_id, category, name, content, created_by)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *
            """, org.id, category, name, content, created_by)
            
            # Create version 1
            await conn.execute("""
                INSERT INTO standard_versions (standard_id, version, content, created_by)
                VALUES ($1, 1, $2, $3)
            """, row['id'], content, created_by)
            
            return dict(row)
    
    async def update_standard(
        self,
        standard_id: UUID,
        content: str,
        updated_by: str,
        changelog: str
    ) -> Dict:
        """Update a standard (creates new version)."""
        async with self.pool.acquire() as conn:
            # Get current version
            current = await conn.fetchrow("""
                SELECT version FROM global_standards WHERE id = $1
            """, standard_id)
            
            new_version = current['version'] + 1
            
            # Update standard
            row = await conn.fetchrow("""
                UPDATE global_standards
                SET content = $1, version = $2, updated_at = NOW()
                WHERE id = $3
                RETURNING *
            """, content, new_version, standard_id)
            
            # Create version record
            await conn.execute("""
                INSERT INTO standard_versions (standard_id, version, content, created_by, changelog)
                VALUES ($1, $2, $3, $4, $5)
            """, standard_id, new_version, content, updated_by, changelog)
            
            return dict(row)
    
    async def get_standards_for_project(
        self,
        org_name: str,
        category: Optional[str] = None
    ) -> List[Dict]:
        """
        Get all applicable global standards for a project.
        
        Returns standards that should be inherited by all projects.
        """
        async with self.pool.acquire() as conn:
            org = await self._get_org(conn, org_name)
            
            query = """
                SELECT * FROM global_standards
                WHERE org_id = $1
            """
            params = [org.id]
            
            if category:
                query += " AND category = $2"
                params.append(category)
            
            query += " ORDER BY category, name"
            
            rows = await conn.fetch(query, *params)
            return [dict(row) for row in rows]
```

### Standards Inheritance

**Workflow:**
1. When generating project-specific standards, first fetch global standards
2. Merge global + project-specific
3. Mark inherited sections clearly
4. Allow projects to override globals (with warning)

```python
async def generate_project_standards(org_name: str, project_name: str):
    """Generate standards with global inheritance."""
    # Fetch global standards
    global_stds = await global_standards_service.get_standards_for_project(org_name)
    
    # Generate project-specific standards
    project_stds = await standards_generator.generate(org_name, project_name)
    
    # Merge (global takes precedence unless explicitly overridden)
    merged = merge_standards(global_stds, project_stds)
    
    return merged
```

---

## 4. Project Groups

### Concept

Group related projects for:
- **Monorepos:** Different services within one repo
- **Microservices:** Related services across repos
- **Product suites:** Frontend + Backend + Mobile for one product

### PostgreSQL Schema

```sql
CREATE TABLE project_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50),  -- monorepo, microservices, product-suite
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(org_id, name)
);

CREATE TABLE project_group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES project_groups(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    hierarchy_path VARCHAR(500),  -- e.g., "frontend/web", "backend/api"
    role VARCHAR(50),  -- primary, secondary, shared
    added_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(group_id, project_id)
);

-- Cross-project dependencies (for microservices)
CREATE TABLE cross_project_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID NOT NULL REFERENCES project_groups(id) ON DELETE CASCADE,
    source_project_id UUID NOT NULL REFERENCES projects(id),
    target_project_id UUID NOT NULL REFERENCES projects(id),
    dependency_type VARCHAR(50),  -- api_call, shared_lib, database, event
    interface_definition TEXT,  -- API spec, event schema, etc.
    confidence FLOAT DEFAULT 1.0,
    detected_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(group_id, source_project_id, target_project_id, dependency_type)
);
```

### Project Groups Service

**Location:** `src/enterprise/project_groups.py`

```python
"""
Project Groups Management

Logical grouping of related projects.
"""

class ProjectGroupsService:
    """
    Manages project groups (monorepos, microservices, product suites).
    """
    
    async def create_group(
        self,
        org_name: str,
        group_name: str,
        group_type: str,
        description: str = ""
    ) -> Dict:
        """Create a new project group."""
        async with self.pool.acquire() as conn:
            org = await self._get_org(conn, org_name)
            
            row = await conn.fetchrow("""
                INSERT INTO project_groups (org_id, name, type, description)
                VALUES ($1, $2, $3, $4)
                RETURNING *
            """, org.id, group_name, group_type, description)
            
            return dict(row)
    
    async def add_project_to_group(
        self,
        group_id: UUID,
        project_id: UUID,
        hierarchy_path: str,
        role: str = "primary"
    ):
        """Add a project to a group."""
        async with self.pool.acquire() as conn:
            await conn.execute("""
                INSERT INTO project_group_members (group_id, project_id, hierarchy_path, role)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (group_id, project_id) DO UPDATE
                SET hierarchy_path = EXCLUDED.hierarchy_path,
                    role = EXCLUDED.role
            """, group_id, project_id, hierarchy_path, role)
    
    async def analyze_cross_project_dependencies(
        self,
        group_id: UUID
    ) -> List[Dict]:
        """
        Analyze dependencies between projects in a group.
        
        For microservices:
        - Detect API calls between services
        - Find shared libraries
        - Identify event-driven communication
        """
        async with self.pool.acquire() as conn:
            # Get all projects in group
            projects = await conn.fetch("""
                SELECT p.* FROM projects p
                JOIN project_group_members pgm ON p.id = pgm.project_id
                WHERE pgm.group_id = $1
            """, group_id)
            
            dependencies = []
            
            # For each pair of projects
            for source_proj in projects:
                for target_proj in projects:
                    if source_proj['id'] == target_proj['id']:
                        continue
                    
                    # Analyze dependency graph for cross-project references
                    # (e.g., HTTP calls, imports from shared libs)
                    deps = await self._detect_dependencies(source_proj, target_proj)
                    
                    for dep in deps:
                        await conn.execute("""
                            INSERT INTO cross_project_dependencies
                            (group_id, source_project_id, target_project_id, dependency_type, interface_definition, confidence)
                            VALUES ($1, $2, $3, $4, $5, $6)
                            ON CONFLICT (group_id, source_project_id, target_project_id, dependency_type)
                            DO UPDATE SET confidence = EXCLUDED.confidence, detected_at = NOW()
                        """, group_id, source_proj['id'], target_proj['id'], 
                            dep['type'], dep['interface'], dep['confidence'])
                        
                        dependencies.append(dep)
            
            return dependencies
    
    async def get_group_impact_analysis(
        self,
        group_id: UUID,
        changed_project_id: UUID,
        changed_symbols: List[str]
    ) -> Dict:
        """
        Cross-project impact analysis.
        
        If service A changes an API endpoint, what happens in services B, C, D?
        """
        # 1. Find cross-project dependencies FROM changed project
        outgoing_deps = await self._get_cross_project_deps(group_id, changed_project_id, direction='outgoing')
        
        # 2. Check if changed symbols match dependency interfaces
        affected_projects = []
        
        for dep in outgoing_deps:
            if self._symbol_matches_interface(changed_symbols, dep['interface_definition']):
                affected_projects.append({
                    'project_id': dep['target_project_id'],
                    'dependency_type': dep['dependency_type'],
                    'risk': 'HIGH' if dep['confidence'] > 0.8 else 'MEDIUM'
                })
        
        return {
            'changed_project': changed_project_id,
            'affected_projects': affected_projects,
            'total_affected': len(affected_projects)
        }
```

---

## 5. Deployment Strategies

### Docker Compose (Development / Small Teams)

**Location:** `docker-compose.enterprise.yml`

```yaml
version: '3.8'

services:
  # Main API instances
  api-1:
    image: standards-extractor:latest
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      - DATABASE_URL=postgresql://postgres:password@postgres:5432/standards_extractor
      - REDIS_URL=redis://redis:6379/0
      - S3_ENDPOINT=http://minio:9000
      - S3_BUCKET=standards-extractor
      - AWS_ACCESS_KEY_ID=minioadmin
      - AWS_SECRET_ACCESS_KEY=minioadmin
      - API_WORKERS=4
    ports:
      - "8001:8000"
    depends_on:
      - postgres
      - redis
      - minio
    volumes:
      - ./workspaces:/app/workspaces
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
  
  api-2:
    image: standards-extractor:latest
    environment:
      - DATABASE_URL=postgresql://postgres:password@postgres:5432/standards_extractor
      - REDIS_URL=redis://redis:6379/0
      - S3_ENDPOINT=http://minio:9000
      - S3_BUCKET=standards-extractor
      - AWS_ACCESS_KEY_ID=minioadmin
      - AWS_SECRET_ACCESS_KEY=minioadmin
      - API_WORKERS=4
    ports:
      - "8002:8000"
    depends_on:
      - postgres
      - redis
      - minio
    volumes:
      - ./workspaces:/app/workspaces
  
  # Load balancer
  nginx:
    image: nginx:alpine
    ports:
      - "8000:80"
    volumes:
      - ./deploy/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - api-1
      - api-2
  
  # PostgreSQL database
  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=standards_extractor
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
  
  # Redis cache
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
  
  # MinIO object storage
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      - MINIO_ROOT_USER=minioadmin
      - MINIO_ROOT_PASSWORD=minioadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio-data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 30s
      timeout: 20s
      retries: 3
  
  # Prometheus monitoring
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./deploy/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
  
  # Grafana dashboards
  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - grafana-data:/var/lib/grafana
      - ./deploy/grafana/dashboards:/etc/grafana/provisioning/dashboards:ro
    depends_on:
      - prometheus

volumes:
  postgres-data:
  redis-data:
  minio-data:
  prometheus-data:
  grafana-data:
```

### Kubernetes (Enterprise Production)

**Location:** `deploy/kubernetes/deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: standards-extractor-api
  namespace: standards-extractor
spec:
  replicas: 3
  selector:
    matchLabels:
      app: standards-extractor-api
  template:
    metadata:
      labels:
        app: standards-extractor-api
    spec:
      containers:
      - name: api
        image: your-registry.com/standards-extractor:latest
        ports:
        - containerPort: 8000
          name: http
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: standards-extractor-secrets
              key: database-url
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: standards-extractor-secrets
              key: redis-url
        - name: S3_ENDPOINT
          value: "https://s3.amazonaws.com"
        - name: S3_BUCKET
          value: "standards-extractor-prod"
        - name: AWS_ACCESS_KEY_ID
          valueFrom:
            secretKeyRef:
              name: standards-extractor-secrets
              key: aws-access-key-id
        - name: AWS_SECRET_ACCESS_KEY
          valueFrom:
            secretKeyRef:
              name: standards-extractor-secrets
              key: aws-secret-access-key
        resources:
          requests:
            memory: "1Gi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 10
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: standards-extractor-api
  namespace: standards-extractor
spec:
  selector:
    app: standards-extractor-api
  ports:
  - port: 80
    targetPort: 8000
  type: LoadBalancer
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: standards-extractor-api-hpa
  namespace: standards-extractor
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: standards-extractor-api
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

---

## 6. Monitoring & Observability

### Metrics Endpoint

**Location:** `src/enterprise/metrics.py`

```python
"""
Prometheus Metrics

Exposes application metrics for monitoring.
"""

from prometheus_client import Counter, Histogram, Gauge, generate_latest
from fastapi import Response

# Request metrics
requests_total = Counter(
    'standards_extractor_requests_total',
    'Total HTTP requests',
    ['method', 'endpoint', 'status']
)

request_duration = Histogram(
    'standards_extractor_request_duration_seconds',
    'HTTP request duration',
    ['method', 'endpoint']
)

# Analysis metrics
analyses_total = Counter(
    'standards_extractor_analyses_total',
    'Total analyses run',
    ['org', 'project', 'type', 'status']
)

analysis_duration = Histogram(
    'standards_extractor_analysis_duration_seconds',
    'Analysis duration',
    ['type']
)

# Graph metrics
graph_size = Gauge(
    'standards_extractor_graph_size',
    'Dependency graph size',
    ['org', 'project', 'metric']  # metric: nodes, edges, clusters, processes
)

# Cache metrics
cache_hits = Counter(
    'standards_extractor_cache_hits_total',
    'Cache hits',
    ['cache_type']
)

cache_misses = Counter(
    'standards_extractor_cache_misses_total',
    'Cache misses',
    ['cache_type']
)

# Error metrics
errors_total = Counter(
    'standards_extractor_errors_total',
    'Total errors',
    ['type', 'severity']
)


@router.get("/metrics")
async def metrics_endpoint():
    """Prometheus metrics endpoint."""
    return Response(
        content=generate_latest(),
        media_type="text/plain"
    )
```

### Health Checks

```python
@router.get("/health")
async def health_check():
    """Health check endpoint for load balancers."""
    checks = {
        'database': await _check_database(),
        'redis': await _check_redis(),
        'storage': await _check_storage()
    }
    
    all_healthy = all(checks.values())
    status_code = 200 if all_healthy else 503
    
    return JSONResponse(
        content={
            'status': 'healthy' if all_healthy else 'unhealthy',
            'checks': checks,
            'timestamp': datetime.utcnow().isoformat()
        },
        status_code=status_code
    )
```

### Structured Logging

```python
import structlog

logger = structlog.get_logger()

# Usage
logger.info(
    "analysis_started",
    org=org_name,
    project=project_name,
    type="dependency",
    file_count=1234
)

logger.error(
    "analysis_failed",
    org=org_name,
    project=project_name,
    error=str(e),
    stack_trace=traceback.format_exc()
)
```

---

## 7. Performance Optimization

### Redis Caching Layer

```python
"""
Redis Cache Manager

Caches analysis results and frequently accessed data.
"""

import redis.asyncio as redis
import json
from typing import Optional

class CacheManager:
    """Redis-backed cache for analysis results."""
    
    def __init__(self, redis_url: str):
        self.redis = redis.from_url(redis_url)
    
    async def get_analysis_result(
        self,
        cache_key: str
    ) -> Optional[Dict]:
        """Get cached analysis result."""
        data = await self.redis.get(f"analysis:{cache_key}")
        
        if data:
            cache_hits.labels(cache_type='analysis').inc()
            return json.loads(data)
        
        cache_misses.labels(cache_type='analysis').inc()
        return None
    
    async def set_analysis_result(
        self,
        cache_key: str,
        result: Dict,
        ttl: int = 3600  # 1 hour
    ):
        """Cache analysis result."""
        await self.redis.setex(
            f"analysis:{cache_key}",
            ttl,
            json.dumps(result)
        )
    
    async def invalidate_project(self, org: str, project: str):
        """Invalidate all cache entries for a project."""
        pattern = f"analysis:{org}:{project}:*"
        keys = await self.redis.keys(pattern)
        
        if keys:
            await self.redis.delete(*keys)
```

### Connection Pooling

```python
import asyncpg

# PostgreSQL connection pool
async def create_db_pool():
    return await asyncpg.create_pool(
        dsn=DATABASE_URL,
        min_size=5,
        max_size=20,
        command_timeout=60
    )

# Usage in FastAPI
@app.on_event("startup")
async def startup():
    app.state.db_pool = await create_db_pool()
    app.state.redis = redis.from_url(REDIS_URL)

@app.on_event("shutdown")
async def shutdown():
    await app.state.db_pool.close()
    await app.state.redis.close()
```

### Async Background Jobs

```python
from fastapi import BackgroundTasks

@router.post("/api/v1/analyze-dependencies")
async def analyze_dependencies(
    request: AnalyzeRequest,
    background_tasks: BackgroundTasks
):
    """Start analysis in background."""
    # Create analysis record
    analysis_id = await create_analysis_record(request)
    
    # Queue background task
    background_tasks.add_task(
        run_analysis_async,
        analysis_id,
        request.company,
        request.project
    )
    
    return {
        "analysis_id": analysis_id,
        "status": "queued",
        "message": "Analysis started in background"
    }
```

---

## 8. Security Hardening

### API Key Management

```python
"""
API Key Authentication

Organization-scoped API keys with permission scopes.
"""

import hashlib
import secrets
from fastapi import Security, HTTPException
from fastapi.security import HTTPBearer

security = HTTPBearer()

async def verify_api_key(
    credentials: HTTPAuthorizationCredentials = Security(security),
    required_scope: str = 'read'
) -> str:
    """
    Verify API key and check permissions.
    
    Returns organization name if valid.
    """
    token = credentials.credentials
    
    # Hash token for database lookup
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    
    async with app.state.db_pool.acquire() as conn:
        key = await conn.fetchrow("""
            SELECT k.*, o.name as org_name
            FROM api_keys k
            JOIN organizations o ON k.org_id = o.id
            WHERE k.key_hash = $1
              AND k.revoked_at IS NULL
              AND (k.expires_at IS NULL OR k.expires_at > NOW())
        """, token_hash)
        
        if not key:
            raise HTTPException(status_code=401, detail="Invalid API key")
        
        # Check scopes
        if required_scope not in key['scopes']:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        
        # Update last_used_at
        await conn.execute("""
            UPDATE api_keys SET last_used_at = NOW() WHERE id = $1
        """, key['id'])
        
        return key['org_name']


def generate_api_key() -> tuple[str, str]:
    """
    Generate new API key.
    
    Returns: (key, hash) tuple
    """
    key = f"se_{secrets.token_urlsafe(32)}"
    key_hash = hashlib.sha256(key.encode()).hexdigest()
    
    return key, key_hash
```

### Rate Limiting

```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@router.post("/api/v1/analyze-dependencies")
@limiter.limit("10/minute")  # Per IP
async def analyze_dependencies(request: Request, ...):
    ...
```

### Audit Logging

```sql
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id),
    user_id VARCHAR(255),  # API key or user identifier
    action VARCHAR(100),  # create_project, run_analysis, delete_standards, etc.
    resource_type VARCHAR(100),
    resource_id UUID,
    details JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    
    INDEX idx_audit_org (org_id),
    INDEX idx_audit_action (action),
    INDEX idx_audit_created (created_at)
);
```

```python
async def log_audit_event(
    org_id: UUID,
    action: str,
    resource_type: str,
    resource_id: UUID,
    details: Dict,
    request: Request
):
    """Log audit event."""
    async with app.state.db_pool.acquire() as conn:
        await conn.execute("""
            INSERT INTO audit_logs (org_id, action, resource_type, resource_id, details, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        """, org_id, action, resource_type, resource_id, details, 
            request.client.host, request.headers.get('user-agent'))
```

---

## 9. Implementation Tasks

### Phase 1: Multi-Project Foundation (Week 1-2)

**Task 1.1: PostgreSQL Schema**
- [ ] Create organizations, projects, analyses tables
- [ ] Create API keys table
- [ ] Migration scripts
- [ ] Indexes

**Task 1.2: Project Registry Service**
- [ ] Implement ProjectRegistry class
- [ ] CRUD operations
- [ ] Analysis tracking
- [ ] Tests

**Task 1.3: API Integration**
- [ ] Update all endpoints to use org/project from registry
- [ ] Migrate existing data
- [ ] Tests

### Phase 2: Global Standards (Week 3)

**Task 2.1: Global Standards Schema**
- [ ] Create global_standards table
- [ ] Version tracking
- [ ] Tests

**Task 2.2: Global Standards Service**
- [ ] CRUD operations
- [ ] Version management
- [ ] Inheritance logic
- [ ] Tests

**Task 2.3: Standards Merge**
- [ ] Implement merge algorithm
- [ ] Override detection
- [ ] Tests

### Phase 3: Project Groups (Week 4)

**Task 3.1: Project Groups Schema**
- [ ] Create project_groups tables
- [ ] Cross-project dependencies
- [ ] Tests

**Task 3.2: Project Groups Service**
- [ ] Group management
- [ ] Cross-project analysis
- [ ] Tests

### Phase 4: Deployment (Week 5-6)

**Task 4.1: Docker Compose**
- [ ] Multi-container setup
- [ ] Load balancing (nginx)
- [ ] PostgreSQL, Redis, MinIO
- [ ] Tests

**Task 4.2: Kubernetes**
- [ ] Deployment manifests
- [ ] Service definitions
- [ ] HPA configuration
- [ ] Tests

### Phase 5: Monitoring (Week 7)

**Task 5.1: Metrics**
- [ ] Prometheus metrics endpoint
- [ ] Custom metrics
- [ ] Grafana dashboards
- [ ] Tests

**Task 5.2: Health Checks**
- [ ] /health endpoint
- [ ] Component checks
- [ ] Tests

**Task 5.3: Logging**
- [ ] Structured logging
- [ ] Log aggregation
- [ ] Tests

### Phase 6: Security (Week 8)

**Task 6.1: API Key Management**
- [ ] Key generation
- [ ] Scope checking
- [ ] Expiration
- [ ] Tests

**Task 6.2: Rate Limiting**
- [ ] slowapi integration
- [ ] Per-org limits
- [ ] Tests

**Task 6.3: Audit Logging**
- [ ] Audit log schema
- [ ] Event logging
- [ ] Query interface
- [ ] Tests

---

## 10. Migration Guide

### From Single-Project to Multi-Project

**Step 1: Backup Existing Data**
```bash
# Backup SQLite databases
cp -r api_workspace/ api_workspace.backup/

# Backup AST outputs
tar -czf ast-outputs.tar.gz */structural/
```

**Step 2: Set Up PostgreSQL**
```bash
# Run migrations
psql -U postgres -d standards_extractor -f migrations/001_project_registry.sql
```

**Step 3: Migrate Data**
```python
# Migration script
async def migrate_to_multi_project():
    """Migrate existing single-project data to multi-project."""
    # For each workspace directory
    for company_dir in Path("api_workspace").iterdir():
        for project_dir in company_dir.iterdir():
            # Register project
            await registry.register_project(
                org_name=company_dir.name,
                project_name=project_dir.name,
                repository_url="",
                metadata={}
            )
            
            # Migrate dependency graph (if exists)
            graph_db = project_dir / "dependency_graph.db"
            if graph_db.exists():
                # Copy to new location or leave in place
                pass
            
            # Create initial analysis record
            await registry.create_analysis_record(...)
```

**Step 4: Update API Clients**
```bash
# Old API calls
POST /api/v1/analyze-dependencies?company=acme

# New API calls (same, but enforced via registry)
POST /api/v1/analyze-dependencies
{
  "company": "acme",
  "project": "backend"
}
```

---

## Success Criteria

✅ **Functional:**
- Multi-project registry operational
- Global standards management working
- Project groups functional
- Docker Compose deployment tested
- Kubernetes deployment tested

✅ **Performance:**
- <100ms API response time (p95)
- Support 100+ concurrent projects
- Cache hit rate >70%
- Analysis queue <5min lag

✅ **Security:**
- API key authentication enforced
- Rate limiting active
- Audit logging complete
- HTTPS enforced in production

✅ **Observability:**
- Prometheus metrics exposed
- Grafana dashboards created
- Health checks reliable
- Structured logging in place

---

**End of Spec 3**
