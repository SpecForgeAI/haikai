# Specification: Sequence Diagram Participant Colour and Icons for Services and Components

**Spec Name**: sequence-diagram-participant-colour-and-icons-for-services-and-components
**Created**: 2026-01-26
**Scope**: full-stack
**Type**: metamodel-extension + sequence-rendering-enhancement

## 1. Overview

### 1.1 Intent

Add subtle participant header colouring and left-of-label Lucide icons in Sequence Diagrams to visually distinguish Internal UI / Internal Service / Internal Persistence / External for participants that reference Service or Application Component entities.

### 1.2 Key Constraints

- **Service and Application Component participants only**: Only participants where `ref_kind` is `"Service"` or `"ApplicationComponent"` receive colour/icon treatment
- **All other participant kinds unchanged**: Interface, Endpoint, Class, Application, InterfaceEndpoint remain as default white box with black border, centred text, no icon
- **Business User unchanged**: Continues to render as stickman
- **No database migration required**: New fields default in-memory during deserialization
- **No changes to diagram data schema**: Sequence diagram JSON structure remains unchanged

## 2. Meta-Model Data Changes

### 2.1 Entities to Extend

Three existing entities require new fields:

#### 2.1.1 Application Entity

**File**: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ApplicationEntity.java`

| Field | Type | Label | Required | Default |
|-------|------|-------|----------|---------|
| `is_internal` | Boolean | Is Internal? | true | `true` |

**Notes**:
- Used to determine external/internal classification when a Service references an Application but has no ApplicationComponent
- Not directly used for sequence diagram rendering (Application participants remain default styling)

#### 2.1.2 ApplicationComponent Entity

**File**: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ApplicationComponentEntity.java`

| Field | Type | Label | Required | Default |
|-------|------|-------|----------|---------|
| `is_internal` | Boolean | Is Internal? | true | `true` |
| `tech_type` | String (enum) | Tech Type | true | `"Other"` |

**tech_type enum values**:
- `"UI Tier"`
- `"Service Tier"`
- `"Persistence Tier"`
- `"Other"`

#### 2.1.3 Service Entity

**File**: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ServiceEntity.java`

| Field | Type | Label | Required | Default |
|-------|------|-------|----------|---------|
| `is_internal` | Boolean | Is Internal? | true | `true` |

### 2.2 JSON Field Naming Convention

- **Backend (Java/JSON API)**: Use `snake_case` for all persisted JSON / API contracts
  - `is_internal`
  - `tech_type`
- **Frontend (TypeScript)**: May use `camelCase` internally if already standard in the codebase, but API contracts remain `snake_case`

## 3. Backend Implementation

### 3.1 Entity Changes

#### 3.1.1 ApplicationEntity.java

**File**: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ApplicationEntity.java`

Add new field:

```java
@Column(name = "is_internal")
private Boolean isInternal;
```

**Getter/Setter**: Lombok `@Getter @Setter` handles this automatically.

#### 3.1.2 ApplicationComponentEntity.java

**File**: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ApplicationComponentEntity.java`

Add new fields:

```java
@Column(name = "is_internal")
private Boolean isInternal;

@Column(name = "tech_type")
private String techType;
```

#### 3.1.3 ServiceEntity.java

**File**: `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ServiceEntity.java`

Add new field:

```java
@Column(name = "is_internal")
private Boolean isInternal;
```

### 3.2 DTO Changes

#### 3.2.1 ApplicationDto.java

**File**: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ApplicationDto.java`

Add field to record:

```java
@JsonProperty("is_internal")
Boolean isInternal
```

**Full updated record**:
```java
public record ApplicationDto(
    @JsonProperty("id") String id,
    @JsonProperty("name") String name,
    @JsonProperty("description") String description,
    @JsonProperty("app_type") String appType,
    @JsonProperty("status") String status,
    @JsonProperty("tags") String tags,
    @JsonProperty("valid_from") String validFrom,
    @JsonProperty("valid_to") String validTo,
    @JsonProperty("is_internal") Boolean isInternal
) {}
```

#### 3.2.2 ApplicationComponentDto.java

**File**: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ApplicationComponentDto.java`

Add fields to record:

```java
@JsonProperty("is_internal") Boolean isInternal,
@JsonProperty("tech_type") String techType
```

**Full updated record**:
```java
public record ApplicationComponentDto(
    @JsonProperty("id") String id,
    @JsonProperty("name") String name,
    @JsonProperty("description") String description,
    @JsonProperty("application_id") String applicationId,
    @JsonProperty("tags") String tags,
    @JsonProperty("valid_from") String validFrom,
    @JsonProperty("valid_to") String validTo,
    @JsonProperty("is_internal") Boolean isInternal,
    @JsonProperty("tech_type") String techType
) {}
```

#### 3.2.3 ServiceDto.java

**File**: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ServiceDto.java`

Add field to record:

```java
@JsonProperty("is_internal") Boolean isInternal
```

**Full updated record**:
```java
public record ServiceDto(
    @JsonProperty("id") String id,
    @JsonProperty("name") String name,
    @JsonProperty("description") String description,
    @JsonProperty("application_id") String applicationId,
    @JsonProperty("app_component_id") String appComponentId,
    @JsonProperty("service_type") String serviceType,
    @JsonProperty("core_tech") String coreTech,
    @JsonProperty("tags") String tags,
    @JsonProperty("valid_from") String validFrom,
    @JsonProperty("valid_to") String validTo,
    @JsonProperty("package_set_id") String packageSetId,
    @JsonProperty("is_internal") Boolean isInternal
) {}
```

### 3.3 EntityMapper Changes

**File**: `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`

Update the mapping methods to include new fields:

#### toDto(ApplicationEntity)
```java
public ApplicationDto toDto(ApplicationEntity entity) {
    return new ApplicationDto(
        entity.getId(),
        entity.getName(),
        entity.getDescription(),
        entity.getAppType(),
        entity.getStatus(),
        entity.getTags(),
        entity.getValidFrom(),
        entity.getValidTo(),
        entity.getIsInternal()
    );
}
```

#### toEntity(ApplicationDto, String)
```java
public ApplicationEntity toEntity(ApplicationDto dto, String modelFileId) {
    return ApplicationEntity.builder()
        .id(dto.id())
        .modelFileId(modelFileId)
        .name(dto.name())
        .description(dto.description())
        .appType(dto.appType())
        .status(dto.status())
        .tags(dto.tags())
        .validFrom(dto.validFrom())
        .validTo(dto.validTo())
        .isInternal(dto.isInternal())
        .build();
}
```

#### toDto(ApplicationComponentEntity)
```java
public ApplicationComponentDto toDto(ApplicationComponentEntity entity) {
    return new ApplicationComponentDto(
        entity.getId(),
        entity.getName(),
        entity.getDescription(),
        entity.getApplicationId(),
        entity.getTags(),
        entity.getValidFrom(),
        entity.getValidTo(),
        entity.getIsInternal(),
        entity.getTechType()
    );
}
```

#### toEntity(ApplicationComponentDto, String)
```java
public ApplicationComponentEntity toEntity(ApplicationComponentDto dto, String modelFileId) {
    return ApplicationComponentEntity.builder()
        .id(dto.id())
        .modelFileId(modelFileId)
        .applicationId(dto.applicationId())
        .name(dto.name())
        .description(dto.description())
        .tags(dto.tags())
        .validFrom(dto.validFrom())
        .validTo(dto.validTo())
        .isInternal(dto.isInternal())
        .techType(dto.techType())
        .build();
}
```

#### toDto(ServiceEntity)
```java
public ServiceDto toDto(ServiceEntity entity) {
    return new ServiceDto(
        entity.getId(),
        entity.getName(),
        entity.getDescription(),
        entity.getApplicationId(),
        entity.getApplicationComponentId(),
        entity.getServiceType(),
        entity.getCoreTech(),
        entity.getTags(),
        entity.getValidFrom(),
        entity.getValidTo(),
        entity.getPackageSetId(),
        entity.getIsInternal()
    );
}
```

#### toEntity(ServiceDto, String)
```java
public ServiceEntity toEntity(ServiceDto dto, String modelFileId) {
    return ServiceEntity.builder()
        .id(dto.id())
        .modelFileId(modelFileId)
        .applicationId(dto.applicationId())
        .applicationComponentId(dto.appComponentId())
        .name(dto.name())
        .description(dto.description())
        .serviceType(dto.serviceType())
        .coreTech(dto.coreTech())
        .tags(dto.tags())
        .validFrom(dto.validFrom())
        .validTo(dto.validTo())
        .packageSetId(dto.packageSetId())
        .isInternal(dto.isInternal())
        .build();
}
```

### 3.4 Backward Compatibility - No Database Migration

No Liquibase migration is required. The new fields are:
- Nullable in the database (columns can be `NULL`)
- Defaulted in-memory during deserialization when missing from JSON

The Entity classes should provide defaults via builder pattern or explicit null-handling in getters.

**Alternative approach**: If strict defaults are needed, add default values in entity builders:

```java
// In ApplicationEntity.builder() usage, ensure default
.isInternal(dto.isInternal() != null ? dto.isInternal() : true)

// In ApplicationComponentEntity.builder() usage
.isInternal(dto.isInternal() != null ? dto.isInternal() : true)
.techType(dto.techType() != null ? dto.techType() : "Other")

// In ServiceEntity.builder() usage
.isInternal(dto.isInternal() != null ? dto.isInternal() : true)
```

## 4. Frontend Implementation

### 4.1 TypeScript Type Updates

#### 4.1.1 Application Interface

**File**: `frontend/src/types/model.ts`

Update the `Application` interface:

```typescript
export interface Application {
  id: string;
  name: string;
  description: string;
  app_type: string;
  status: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
  is_internal?: boolean; // New field, defaults to true
}
```

#### 4.1.2 ApplicationComponent Interface

**File**: `frontend/src/types/model.ts`

Update the `ApplicationComponent` interface:

```typescript
export interface ApplicationComponent {
  id: string;
  name: string;
  description: string;
  application_id: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
  is_internal?: boolean; // New field, defaults to true
  tech_type?: TechType;  // New field, defaults to "Other"
}
```

Add new type:

```typescript
/**
 * TechType - indicates the technology tier of an Application Component.
 * Used for sequence diagram participant styling.
 */
export type TechType = 'UI Tier' | 'Service Tier' | 'Persistence Tier' | 'Other';

/**
 * Array of all valid TechType values for dropdowns and validation
 */
export const TECH_TYPE_OPTIONS: TechType[] = [
  'UI Tier',
  'Service Tier',
  'Persistence Tier',
  'Other',
];
```

#### 4.1.3 Service Interface

**File**: `frontend/src/types/model.ts`

Update the `Service` interface:

```typescript
export interface Service {
  id: string;
  name: string;
  description: string;
  application_id: string;
  app_component_id?: string;
  service_type: string;
  core_tech?: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
  package_set_id?: string;
  is_internal?: boolean; // New field, defaults to true
}
```

### 4.2 Grid Configuration Updates

**File**: `frontend/src/config/gridConfigs.ts`

#### 4.2.1 Add techTypeOptions to defaults.ts

**File**: `frontend/src/config/defaults.ts`

Add new options array:

```typescript
/**
 * Tech Type options for Application Component dropdown
 * Spec: Sequence Diagram Participant Colour and Icons
 */
export const techTypeOptions = [
  'UI Tier',
  'Service Tier',
  'Persistence Tier',
  'Other',
];
```

#### 4.2.2 Update applications grid config

Add `is_internal` column after `status`:

```typescript
applications: [
  { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
  { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 180 },
  { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 180 },
  { field: 'app_type', displayName: 'Type', cellType: 'dropdown', required: false, width: 100, options: appTypeOptions },
  { field: 'status', displayName: 'Status', cellType: 'dropdown', required: false, width: 100, options: statusOptions },
  { field: 'is_internal', displayName: 'Is Internal?', cellType: 'boolean', required: false, width: 100 }, // NEW
  { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 120 },
  { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
  { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
],
```

#### 4.2.3 Update app_components grid config

Add `is_internal` and `tech_type` columns after `application_id`:

```typescript
app_components: [
  { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
  { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 180 },
  { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 180 },
  { field: 'application_id', displayName: 'Application', cellType: 'fk_typeahead', required: true, width: 180, fkTarget: 'applications' },
  { field: 'is_internal', displayName: 'Is Internal?', cellType: 'boolean', required: false, width: 100 }, // NEW
  { field: 'tech_type', displayName: 'Tech Type', cellType: 'dropdown', required: false, width: 120, options: techTypeOptions }, // NEW
  { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 120 },
  { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
  { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
],
```

#### 4.2.4 Update services grid config

Add `is_internal` column after `package_set_id`:

```typescript
services: [
  { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
  { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 150 },
  { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 150 },
  { field: 'application_id', displayName: 'Application', cellType: 'fk_typeahead', required: false, width: 140, fkTarget: 'applications' },
  { field: 'app_component_id', displayName: 'App Component', cellType: 'fk_typeahead', required: false, width: 140, fkTarget: 'app_components' },
  { field: 'service_type', displayName: 'Service Type', cellType: 'text', required: false, width: 120 },
  { field: 'core_tech', displayName: 'Core Tech', cellType: 'text', required: false, width: 150 },
  { field: 'package_set_id', displayName: 'Package Set', cellType: 'package_set_dropdown', required: false, width: 160 },
  { field: 'is_internal', displayName: 'Is Internal?', cellType: 'boolean', required: false, width: 100 }, // NEW
  { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 100 },
  { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
  { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
],
```

### 4.3 Sequence Diagram Renderer Updates

**File**: `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`

#### 4.3.1 New Constants

Add constants for participant styling at the top of the file:

```typescript
// ============================================================================
// Participant Classification and Styling Constants
// Spec: Sequence Diagram Participant Colour and Icons
// ============================================================================

/** Fill colours for participant header boxes (subtle/pale tones) */
export const PARTICIPANT_FILL_COLOURS = {
  EXTERNAL: '#E3F2FD',        // Light blue
  INTERNAL_UI: '#E8F5E9',     // Light green
  INTERNAL_SERVICE: '#FFFDE7', // Light yellow
  INTERNAL_PERSISTENCE: '#F3E5F5', // Light purple
  OTHER: '#FFFFFF',           // White (default)
} as const;

/** Icon size for participant headers */
const PARTICIPANT_ICON_SIZE = 16;

/** Gap between icon and text in participant headers */
const ICON_TEXT_GAP = 5;

/** Participant kinds that receive colour/icon treatment */
const STYLED_PARTICIPANT_KINDS: ParticipantRefKind[] = ['Service', 'ApplicationComponent'];
```

#### 4.3.2 Classification Types

Add new types for participant classification:

```typescript
/**
 * ParticipantClassification - result of classifying a participant for styling.
 * Determines which fill colour and icon to use.
 */
export type ParticipantClassification =
  | 'EXTERNAL'
  | 'INTERNAL_UI'
  | 'INTERNAL_SERVICE'
  | 'INTERNAL_PERSISTENCE'
  | 'OTHER';

/**
 * Lucide icon names mapped to classifications.
 * null means no icon.
 */
export const CLASSIFICATION_ICONS: Record<ParticipantClassification, string | null> = {
  EXTERNAL: 'external-link',
  INTERNAL_UI: 'monitor-smartphone',
  INTERNAL_SERVICE: 'file-code',
  INTERNAL_PERSISTENCE: 'database',
  OTHER: null,
};
```

#### 4.3.3 Classification Resolution Functions

Add helper functions for resolving participant classification:

```typescript
/**
 * Resolves the classification for a Service participant.
 *
 * Rules:
 * 1. If service.is_internal === false -> EXTERNAL
 * 2. If service.is_internal === true (or missing, defaults to true):
 *    a. Resolve service.app_component_id to ApplicationComponent
 *    b. If found, use appComponent.tech_type:
 *       - "UI Tier" -> INTERNAL_UI
 *       - "Service Tier" -> INTERNAL_SERVICE
 *       - "Persistence Tier" -> INTERNAL_PERSISTENCE
 *       - "Other" or missing -> OTHER
 *    c. If appComponent not found/missing -> OTHER
 *
 * @param serviceId - ID of the Service entity
 * @param metaModel - MetaModel containing services and app_components
 * @returns ParticipantClassification
 */
export function classifyServiceParticipant(
  serviceId: string,
  metaModel: MetaModel
): ParticipantClassification {
  const service = metaModel.entities.services.find(s => s.id === serviceId);
  if (!service) {
    return 'OTHER';
  }

  // Check if external (is_internal defaults to true if missing)
  const isInternal = service.is_internal !== false;
  if (!isInternal) {
    return 'EXTERNAL';
  }

  // Resolve app component for tier classification
  if (service.app_component_id) {
    const appComponent = metaModel.entities.app_components.find(
      c => c.id === service.app_component_id
    );
    if (appComponent) {
      return classifyByTechType(appComponent.tech_type);
    }
  }

  return 'OTHER';
}

/**
 * Resolves the classification for an ApplicationComponent participant.
 *
 * Rules:
 * 1. If component.is_internal === false -> EXTERNAL
 * 2. If component.is_internal === true (or missing, defaults to true):
 *    Use component.tech_type:
 *    - "UI Tier" -> INTERNAL_UI
 *    - "Service Tier" -> INTERNAL_SERVICE
 *    - "Persistence Tier" -> INTERNAL_PERSISTENCE
 *    - "Other" or missing -> OTHER
 *
 * @param componentId - ID of the ApplicationComponent entity
 * @param metaModel - MetaModel containing app_components
 * @returns ParticipantClassification
 */
export function classifyAppComponentParticipant(
  componentId: string,
  metaModel: MetaModel
): ParticipantClassification {
  const component = metaModel.entities.app_components.find(c => c.id === componentId);
  if (!component) {
    return 'OTHER';
  }

  // Check if external (is_internal defaults to true if missing)
  const isInternal = component.is_internal !== false;
  if (!isInternal) {
    return 'EXTERNAL';
  }

  return classifyByTechType(component.tech_type);
}

/**
 * Maps tech_type to classification.
 *
 * @param techType - The tech_type value from ApplicationComponent
 * @returns ParticipantClassification based on tier
 */
function classifyByTechType(techType: string | undefined): ParticipantClassification {
  switch (techType) {
    case 'UI Tier':
      return 'INTERNAL_UI';
    case 'Service Tier':
      return 'INTERNAL_SERVICE';
    case 'Persistence Tier':
      return 'INTERNAL_PERSISTENCE';
    default:
      return 'OTHER';
  }
}

/**
 * Determines if a participant kind should receive styled treatment.
 *
 * @param refKind - The participant's ref_kind
 * @returns true if the participant should have colour/icon styling
 */
export function shouldStyleParticipant(refKind: ParticipantRefKind | string): boolean {
  return STYLED_PARTICIPANT_KINDS.includes(refKind as ParticipantRefKind);
}

/**
 * Gets the classification for a participant based on its ref_kind and ref_id.
 *
 * @param refKind - The participant's ref_kind
 * @param refId - The participant's ref_id (entity ID)
 * @param metaModel - MetaModel for lookups
 * @returns ParticipantClassification
 */
export function classifyParticipant(
  refKind: ParticipantRefKind | string,
  refId: string,
  metaModel: MetaModel
): ParticipantClassification {
  if (refKind === 'Service') {
    return classifyServiceParticipant(refId, metaModel);
  }
  if (refKind === 'ApplicationComponent') {
    return classifyAppComponentParticipant(refId, metaModel);
  }
  return 'OTHER';
}
```

#### 4.3.4 Update ParticipantHeaderProps Interface

Extend the props to include classification:

```typescript
interface ParticipantHeaderProps {
  layout: ParticipantLayout;
  displayName: string;
  isBusinessUser: boolean;
  lifelineTopY: number;
  lifelineBottomY: number;
  classification: ParticipantClassification; // NEW
  refKind: ParticipantRefKind | string;       // NEW - for determining if styling applies
}
```

#### 4.3.5 Update ParticipantHeader Component

Modify the ParticipantHeader component to render icons and apply fill colours:

```typescript
/**
 * Renders a single participant header (box or stickman) with its lifeline.
 * For Service and ApplicationComponent participants, applies classification-based
 * fill colour and optional icon.
 */
const ParticipantHeader: React.FC<ParticipantHeaderProps> = ({
  layout,
  displayName,
  isBusinessUser,
  lifelineTopY,
  lifelineBottomY,
  classification,
  refKind,
}) => {
  const { headerBoxWidth, headerBoxHeight, userHeaderHeight } = LAYOUT_CONSTANTS;

  // Determine if this participant should have styled treatment
  const isStyledParticipant = shouldStyleParticipant(refKind);

  // Get fill colour based on classification
  const fillColour = isStyledParticipant
    ? PARTICIPANT_FILL_COLOURS[classification]
    : HEADER_BOX_FILL;

  // Get icon name (null means no icon)
  const iconName = isStyledParticipant ? CLASSIFICATION_ICONS[classification] : null;

  // Calculate text width accounting for icon
  const textMaxWidth = iconName
    ? headerBoxWidth - HEADER_TEXT_PADDING * 2 - PARTICIPANT_ICON_SIZE - ICON_TEXT_GAP
    : headerBoxWidth - HEADER_TEXT_PADDING * 2;

  if (isBusinessUser) {
    // Render stickman for BusinessUser (unchanged)
    // ... existing stickman rendering code ...
  }

  // Render box header for non-BusinessUser participants
  const { lines } = wrapTextWithEllipsis(displayName, textMaxWidth, HEADER_FONT_SIZE, MAX_HEADER_LINES);

  // Calculate vertical centering for text
  const totalTextHeight = lines.length * HEADER_FONT_SIZE + (lines.length - 1) * LINE_SPACING;
  const textStartY = layout.y + (headerBoxHeight - totalTextHeight) / 2 + HEADER_FONT_SIZE;

  // Calculate icon position (aligned with first line baseline)
  const iconX = layout.x + HEADER_TEXT_PADDING;
  const iconY = textStartY - HEADER_FONT_SIZE + (HEADER_FONT_SIZE - PARTICIPANT_ICON_SIZE) / 2;

  // Text X position shifts right if icon present
  const textX = iconName
    ? layout.lifelineX + (PARTICIPANT_ICON_SIZE + ICON_TEXT_GAP) / 2
    : layout.lifelineX;

  return (
    <g className="sequence-participant" data-participant-id={layout.participantId}>
      {/* Header box */}
      <rect
        x={layout.x}
        y={layout.y}
        width={headerBoxWidth}
        height={headerBoxHeight}
        fill={fillColour}
        stroke={HEADER_BOX_STROKE}
        strokeWidth={appConfig.node.borderWidth}
        rx={4}
      />

      {/* Icon (if applicable) */}
      {iconName && (
        <ParticipantIcon
          iconName={iconName}
          x={iconX}
          y={iconY}
          size={PARTICIPANT_ICON_SIZE}
        />
      )}

      {/* Name text inside box */}
      {lines.map((line, index) => (
        <text
          key={index}
          x={textX}
          y={textStartY + index * (HEADER_FONT_SIZE + LINE_SPACING)}
          textAnchor="middle"
          fontSize={HEADER_FONT_SIZE}
          fontWeight={HEADER_FONT_WEIGHT}
          fontStyle={HEADER_FONT_STYLE}
          fill="#333"
        >
          {line}
        </text>
      ))}

      {/* Lifeline */}
      <line
        x1={layout.lifelineX}
        y1={lifelineTopY}
        x2={layout.lifelineX}
        y2={lifelineBottomY}
        stroke={LIFELINE_STROKE_COLOR}
        strokeWidth={LIFELINE_STROKE_WIDTH}
        strokeDasharray="5,5"
      />
    </g>
  );
};
```

#### 4.3.6 New ParticipantIcon Component

Add a helper component for rendering Lucide icons in SVG:

```typescript
import {
  ExternalLink,
  MonitorSmartphone,
  FileCode,
  Database,
} from 'lucide-react';

/**
 * Maps icon names to Lucide React components.
 */
const ICON_COMPONENTS: Record<string, React.FC<{ size?: number; x?: number; y?: number }>> = {
  'external-link': ExternalLink,
  'monitor-smartphone': MonitorSmartphone,
  'file-code': FileCode,
  'database': Database,
};

interface ParticipantIconProps {
  iconName: string;
  x: number;
  y: number;
  size: number;
}

/**
 * Renders a Lucide icon at the specified position within SVG.
 * Uses foreignObject to embed the React component.
 */
const ParticipantIcon: React.FC<ParticipantIconProps> = ({
  iconName,
  x,
  y,
  size,
}) => {
  const IconComponent = ICON_COMPONENTS[iconName];
  if (!IconComponent) {
    return null;
  }

  return (
    <foreignObject x={x} y={y} width={size} height={size}>
      <IconComponent size={size} />
    </foreignObject>
  );
};
```

**Alternative SVG-native approach** (if foreignObject causes issues):

```typescript
/**
 * Renders icon as inline SVG path (more compatible but requires manual path data).
 */
const ParticipantIconSVG: React.FC<ParticipantIconProps> = ({
  iconName,
  x,
  y,
  size,
}) => {
  // SVG path data for each icon (from Lucide)
  const ICON_PATHS: Record<string, string> = {
    'external-link': 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3',
    'monitor-smartphone': 'M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8 M10 19v-3.96 3.15 M7 19h6 M18 15a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1z M18 17.5h4',
    'file-code': 'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z M14 2v6h6 M10 13l-2 2 2 2 M14 17l2-2-2-2',
    'database': 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7 M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4 M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4 M4 12c0 2.21 3.582 4 8 4s8-1.79 8-4',
  };

  const pathData = ICON_PATHS[iconName];
  if (!pathData) {
    return null;
  }

  const scale = size / 24; // Lucide icons are 24x24

  return (
    <g transform={`translate(${x}, ${y}) scale(${scale})`}>
      <path
        d={pathData}
        fill="none"
        stroke="#333"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
};
```

#### 4.3.7 Update Main Renderer Component

Update the main `SequenceDiagramRenderer` to compute and pass classifications:

```typescript
export const SequenceDiagramRenderer: React.FC<SequenceDiagramRendererProps> = ({
  sequenceDiagram,
  participantSpacing,
  metaModel,
}) => {
  // ... existing layout computation ...

  // Compute classifications for all participants
  const participantClassifications = useMemo(() => {
    const classifications = new Map<string, ParticipantClassification>();
    for (const participant of sequenceDiagram.participants) {
      const classification = classifyParticipant(
        participant.ref_kind,
        participant.ref_id,
        metaModel
      );
      classifications.set(participant.id, classification);
    }
    return classifications;
  }, [sequenceDiagram.participants, metaModel]);

  // ... rest of existing code ...

  return (
    <g className="sequence-diagram-renderer">
      {/* ... fragment frames ... */}

      {/* Render participant headers and lifelines */}
      {layout.participantLayouts.map((participantLayout) => {
        const displayName = participantNames.get(participantLayout.participantId) || participantLayout.refId;
        const isBusinessUser = participantLayout.refKind === 'BusinessUser';
        const classification = participantClassifications.get(participantLayout.participantId) || 'OTHER';

        return (
          <ParticipantHeader
            key={participantLayout.participantId}
            layout={participantLayout}
            displayName={displayName}
            isBusinessUser={isBusinessUser}
            lifelineTopY={layout.lifelineTopY}
            lifelineBottomY={layout.lifelineBottomY}
            classification={classification}
            refKind={participantLayout.refKind}
          />
        );
      })}

      {/* ... message arrows ... */}
    </g>
  );
};
```

### 4.4 Layout Considerations

The spec explicitly states:
> Do NOT change header width, lifeline X positions, spacing, or message layout

This means:
- `LAYOUT_CONSTANTS.headerBoxWidth` remains unchanged
- Lifeline X positions computed by `computeSequenceLayout` remain unchanged
- The icon and text are laid out within the existing header box bounds
- Text wrapping width is reduced to accommodate the icon, but the box size stays the same

## 5. Testing Requirements

### 5.1 Backend Unit Tests

#### 5.1.1 DTO Serialization Tests

Test that new fields serialize/deserialize correctly:

```java
@Test
void applicationDto_shouldSerializeIsInternal() {
    ApplicationDto dto = new ApplicationDto(
        "app-1", "My App", "Desc", "Web", "Active", "tag1", null, null, true
    );
    // Assert JSON contains "is_internal": true
}

@Test
void applicationDto_shouldDeserializeWithMissingIsInternal() {
    String json = """
        {"id": "app-1", "name": "My App"}
        """;
    // Assert isInternal is null (frontend handles default)
}
```

#### 5.1.2 EntityMapper Tests

Test mapping includes new fields:

```java
@Test
void toDto_ApplicationEntity_shouldMapIsInternal() {
    ApplicationEntity entity = ApplicationEntity.builder()
        .id("app-1")
        .name("My App")
        .isInternal(false)
        .build();
    ApplicationDto dto = entityMapper.toDto(entity);
    assertThat(dto.isInternal()).isFalse();
}
```

### 5.2 Frontend Unit Tests

#### 5.2.1 Classification Function Tests

**File**: `frontend/src/__tests__/participantClassification.test.ts`

```typescript
describe('classifyServiceParticipant', () => {
  it('should return EXTERNAL when service.is_internal is false', () => {
    const metaModel = createMockMetaModel({
      services: [{ id: 'svc-1', is_internal: false }],
    });
    expect(classifyServiceParticipant('svc-1', metaModel)).toBe('EXTERNAL');
  });

  it('should return INTERNAL_UI when app_component.tech_type is UI Tier', () => {
    const metaModel = createMockMetaModel({
      services: [{ id: 'svc-1', is_internal: true, app_component_id: 'comp-1' }],
      app_components: [{ id: 'comp-1', tech_type: 'UI Tier' }],
    });
    expect(classifyServiceParticipant('svc-1', metaModel)).toBe('INTERNAL_UI');
  });

  it('should return OTHER when is_internal is missing (defaults to true)', () => {
    const metaModel = createMockMetaModel({
      services: [{ id: 'svc-1' }], // is_internal not set
    });
    expect(classifyServiceParticipant('svc-1', metaModel)).toBe('OTHER');
  });
});

describe('classifyAppComponentParticipant', () => {
  it('should return EXTERNAL when component.is_internal is false', () => {
    const metaModel = createMockMetaModel({
      app_components: [{ id: 'comp-1', is_internal: false }],
    });
    expect(classifyAppComponentParticipant('comp-1', metaModel)).toBe('EXTERNAL');
  });

  it('should return INTERNAL_PERSISTENCE when tech_type is Persistence Tier', () => {
    const metaModel = createMockMetaModel({
      app_components: [{ id: 'comp-1', is_internal: true, tech_type: 'Persistence Tier' }],
    });
    expect(classifyAppComponentParticipant('comp-1', metaModel)).toBe('INTERNAL_PERSISTENCE');
  });
});

describe('shouldStyleParticipant', () => {
  it('should return true for Service', () => {
    expect(shouldStyleParticipant('Service')).toBe(true);
  });

  it('should return true for ApplicationComponent', () => {
    expect(shouldStyleParticipant('ApplicationComponent')).toBe(true);
  });

  it('should return false for Application', () => {
    expect(shouldStyleParticipant('Application')).toBe(false);
  });

  it('should return false for Interface', () => {
    expect(shouldStyleParticipant('Interface')).toBe(false);
  });

  it('should return false for BusinessUser', () => {
    expect(shouldStyleParticipant('BusinessUser')).toBe(false);
  });
});
```

#### 5.2.2 Renderer Integration Tests

**File**: `frontend/src/__tests__/SequenceDiagramRenderer.participant-styling.test.tsx`

```typescript
describe('SequenceDiagramRenderer participant styling', () => {
  it('should render Service participant with light blue fill when external', () => {
    const { container } = render(
      <svg>
        <SequenceDiagramRenderer
          sequenceDiagram={diagramWithExternalService}
          participantSpacing={220}
          metaModel={metaModelWithExternalService}
        />
      </svg>
    );
    const rect = container.querySelector('[data-participant-id="service-external"] rect');
    expect(rect).toHaveAttribute('fill', '#E3F2FD');
  });

  it('should render external-link icon for external Service participant', () => {
    // ... test icon rendering
  });

  it('should render Application participant with default white fill', () => {
    // Application participants do NOT get styled treatment
  });

  it('should render BusinessUser as stickman without fill changes', () => {
    // BusinessUser rendering unchanged
  });
});
```

### 5.3 Visual Regression Tests

Manually verify:
1. External Service participant: light blue fill + external-link icon
2. Internal UI Tier Service: light green fill + monitor-smartphone icon
3. Internal Service Tier Service: light yellow fill + file-code icon
4. Internal Persistence Tier Service: light purple fill + database icon
5. Internal Other Service: white fill + no icon
6. Same patterns for ApplicationComponent participants
7. Application participants: white fill, no icon (unchanged)
8. Interface participants: white fill, no icon (unchanged)
9. BusinessUser participants: stickman rendering (unchanged)

## 6. Implementation Order

### Phase 1: Backend (estimated: 0.5 day)
1. Update Entity classes with new fields
2. Update DTO records with new fields and @JsonProperty annotations
3. Update EntityMapper methods
4. Add unit tests for serialization and mapping

### Phase 2: Frontend Types and Grid Config (estimated: 0.5 day)
1. Update TypeScript interfaces in model.ts
2. Add TechType type and TECH_TYPE_OPTIONS
3. Add techTypeOptions to defaults.ts
4. Update gridConfigs.ts for all three entity grids
5. Test grid editing works for new columns

### Phase 3: Sequence Diagram Renderer (estimated: 1 day)
1. Add classification constants and types
2. Implement classification functions
3. Create ParticipantIcon component
4. Update ParticipantHeader component
5. Update main renderer to compute and pass classifications
6. Add unit tests for classification logic
7. Add integration tests for rendering

### Phase 4: Testing and Polish (estimated: 0.5 day)
1. Manual visual verification
2. Fix any icon alignment issues
3. Verify backward compatibility with existing diagrams
4. Documentation updates if needed

**Total estimated effort: 2.5 days**

## 7. Acceptance Criteria

1. **Business User participants unchanged**: Stickman rendering looks exactly as before
2. **Service participants with correct styling**:
   - External (is_internal=false): light blue fill + external-link icon
   - Internal + UI Tier: light green fill + monitor-smartphone icon
   - Internal + Service Tier: light yellow fill + file-code icon
   - Internal + Persistence Tier: light purple fill + database icon
   - Internal + Other/missing: white fill + no icon
3. **ApplicationComponent participants with correct styling**: Same rules as Service
4. **Other participant kinds unchanged**: Application, Interface, InterfaceEndpoint, Class remain as default white box with black border, centred text, no icon
5. **Backward compatibility**: Existing projects load without errors; missing fields default correctly
6. **Grid editing functional**: New columns appear and are editable in Meta-Model View for Applications, App Components, and Services
7. **No layout changes**: Header widths, lifeline positions, and message layout unchanged

## 8. Non-Goals (Explicit Exclusions)

- No changes to diagram export/print functionality
- No theming or dark-mode support
- No icon customisation per-entity (icons are classification-based only)
- No changes to fragments, messages, lifelines, or layout algorithm
- No database migration scripts
- No styling changes for Application, Interface, InterfaceEndpoint, or Class participant kinds

## 9. Files to Modify

### Backend
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ApplicationEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ApplicationComponentEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ServiceEntity.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ApplicationDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ApplicationComponentDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ServiceDto.java`
- `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`

### Frontend
- `frontend/src/types/model.ts`
- `frontend/src/config/defaults.ts`
- `frontend/src/config/gridConfigs.ts`
- `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`

### New Test Files
- `frontend/src/__tests__/participantClassification.test.ts`
- `frontend/src/__tests__/SequenceDiagramRenderer.participant-styling.test.tsx`
