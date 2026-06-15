# Structural Analysis Standards

## Overview

- **Files analyzed:** 47
- **Total symbols:** 479 (212 variable, 173 method, 47 module, 44 class, 3 interface)
- **Total call edges:** 1251
- **Total imports:** 427
- **Inheritance chains:** 17

## Languages

- Java: 47 files

## Frameworks & Libraries

- **Spring** (web) — 227 files, confidence 1.0
- **JUnit** (testing) — 40 files, confidence 1.0
- **Mockito** (testing) — 13 files, confidence 0.55

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

## Inheritance

- BaseEntity → Serializable
- NamedEntity → BaseEntity
- Owner → Person
- OwnerRepository → JpaRepository
- Person → BaseEntity
- Pet → NamedEntity
- PetClinicRuntimeHints → RuntimeHintsRegistrar
- PetType → NamedEntity
- PetTypeFormatter → Formatter
- PetTypeRepository → JpaRepository
- PetValidator → Validator
- PropertiesLogger → ApplicationListener
- Specialty → NamedEntity
- Vet → Person
- VetRepository → Repository
- Visit → BaseEntity
- WebConfiguration → WebMvcConfigurer

## Triage Summary

- **Trivial files (SKIP):** 22
- **Complex files (ANALYZE):** 25

Complex files:
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/PetClinicRuntimeHints.java` (complexity: 0.39)
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/owner/Owner.java` (complexity: 0.62)
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/owner/OwnerController.java` (complexity: 0.53)
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/owner/Pet.java` (complexity: 0.35)
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/owner/PetController.java` (complexity: 0.53)
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/owner/PetTypeFormatter.java` (complexity: 0.32)
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/owner/PetValidator.java` (complexity: 0.35)
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/owner/VisitController.java` (complexity: 0.46)
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/system/WebConfiguration.java` (complexity: 0.35)
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/vet/Vet.java` (complexity: 0.45)
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/vet/VetController.java` (complexity: 0.48)
- `/tmp/test-java-petclinic/src/test/java/org/springframework/samples/petclinic/MySqlIntegrationTests.java` (complexity: 0.41)
- `/tmp/test-java-petclinic/src/test/java/org/springframework/samples/petclinic/PetClinicIntegrationTests.java` (complexity: 0.48)
- `/tmp/test-java-petclinic/src/test/java/org/springframework/samples/petclinic/PostgresIntegrationTests.java` (complexity: 0.65)
- `/tmp/test-java-petclinic/src/test/java/org/springframework/samples/petclinic/model/ValidatorTests.java` (complexity: 0.43)
- `/tmp/test-java-petclinic/src/test/java/org/springframework/samples/petclinic/owner/OwnerControllerTests.java` (complexity: 0.53)
- `/tmp/test-java-petclinic/src/test/java/org/springframework/samples/petclinic/owner/PetControllerTests.java` (complexity: 0.6)
- `/tmp/test-java-petclinic/src/test/java/org/springframework/samples/petclinic/owner/PetTypeFormatterTests.java` (complexity: 0.48)
- `/tmp/test-java-petclinic/src/test/java/org/springframework/samples/petclinic/owner/PetValidatorTests.java` (complexity: 0.53)
- `/tmp/test-java-petclinic/src/test/java/org/springframework/samples/petclinic/owner/VisitControllerTests.java` (complexity: 0.47)
- `/tmp/test-java-petclinic/src/test/java/org/springframework/samples/petclinic/service/ClinicServiceTests.java` (complexity: 0.53)
- `/tmp/test-java-petclinic/src/test/java/org/springframework/samples/petclinic/system/CrashControllerIntegrationTests.java` (complexity: 0.49)
- `/tmp/test-java-petclinic/src/test/java/org/springframework/samples/petclinic/system/I18nPropertiesSyncTest.java` (complexity: 0.53)
- `/tmp/test-java-petclinic/src/test/java/org/springframework/samples/petclinic/vet/VetControllerTests.java` (complexity: 0.48)
- `/tmp/test-java-petclinic/src/test/java/org/springframework/samples/petclinic/vet/VetTests.java` (complexity: 0.35)

## Structural Practices

- Object-oriented design (class-based)
- Inheritance-based polymorphism
- High inter-module coupling (many call edges)
