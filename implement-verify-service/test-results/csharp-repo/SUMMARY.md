# C# Extraction Test: dotnet/eShop

**Repo:** https://github.com/dotnet/eShop
**Total .cs files in repo:** 527
**Files analyzed:** 50 (first 50 alphabetically)
**Errors:** 0

## Results

| Metric | Count |
|--------|------:|
| Calls extracted | 799 |
| Imports extracted | 105 |
| Assignments extracted | 75 |
| Unique methods | 218 |
| Unique modules | 39 |

## Top 20 Called Methods

| Method | Count |
|--------|------:|
| HasColumnType | 79 |
| Property\<int\> | 48 |
| IsRequired | 24 |
| Property\<string\> | 24 |
| Entity | 18 |
| ToTable | 17 |
| WithDescription | 16 |
| WithSummary | 16 |
| WithName | 16 |
| HasMaxLength | 15 |
| WithTags | 14 |
| ValueGeneratedOnAdd | 14 |
| HasKey | 14 |
| MapGet | 12 |
| HasIndex | 12 |
| LogInformation | 11 |
| Select | 10 |
| WithMany | 10 |
| HasOne | 10 |
| Column\<int\> | 10 |

## Top Imported Modules

| Module | Count |
|--------|------:|
| Pgvector | 10 |
| Microsoft.EntityFrameworkCore | 10 |
| System | 8 |
| eShop.Basket.API | 7 |
| eShop.Catalog.API | 7 |
| Npgsql.EntityFrameworkCore.PostgreSQL | 5 |
| System.Text.Json | 4 |

## Observations

- Entity Framework fluent API chains (HasColumnType, Property, IsRequired) correctly decomposed
- Generic method calls (`Property<int>`, `Property<string>`) extracted with type parameters
- ASP.NET minimal API patterns (`MapGet`, `WithTags`, `WithDescription`) correctly captured
- gRPC service methods (GetBasket, UpdateBasket) with full class scope
- `global using` directives parsed (prefixed with "global")
- LINQ expressions (Select, Where) correctly extracted as method calls
- Zero parse errors across 50 files
