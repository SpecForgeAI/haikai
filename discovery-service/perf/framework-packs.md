# Framework Pack Inventory (Planning)

Source: `C:\Users\gazwa\OneDrive\Documents\SDD_App\discovery_packs.xlsx` sheet "Framework Packs". The **planning
inventory** of framework packs the project intends to support, sized
by estimated share of real-world codebase coverage.

> **Important:** the `Framework Pack Name` column uses *aspirational*
> names (e.g. `spring-boot`, `react`). The **canonical registered pack
> IDs** in the discovery service codebase are sometimes more specific —
> e.g. `java-spring-boot`, `react-javascript` and `react-typescript`
> (split per language), `spring-classic` (Hibernate-era), etc. When
> wiring services for runs, use the canonical IDs from
> [`test-repos-projects.md`](./test-repos-projects.md) and the
> registered packs in
> `discovery-service/src/services/extensionPacks/frameworkPacks/`.
> Entries marked here that have no matching registered pack are
> *not yet implemented*.

| Framework Pack Name | Framework | Versions | Language Pack(s) | Estimated % | Notes |
|---|---|---|---|---|---|
| spring-boot | Spring Boot | 1.x / 2.x / 3.x | java-modern | 4.5 |  |
| react | React | 16+ (hooks + class) | javascript-modern, typescript | 4 |  |
| android-jetpack | Android SDK + Jetpack | all | java-modern, kotlin | 3 |  |
| wordpress | WordPress core + themes/plugins | 4.x / 5.x / 6.x | php-modern, php-legacy | 2.5 |  |
| asp-net-core | ASP.NET Core (MVC / Razor / Web API) | 2+ / 3+ / 5+ / 6+ / 7+ / 8+ | csharp-modern | 1.8 |  |
| django | Django | 1.x / 2+ / 3+ / 4+ / 5+ | python-3, python-2 | 1.8 |  |
| spring-classic | Spring Framework (classic, non-Boot) + Hibernate | 3.x / 4.x / 5.x | java-modern, java-legacy | 1.8 |  |
| flask | Flask | 0.x / 1+ / 2+ / 3+ | python-3, python-2 | 1.7 |  |
| rails | Ruby on Rails | 3+ / 4+ / 5+ / 6+ / 7+ | ruby-modern, ruby-legacy | 1.6 |  |
| jquery | jQuery | 1.x / 2.x / 3.x | javascript-es5, javascript-modern | 1.5 |  |
| batch-cobol | Batch COBOL + JCL | COBOL-74 / 85 / 2002 | cobol | 1.5 |  |
| angular-modern | Angular | 2+ (through 17+) | typescript | 1.4 |  |
| jakarta-ee | Jakarta EE / Java EE (Servlet/JSP/CDI/JAX-RS) | 5+ / 6+ / 7+ / 8+ / EE 9–10 | java-modern | 1.2 |  |
| laravel | Laravel | 5+ / 6+ / 7+ / 8+ / 9+ / 10+ / 11+ | php-modern | 1.2 |  |
| uikit | UIKit (iOS) | all | swift-modern, swift-legacy, objective-c | 1.2 |  |
| abap-erp | SAP R/3 ABAP (forms + tables + function modules) | 4.6C / 6.x / 7.x | abap | 1 |  |
| asp-net-framework | ASP.NET (MVC 3/4/5 + Web Forms) | .NET Fx 3.5 / 4.x | csharp-netfx, vb-net | 1 |  |
| vue | Vue.js | 2.x / 3.x | javascript-modern, typescript | 1 |  |
| express | Express.js | 3.x / 4.x / 5.x | javascript-modern, typescript | 1 |  |
| mfc-atl | MFC / ATL (Win32 C++) | all | cpp-legacy | 1 |  |
| fastapi | FastAPI | 0.x / 1+ | python-3 | 0.9 |  |
| vba-office | VBA (Excel / Access / Word macros) | all | vb-classic | 0.8 |  |
| cics-cobol | CICS (online transaction COBOL) | all | cobol | 0.8 |  |
| next | Next.js | 12+ / 13+ / 14+ (Pages + App router) | javascript-modern, typescript | 0.8 |  |
| unity-game | Unity engine + scripts | 2019+ / 2020+ / 2021+ / 6+ | csharp-modern | 0.8 |  |
| sql-server-procs | T-SQL stored procs + SSIS / SSRS | SQL Server 2008+ | sql-tsql | 0.8 |  |
| plsql-forms | Oracle PL/SQL packages + Forms / Reports / Apex | all | sql-plsql | 0.8 |  |
| vb6-classic | VB6 Classic apps | 6 | vb-classic | 0.8 |  |
| symfony | Symfony | 3+ / 4+ / 5+ / 6+ / 7+ | php-modern | 0.8 |  |
| go-stdlib-http | Go net/http + common mux (chi, gorilla) | all | go | 0.8 |  |
| j2ee-legacy | J2EE (EJB 2.x / Servlet 2.3 / Struts 1.x XML) | J2EE 1.2–1.4 | java-legacy, java-modern | 0.8 |  |
| hibernate-jpa | Hibernate + JPA (ORM overlay) | 3+ / 4+ / 5+ / 6+ | java-modern | 0.8 | Overlay pack — layers on top of spring-boot / jakarta-ee / struts |
| abap-s4 | SAP S/4HANA (CDS views + managed ABAP) | 1909+ / 2020+ / 2022+ | abap | 0.5 |  |
| delphi-vcl | Delphi VCL / FireMonkey | all | delphi-pascal | 0.6 |  |
| wpf-winforms | WPF / WinForms | .NET 3+ | csharp-netfx, csharp-modern, vb-net | 0.6 |  |
| cocoa-appkit | Cocoa / AppKit (macOS) | all | objective-c, swift-modern | 0.5 |  |
| struts | Apache Struts | 1.x / 2.x | java-legacy, java-modern | 0.5 |  |
| qt | Qt | 3 / 4 / 5 / 6 | cpp-legacy, cpp-modern | 0.5 |  |
| unreal | Unreal Engine (C++ gameplay layer) | 4 / 5 | cpp-modern | 0.5 |  |
| angular-js | AngularJS | 1.x | javascript-es5, javascript-modern | 0.5 |  |
| rpg-db2-400 | RPG on IBM i (DB2/400 + display files) | III / IV / free-form | rpg | 0.5 |  |
| pytorch | PyTorch (model + training code) | 1.x / 2.x | python-3 | 0.5 |  |
| flutter | Flutter SDK | 1.x / 2.x / 3.x | dart | 0.45 |  |
| tensorflow | TensorFlow (model + training) | 1.x / 2.x | python-3 | 0.4 |  |
| linux-kernel-driver | Linux kernel module / driver conventions | 2.6+ / 3+ / 4+ / 5+ / 6+ | c-classic, c-modern | 0.4 |  |
| xamarin-maui | Xamarin.Forms / .NET MAUI | all | csharp-modern, csharp-netfx | 0.3 |  |
| gradle-build | Gradle build DSL | 4+ / 5+ / 6+ / 7+ / 8+ | groovy, kotlin | 0.3 |  |
| gin-go | Gin | 1.x | go | 0.3 |  |
| terraform-modules | Terraform providers + modules | 0.12+ / 1.x | hcl-terraform | 0.25 |  |
| actix-axum | Actix-web / Axum | recent | rust | 0.25 |  |
| nestjs | NestJS | 7+ / 8+ / 9+ / 10+ | typescript | 0.2 |  |
| spark-bigdata | Apache Spark (Scala + PySpark) | 2.x / 3.x | scala-2, python-3 | 0.2 |  |
| akka | Akka | 2.x + | scala-2, java-modern | 0.15 |  |
| play-framework | Play | 2.x | scala-2, java-modern | 0.15 |  |
| ember | Ember.js | all | javascript-modern, typescript | 0.1 |  |
| nginx-openresty-lua | OpenResty + Lua modules | all | lua | 0.1 |  |
| ktor | Ktor | 1.x / 2.x | kotlin | 0.07 |  |
| vapor-swift | Vapor (server-side Swift) | 3.x / 4.x | swift-modern | 0.05 |  |
| magento | Magento (PHP e-commerce MVC) | 1.x / 2.x | php-legacy, php-modern | 0.3 |  |
| wxwidgets | wxWidgets cross-platform C++ GUI | 2.x / 3.x | cpp-legacy, cpp-modern | 0.1 |  |
| kratos | Kratos (Bilibili Go framework) | 1.x / 2.x | go | 0.05 | <0.05% |
| oatpp-framework | oat++ web framework | 1.x | cpp-modern | 0.01 | Very small footprint; included for completeness |
