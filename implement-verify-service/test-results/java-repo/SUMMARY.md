# Java Extraction Test: iluwatar/java-design-patterns

**Repo:** https://github.com/iluwatar/java-design-patterns
**Total .java files in repo:** 1,877
**Files analyzed:** 50 (first 50 alphabetically)
**Errors:** 0

## Results

| Metric | Count |
|--------|------:|
| Calls extracted | 376 |
| Imports extracted | 94 |
| Assignments extracted | 101 |
| Unique methods | 112 |
| Unique modules | 14 |

## Top 20 Called Methods

| Method | Count |
|--------|------:|
| assertEquals | 26 |
| info | 24 |
| toString | 22 |
| getDescription | 18 |
| assertTrue | 15 |
| get | 14 |
| of | 13 |
| put | 10 |
| createKingdom | 10 |
| append | 9 |
| orElseThrow | 7 |
| getActorId | 7 |
| getArmy | 6 |
| getCastle | 6 |
| getKing | 6 |
| getKingdom | 5 |
| ofNullable | 4 |
| getModel | 4 |
| getPrice | 4 |
| new DocumentImplementation | 4 |

## Top Imported Modules

| Module | Count |
|--------|------:|
| java.util | 23 |
| org.junit.jupiter.api.Assertions | 9 |
| lombok | 9 |
| lombok.extern.slf4j | 8 |
| org.junit.jupiter.api | 8 |
| java.util.concurrent | 7 |

## Observations

- Fluent builder chains (Stream API) correctly decomposed into individual method calls
- Constructor calls (`new DocumentImplementation`, `new StringBuilder`) correctly detected
- Static method calls (`assertEquals`, `assertTrue`) extracted with correct class scope
- Lombok annotations don't interfere with extraction
- Zero parse errors across 50 files
