# Triage Report — java-petclinic

Total files: 47


## SKIP (22 files)

- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/PetClinicApplication.java`
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/model/BaseEntity.java`
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/model/NamedEntity.java`
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/model/Person.java`
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/model/package-info.java`
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/owner/OwnerRepository.java`
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/owner/PetType.java`
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/owner/PetTypeRepository.java`
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/owner/Visit.java`
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/owner/package-info.java`
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/package-info.java`
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/system/CacheConfiguration.java`
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/system/CrashController.java`
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/system/WelcomeController.java`
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/system/package-info.java`
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/vet/Specialty.java`
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/vet/VetRepository.java`
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/vet/Vets.java`
- `/tmp/test-java-petclinic/src/main/java/org/springframework/samples/petclinic/vet/package-info.java`
- `/tmp/test-java-petclinic/src/test/java/org/springframework/samples/petclinic/MysqlTestApplication.java`
- `/tmp/test-java-petclinic/src/test/java/org/springframework/samples/petclinic/service/EntityUtils.java`
- `/tmp/test-java-petclinic/src/test/java/org/springframework/samples/petclinic/system/CrashControllerTests.java`

## ANALYZE (25 files)

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