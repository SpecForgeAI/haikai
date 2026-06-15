# Test Repos — Project / Service Inventory

Source of truth for the test-repo projects + services used by the
discovery performance scoring system. Maintained alongside the live
spreadsheet at `C:\Users\gazwa\OneDrive\Documents\SDD_App\discovery_packs.xlsx`
(sheet "Test Repos Projects"); regenerate this file when that sheet
changes, or update both in lockstep via `generate-pack-mds.py`.

Fields:

- **Name** — short repo / service name.
- **Repo URL** — GitHub HTTPS URL.
- **Language Pack Name** / **Framework Pack Name** — the **canonical
  registered pack IDs** that the discovery service uses (e.g.
  `java-lang`, `java-spring-boot`). When `Status` is `Skipped (no pack)`
  these columns hold the *desired* pack name that has not yet been
  registered.
- **Project Id** / **Service Id** — UUIDs in the architecture-model-service.
  Used in the run-start payload (`POST /discovery/runs`).
- **Repo Subfolder** — relative path inside the repo to scope the scan
  (e.g. `src/Web` for monorepos). Empty = whole repo.
- **Status** — `Created` / `Created (with leftovers)` / `Skipped (no pack)`
  for the 17-service test-repo seeding done on 2026-04-25.
- **Application Id** / **App Component Id** / **Filename** — internals of
  the architecture-model-service entity, populated when the seed script
  ran.

| Name | Repo URL | Language Pack Name | Framework Pack Name | Project Id | Service Id | Comment | Repo Subfolder | Status | Application Id | App Component Id | Filename |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Scenarios Frontend | github.com/garyjohnston83/scenarios | typescript-lang | react-typescript | b6e61465-a50e-4a97-b900-0d40c9a4a513 | svc-mo19xwmy-114u1 |  |  |  |  |  |  |
| Scenarios Service | github.com/garyjohnston83/scenarios | java-lang | java-spring-boot | b6e61465-a50e-4a97-b900-0d40c9a4a513 | svc-mo19xx2z-1nw9s |  |  |  |  |  |  |
| PetClinic | github.com/spring-projects/spring-petclinic | java-lang | java-spring-boot | fc3abaf2-19a5-466f-b3df-a6430183429e | svc-mob4f5ai-h4yfj | Working perfect according to LLM (deterministic pack get 100% and LLM doesn't add any shite) \| NOTE: project also contains leftover entities from a prior model file (svc-mo3c2kln-fq7e8). Manual cleanup recommended via UI. |  | Created (with leftovers) | app-moui8j1z-lo1sn | comp-moz5c2nc-6wye2 | test-repo-petclinic.json |
| nestjs-realworld | github.com/lujakob/nestjs-realworld-example-app | typescript-lang | nestjs | 747061c2-6975-429d-bcc8-9a8139dc9f8c | svc-mo8nsfj7-57h4r |  |  | Created | ? | ? | test-repo-nestjs-realworld.json |
| OpenMRS | github.com/openmrs/openmrs-core | java-lang | spring-classic | 332726ca-770c-495c-a811-da542e4e1a04 | svc-mo4mclfb-213cv |  |  |  |  |  |  |
| Saleor | github.com/saleor/saleor | python-lang | django | 918df920-c886-402b-86e6-b71dee92dcf0 | svc-mosqw9pa-5jlxc |  | saleor | Created | ? | ? | test-repo-saleor.json |
| react-redux-realworld | github.com/gothinkster/react-redux-realworld-example-app | javascript-lang | react-javascript | 9c6f0fb5-7a72-4eef-b868-cc18ac036a96 | svc-modrxy6b-4prqe |  |  | Created | ? | ? | test-repo-react-redux-realworld.json |
| angular-realworld | github.com/gothinkster/angular-realworld-example-app | typescript-lang | angular | 811f94be-b74a-4e83-a51e-699bf3f0e260 | svc-moyv6pl2-hxrbg |  |  | Created | ? | ? | test-repo-angular-realworld.json |
| WordPress | github.com/WordPress/WordPress | php-lang | wordpress | 71b0ee8f-d8ea-41a5-a582-700828819cc3 | svc-moat53u0-gfnwb |  |  | Created | ? | ? | test-repo-wordpress.json |
| eShopOnWeb | github.com/dotnet-architecture/eShopOnWeb | csharp-lang | asp-net-core | a5a015bd-2fe8-43cb-9b22-ed4e39668a42 | svc-mo7dpzyf-o4lac |  | src/Web | Created | ? | ? | test-repo-eshoponweb.json |
| flask-microblog | github.com/miguelgrinberg/microblog | python-lang | flask | 2a51d920-90ea-465b-a0a7-feb6aac509d1 | svc-mo2c3k9k-bdeas |  |  | Created | ? | ? | test-repo-flask-microblog.json |
| sunflower | github.com/android/sunflower | kotlin | android-jetpack | bd330813-93de-478f-a457-b2e98d4bfd97 |  | No kotlin language pack registered |  | Skipped (no pack) |  |  |  |
| Redmine | github.com/redmine/redmine | ruby-lang | rails | 6521e8ab-1ba1-4bf8-8119-baaef51dee07 | svc-mowyibpn-fecnk |  |  | Created | ? | ? | test-repo-redmine.json |
| Discourse | github.com/discourse/discourse | ruby-lang | rails | 5a4dc7b3-364d-4981-a494-953bd5f299cf | svc-mohrmmqz-ly0yn |  |  | Created | ? | ? | test-repo-discourse.json |
| beer-shop-go | github.com/go-kratos/beer-shop (likely) | go-lang | kratos | 0e828c3e-413b-4ccb-ad02-017dc260d018 | svc-moas6iuv-hh084 |  | app | Created | ? | ? | test-repo-beer-shop-go.json |
| OrangeHRM | github.com/orangehrm/orangehrm | php-lang | symfony | fd0fd396-22a0-4895-b8f8-e87cdca394df | svc-mo2fwkti-2tk93 |  | src | Created | ? | ? | test-repo-orangehrm.json |
| eShopLegacyMVC | https://github.com/dotnet-architecture/eShopModernizing.git | csharp-lang | asp-net-framework | c0dafafc-39b1-4ba2-a83a-54439dbf9f8a | svc-mofvde8z-j25k3 | NOTE: original dotnet-architecture/eShopLegacyMVC was retired into dotnet-architecture/eShopModernizing. Updated repo URL accordingly; subfolder eShopLegacyMVCSolution. | eShopLegacyMVCSolution | Created | ? | ? | test-repo-eshoplegacymvc.json |
| magento-lts | github.com/OpenMage/magento-lts | php-lang | magento | 05b60ec7-a462-4703-ba65-26605f41b6a6 | svc-moircdjc-oy1nl |  |  | Created | ? | ? | test-repo-magento-lts.json |
| jquery-ui | github.com/jquery/jquery-ui | javascript-lang | jquery | 94b7a050-a8f9-4d69-b1e3-6f8c8d9a00dd | svc-moaequpm-igk0k |  | ui | Created | ? | ? | test-repo-jquery-ui.json |
| cobol-programming-course | github.com/openmainframeproject/cobol-programming-course | cobol | batch-cobol | 964dfb09-dc01-4e54-b054-aae6e7ff8d00 |  | No cobol language pack registered |  | Skipped (no pack) |  |  |  |
| wxWidgets | github.com/wxWidgets/wxWidgets | cpp-lang | wxwidgets | d9a57446-81ab-49bb-b62b-b7b4fbb482e7 | svc-movs160z-hb5wg |  | src | Created | ? | ? | test-repo-wxwidgets.json |
| redis | github.com/redis/redis | c-classic |  | e273cb3d-ced9-42d4-858a-780784326424 |  | No C language pack registered |  | Skipped (no pack) |  |  |  |
| systemd | github.com/systemd/systemd | c-modern |  | 269e71b7-c8cc-4c12-bd0e-3268815b57b3 |  | No C language pack registered |  | Skipped (no pack) |  |  |  |
| oatpp-crud | github.com/oatpp/example-crud | cpp-lang | oatpp | 8e9d09e0-5b60-4355-9edd-4cab154e7eef | svc-mo0c8iab-58e5a |  | src | Created | ? | ? | test-repo-oatpp-crud.json |
