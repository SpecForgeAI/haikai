# PetClinic Java Coding Standards

## Overview

- **Codebase:** Spring PetClinic Reference Application
- **Files Analyzed:** 47 Java files
- **Primary Frameworks:** Spring Framework (web), JUnit (testing), JPA/Jakarta Persistence
- **Architecture:** Domain-driven entity design with layered Spring MVC controllers

---

## Dependency Graph (Top 15 Imports)

| Module | Files |
|--------|------:|
| java.util | 54 |
| jakarta.persistence | 38 |
| org.junit.jupiter.api | 25 |
| org.springframework.web.bind.annotation | 22 |
| org.springframework.data.domain | 17 |
| org.springframework.http | 17 |
| org.springframework.context.annotation | 10 |
| org.springframework.beans.factory.annotation | 10 |
| org.springframework.samples.petclinic.model | 10 |
| org.assertj.core.api.Assertions | 9 |
| org.junit.jupiter.api.condition | 8 |
| org.springframework.test.web.servlet.result.MockMvcResultMatchers | 8 |
| java.time | 7 |
| org.springframework.stereotype | 7 |
| org.springframework.validation | 7 |

---

## Call Graph Hotspots (Top 15)

| Target | Calls |
|--------|------:|
| assertThat | 54 |
| model | 51 |
| mockMvc.perform | 28 |
| status | 26 |
| view().name | 25 |
| view | 25 |
| status().isOk | 18 |
| this.owners.findById | 16 |
| post | 15 |
| hasProperty | 13 |
| model().attribute | 12 |
| get | 11 |
| model().attributeHasFieldErrors | 11 |
| this.owners.save | 10 |
| is | 10 |

---

## Inheritance Hierarchy

- `BaseEntity` → `Serializable`
- `NamedEntity` → `BaseEntity`
- `Owner` → `Person` → `BaseEntity`
- `Person` → `BaseEntity`
- `Pet` → `NamedEntity`
- `PetType` → `NamedEntity`
- `Specialty` → `NamedEntity`
- `Vet` → `Person`
- `Visit` → `BaseEntity`
- `OwnerRepository` → `JpaRepository`
- `PetTypeRepository` → `JpaRepository`
- `VetRepository` → `Repository`
- `PetTypeFormatter` → `Formatter`
- `PetValidator` → `Validator`
- `PetClinicRuntimeHints` → `RuntimeHintsRegistrar`
- `PropertiesLogger` → `ApplicationListener`
- `WebConfiguration` → `WebMvcConfigurer`

---

# Naming Conventions

## Class Naming

**Standard:** `PascalCase` with domain-specific suffixes

- **Entities:** Simple domain names without suffix (e.g., `Pet`, `Owner`, `Vet`)
- **Controllers:** `{Entity}Controller` (e.g., `OwnerController`, `PetController`)
- **Configuration:** `{Domain}Configuration` (e.g., `WebConfiguration`, `PetClinicRuntimeHints`)
- **Validators:** `{Entity}Validator` (e.g., `PetValidator`)
- **Formatters:** `{Entity}Formatter` (e.g., `PetTypeFormatter`)
- **Repositories:** `{Entity}Repository` (e.g., `OwnerRepository`)
- **Services/Helpers:** Descriptive names with semantic suffix (e.g., `ClinicService`)

**Rationale:** Clear domain responsibility; enables discoverability and IDE navigation.

## Method Naming

**Standard:** `camelCase` with action-oriented verb prefixes in controllers and services

### JavaBean Property Accessors
- **Getters:** `get{PropertyName}()` (e.g., `getAddress()`, `getPets()`)
- **Setters:** `set{PropertyName}(Type value)` (e.g., `setAddress()`)
- **Boolean getters:** `is{PropertyName}()` (e.g., `isNew()`)

**Requirement:** Required for JPA entities and Spring binding; enables reflection-based serialization.

### Controller Methods
- **GET handlers:** `init{Entity}Form()`, `show{Entity}()`, `find{Entity}()` 
  - Example: `initCreationForm()`, `showOwner()`, `findPaginatedForOwnersLastName()`
- **POST handlers:** `process{Entity}Form()` 
  - Example: `processCreationForm()`, `processUpdateOwnerForm()`
- **Helper methods:** `populate{Collection}()`, `update{Entity}Details()`, `add{Item}()`
  - Example: `populatePetTypes()`, `updatePetDetails()`

**Rationale:** Verb-prefix convention communicates method intent without reading implementation; supports HTTP lifecycle clarity.

### Domain Entity Methods
- **Mutator methods:** Verb-first, single-word action (e.g., `addPet()`, `addVisit()`)
- **Query methods:** Verb-first or property-noun pattern (e.g., `getPet(String name)`, `getVisits()`)
- **Lifecycle:** `isNew()` indicates entity persistence state

**Rationale:** Clear business semantics; follows domain-driven design conventions.

### Validation & Framework Methods
- **Validators:** `validate()`, `supports()` (interface contract)
- **Formatters:** `parse()`, `print()` (interface contract)
- **Configuration:** `addInterceptors()`, `setAllowedFields()`, `registerHints()`

**Rationale:** Framework contract adherence; consistent with Spring callback signatures.

## Variable Naming

**Standard:** `camelCase` with semantic precision

- **Repository references:** Plural nouns (e.g., `owners`, `types`, `vets`)
- **Entity instances:** Singular domain names (e.g., `owner`, `pet`, `visit`)
- **Optional-wrapped values:** Prefix with `optional` (e.g., `optionalOwner`, `optionalPet`)
  - Signals type awareness and intent to handle absence
- **Collection results:** Verb-noun pattern (e.g., `listOwners`, `foundVisits`)
- **Boolean flags:** Prefix with `is` or `has` (e.g., `isNew`, `hasErrors`)
- **Constants:** `UPPER_SNAKE_CASE` (e.g., `VIEWS_OWNER_CREATE_OR_UPDATE_FORM`, `REQUIRED`)

**Rationale:** Self-documenting code; type hints embedded in names; consistency with Java conventions.

---

# Architectural Patterns

## Entity Design (Domain-Driven)

### Entity Hierarchy

**Standard:** Inheritance-based specialization with common base classes

```
BaseEntity (id, serializable)
├── NamedEntity (extends BaseEntity; adds name)
│   ├── Pet
│   ├── PetType
│   └── Specialty
├── Person (extends BaseEntity; adds firstName, lastName)
│   ├── Owner (adds address, city, telephone, pets collection)
│   └── Vet (adds specialties collection)
└── Visit (extends BaseEntity; adds date, description, pet reference)
```

**Guidelines:**
- Keep hierarchy depth ≤ 2 levels to avoid deep coupling
- Use horizontal reuse (composition) for optional behaviors
- Leverage single-table or joined inheritance strategy consistently (document decision)

### Entity Behavior & Encapsulation

**Standard:** Entities are not anemic data models; they encapsulate business logic

**Required Methods:**
- **Getters/Setters:** All properties via JavaBean convention (JPA requirement)
- **Accessors with internal variants:** 
  - `getXxx()` (public) - returns immutable view or new collection
  - `getXxxInternal()` (protected) - raw access for persistence operations
  
  **Example:**
  ```java
  private Set<Specialty> specialties = new HashSet<>();
  
  public List<Specialty> getSpecialties() {
    return getSpecialtiesInternal().stream()
      .sorted(Comparator.comparing(NamedEntity::getName))
      .collect(Collectors.toList());
  }
  
  protected Set<Specialty> getSpecialtiesInternal() {
    return specialties;
  }
  ```

- **Mutator helpers:** Encapsulate collection mutations
  - `addXxx(T item)` delegates to internal collection
  - Example: `pet.addVisit(visit)` instead of `pet.getVisits().add(visit)`

**Rationale:**
- Prevents external code from bypassing entity state management
- Maintains ORM contract integrity (JPA proxies, lazy loading)
- Defensive copying of collections prevents accidental mutations

### Collection Management

**Standard:** Use `LinkedHashSet` for one-to-many relationships; initialize eagerly

```java
@OneToMany(cascade = CascadeType.ALL, fetch = FetchType.EAGER)
@JoinColumn(name = "pet_id")
@OrderBy("visitDate ASC")
private Set<Visit> visits = new LinkedHashSet<>();
```

**Guidelines:**
- Preserve insertion order via `LinkedHashSet` (not `HashSet`)
- Prevent duplicates with Set data structure
- Apply `@OrderBy` for sorted DB queries; sort at access time for views
- Lazy-load collections that are not core to entity responsibilities
- Never expose raw collection references from public API

### JPA Relationship Configuration

**Standard:** Explicitly configure ORM metadata; avoid framework defaults

**Required Annotations:**
```java
// Many-to-One (foreign key reference)
@ManyToOne(fetch = FetchType.LAZY)
@JoinColumn(name = "pet_type_id", nullable = false)
private PetType type;

// One-to-Many (collection back-reference)
@OneToMany(cascade = CascadeType.ALL, fetch = FetchType.EAGER)
@JoinColumn(name = "owner_id")
private Set<Pet> pets = new LinkedHashSet<>();

// Many-to-Many (join table)
@ManyToMany
@JoinTable(
  name = "vet_specialties",
  joinColumns = @JoinColumn(name = "vet_id"),
  inverseJoinColumns = @JoinColumn(name = "specialty_id")
)
private Set<Specialty> specialties = new LinkedHashSet<>();
```

**Guidelines:**
- Always specify `FetchType.LAZY` for non-critical relationships
- Use `FetchType.EAGER` only for deeply accessed collections (e.g., Pet.visits for Owner detail page)
- Apply `CascadeType.ALL` for parent-owned collections; `CascadeType.NONE` for shared entities
- Document rationale for each cascade/fetch decision in JavaDoc

---

## Controller Layer (Spring Web)

### Constructor Injection Pattern

**Standard:** Mandatory for all `@Controller` and `@Service` classes

```java
@Controller
public class OwnerController {
  private final OwnerRepository owners;
  private final PetTypeRepository types;
  
  public OwnerController(OwnerRepository owners, PetTypeRepository types) {
    this.owners = owners;
    this.types = types;
  }
}
```

**Guidelines:**
- All dependencies injected via constructor (not `@Autowired` on fields)
- Store as `private final` fields for immutability
- Single constructor per class; Spring auto-discovers
- Maximum 4-5 dependencies per constructor (signal for refactoring if exceeded)

**Rationale:** 
- Enables easy mock injection in tests
- Ensures immutability and thread-safety
- Makes dependencies explicit and non-nullable

### Request Mapping with Modern Spring Annotations

**Standard:** Use `@GetMapping`, `@PostMapping` (Spring 5.0+) instead of `@RequestMapping`

```java
@GetMapping("/owners/{ownerId}")
public String showOwner(@PathVariable("ownerId") int ownerId, Model model) { ... }

@PostMapping("/owners/{ownerId}/pets/new")
public String processCreationForm(@Valid Pet pet, BindingResult result, 
                                   @PathVariable int ownerId, 
                                   RedirectAttributes redirectAttributes) { ... }

@GetMapping("/owners")
public String processFindForm(@RequestParam(defaultValue = "1") int page, Model model) { ... }
```

**Guidelines:**
- Use `@PathVariable` for resource identifiers in URL path
- Use `@RequestParam` with explicit `defaultValue` for optional query parameters
- Declare defaults declaratively (avoid null checks in method body)
- Return `String` view name for MVC rendering; avoid raw Model

### Two-Stage Form Validation

**Standard:** JSR-380 bean validation + business logic validation in controller

```java
@PostMapping("/owners")
public String processCreationForm(@Valid Owner owner, BindingResult result,
                                   RedirectAttributes redirectAttributes) {
  // Stage 1: @Valid constraint checking (automatic via BindingResult)
  
  // Stage 2: Business logic validation
  if (result.hasErrors()) {
    return "owners/createOrUpdateOwnerForm";
  }
  
  // Check business rules (e.g., uniqueness, immutability)
  if (ownerExists(owner.getLastName())) {
    result.rejectValue("lastName", "duplicate", "Owner with this last name already exists");
    return "owners/createOrUpdateOwnerForm";
  }
  
  owners.save(owner);
  redirectAttributes.addFlashAttribute("message", "Owner created successfully");
  return "redirect:/owners";
}
```

**Guidelines:**
- Place `@Valid` annotation on model object parameter
- Always check `result.hasErrors()` before persisting
- Use `result.rejectValue(fieldName, errorCode, message)` for field-level errors
- Never throw exceptions for validation failures; use `BindingResult` accumulation
- Flash attributes carry validation feedback across POST-Redirect-GET

**Rationale:**
- Separates cross-cutting constraint checks (annotations) from domain-specific rules
- Single error report accumulation; user sees all failures simultaneously
- Prevents form resubmission via redirect pattern

### Field Binding Security (Whitelist Pattern)

**Standard:** Explicitly disallow sensitive fields from mass assignment

```java
@Controller
public class OwnerController {
  @InitBinder
  public void setAllowedFields(WebDataBinder dataBinder) {
    dataBinder.setDisallowedFields("id");  // Prevent ID override
  }
}
```

**Guidelines:**
- Block fields that should not be user-editable (ID, createdDate, role, etc.)
- Use `setDisallowedFields()` to blacklist sensitive properties
- Apply per-controller or globally via `@ControllerAdvice`
- Document rationale for each blocked field in JavaDoc

**Rationale:** Prevents unauthorized privilege escalation via hidden form fields or API calls.

### Post-Redirect-Get (PRG) Pattern

**Standard:** Use `RedirectAttributes` to carry messages across redirects

```java
@PostMapping("/owners")
public String processCreationForm(@Valid Owner owner, BindingResult result,
                                   RedirectAttributes redirectAttributes) {
  if (result.hasErrors()) {
    redirectAttributes.addFlashAttribute("owner", owner);
    redirectAttributes.addFlashAttribute("errors", result);
    return "redirect:/owners/new";
  }
  
  owners.save(owner);
  redirectAttributes.addFlashAttribute("message", "Owner created successfully");
  return "redirect:/owners/" + owner.getId();
}
```

**Guidelines:**
- Always redirect on successful POST (prevents form resubmission)
- Use `addFlashAttribute()` for one-time messages (session-scoped, cleared after render)
- Carry validation error objects if returning to form
- Flash attributes cleaned automatically; no manual session management

**Rationale:** Prevents duplicate submissions; improves UX with persistent feedback.

### Resource Not Found Error Handling

**Standard:** Use `Optional.orElseThrow()` for repository lookups

```java
private Owner findOwner(int ownerId) {
  return this.owners.findById(ownerId)
    .orElseThrow(() -> new IllegalArgumentException("Owner not found: " + ownerId));
}

public String showOwner(@PathVariable int ownerId, Model model) {
  Owner owner = findOwner(ownerId);
  model.addAttribute("