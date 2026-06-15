# pet-validator

- **Source**: https://github.com/spring-projects/spring-petclinic @ edf4db28affcc4741c79850a3d95bc3f177b5ff9
- **License**: Apache-2.0
- **Original upstream path**: src/main/java/org/springframework/samples/petclinic/owner/PetValidator.java
- **Category**: edge case (Spring `Validator` — business_logic inference via name suffix)

## Why this fixture

PetValidator implements `org.springframework.validation.Validator` but is
NOT annotated `@Service`. The adapter's business-logic emission path falls
through to a name-suffix match (`/(Service|Provider|Manager|Validator)$/`)
and emits the public methods `validate` and `supports` as `business_logic`
candidates. This fixture locks in the suffix-based inference behaviour.

## Notes

- 2 business_logic candidates (no interface / entity).
- Private helper methods are not emitted — only `public` methods qualify.
- If this class gains a `@Service` annotation upstream the expected
  candidate set would remain the same (both paths converge).
