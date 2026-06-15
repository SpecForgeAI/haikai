# Tech Stack

## Overview

The Architecture Capture & Diagram Tool uses a progressive tech stack strategy. Initial versions (v0.1 through Phase 3) are frontend-only with JSON file storage. Phase 5 introduces a Java backend for persistence, versioning, and multi-user support.

## Frontend Stack

### Core Framework

| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.x | Component-based UI framework |
| TypeScript | 5.x | Type-safe JavaScript with strong IDE support |
| Vite | 5.x | Fast development server and build tooling |

### Styling

| Technology | Purpose |
|------------|---------|
| CSS Modules | Scoped component styling without naming conflicts |
| Vanilla CSS | Simple, maintainable styling without preprocessor overhead |

### State Management

| Technology | Purpose |
|------------|---------|
| React Context | Application-wide state for architecture model |
| React useState/useReducer | Local component state and complex state updates |

### Diagram Rendering

| Technology | Purpose |
|------------|---------|
| HTML5 Canvas | High-performance rendering for large diagrams |
| SVG (alternative) | Vector graphics with DOM-based interaction handling |

**Decision Rationale:** Canvas provides better performance for diagrams with many nodes/edges, while SVG offers easier hit-testing and styling. Initial implementation should evaluate both approaches for the specific use case.

### Testing

| Technology | Purpose |
|------------|---------|
| Vitest | Fast, Vite-native unit test runner |
| React Testing Library | Component testing with user-centric queries |

## Backend Stack (Phase 5+)

### Core Framework

| Technology | Version | Purpose |
|------------|---------|---------|
| Java | 21 (LTS) | Long-term support, modern language features |
| Spring Boot | 3.x | Production-ready application framework |
| Gradle or Maven | - | Build automation and dependency management |

### Database

| Technology | Purpose |
|------------|---------|
| PostgreSQL | Relational database for model persistence |
| Spring Data JPA | Repository abstraction for database access |

### Security

| Technology | Purpose |
|------------|---------|
| Spring Security | Authentication and authorization framework |
| OAuth2/OIDC | Integration with corporate identity providers |

### Testing

| Technology | Purpose |
|------------|---------|
| JUnit 5 | Unit and integration testing |
| Spring Boot Test | Application context testing |
| Testcontainers | Integration tests with real PostgreSQL |

## Deployment Stack

### Phase 1-4 (Frontend Only)

| Technology | Purpose |
|------------|---------|
| Nginx | Static file serving for built React app |
| Docker | Containerization for consistent deployment |

### Phase 5+ (Full Stack)

| Technology | Purpose |
|------------|---------|
| Docker | Container images for frontend and backend |
| Docker Compose | Local multi-container development |
| CI/CD Pipeline | Automated testing and deployment (GitHub Actions or similar) |

## Design Decisions

### 1. JSON-First Design

The architecture model is serialized as a single JSON file. This provides:
- Full portability without database dependencies
- Easy version control with Git
- Human-readable format for debugging
- Simple backup and sharing

### 2. Strong Typing Throughout

TypeScript on frontend and Java DTOs on backend ensure:
- Compile-time error detection
- IDE autocomplete and refactoring support
- Self-documenting code
- Contract enforcement between layers

### 3. Separation of Concerns

Architecture meta-model and diagram layout are stored separately:
- Meta-model contains architecture facts (entities, relationships)
- Diagrams contain visual presentation (positions, waypoints)
- Multiple diagrams can reference same meta-model elements
- Model changes don't require diagram updates

### 4. Deterministic Rendering

Explicit positions and edge waypoints instead of auto-layout:
- Predictable diagram appearance
- Architect controls visual presentation
- No unexpected rearrangement on model changes
- Professional, publication-ready output

### 5. Incremental Enhancement

Start simple, add complexity as needed:
- v0.1: Browser-only with JSON files
- Phase 3: Full interactive editing
- Phase 5: Backend persistence and multi-user
- Future: Enterprise features (versioning, API, integrations)

## File Structure

```
architecture-store-and-diagrams/
├── frontend/
│   ├── src/
│   │   ├── components/         # React components
│   │   ├── contexts/           # React context providers
│   │   ├── hooks/              # Custom React hooks
│   │   ├── types/              # TypeScript interfaces
│   │   ├── utils/              # Utility functions
│   │   └── App.tsx             # Root component
│   ├── public/                 # Static assets
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── backend/                    # Phase 5+
│   ├── src/
│   │   ├── main/
│   │   │   ├── java/
│   │   │   └── resources/
│   │   └── test/
│   ├── build.gradle            # or pom.xml
│   └── Dockerfile
├── docker-compose.yml          # Phase 5+
└── agent-os/
    └── product/
        ├── mission.md
        ├── roadmap.md
        └── tech-stack.md
```

## Development Environment

### Required Tools

- Node.js 18+ (for frontend development)
- npm or yarn (package management)
- Java 21 JDK (for backend development, Phase 5+)
- Docker Desktop (for containerized deployment)
- Git (version control)

### Recommended IDE

- VS Code with extensions:
  - ESLint
  - Prettier
  - TypeScript and JavaScript Language Features
- IntelliJ IDEA (for Java backend development)

## Browser Support

Target modern evergreen browsers:
- Chrome (latest 2 versions)
- Firefox (latest 2 versions)
- Edge (latest 2 versions)
- Safari (latest 2 versions)

No IE11 support required (internal tool).

## Performance Considerations

### Frontend

- Virtualized grid rendering for large entity lists
- Canvas-based diagram rendering for 100+ nodes
- Debounced state updates during drag operations
- Lazy loading of diagram data

### Backend (Phase 5+)

- Connection pooling for database
- Pagination for large model queries
- Caching for frequently accessed models
- Async operations for file operations

## Security Considerations

### Frontend (v0.1)

- Input validation for JSON parsing
- XSS prevention in user-entered labels
- No sensitive data in client-side storage

### Backend (Phase 5+)

- OAuth2/OIDC authentication
- Role-based access control
- Input validation and sanitization
- HTTPS enforcement
- SQL injection prevention via parameterized queries
