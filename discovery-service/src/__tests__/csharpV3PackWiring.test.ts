/**
 * Focused V3-wiring tests for the C# stack migration.
 *
 * Spec: V3 Pack Migration Batch (Task Group 8, task 8.1)
 *
 * Scope: verify the structural wiring of the V3 C# stack — the
 * LanguagePack extracts IR, the FrameworkPack produces candidates off
 * that IR, and registration does not collide with other language /
 * framework packs. Full adapter-behaviour coverage lives in the
 * migrated smoke tests (`aspNetCoreAdapter.smoke.test.ts`) and in the
 * per-pack 98% evaluation gate.
 */
import { csharpLangPack } from '../services/extensionPacks/languagePacks/csharpLangPack';
import { aspNetCoreFrameworkPack } from '../services/extensionPacks/frameworkPacks/aspNetCoreFrameworkPack';
import { aspNetFrameworkFrameworkPack } from '../services/extensionPacks/frameworkPacks/aspNetFrameworkFrameworkPack';
import { javaLangPack } from '../services/extensionPacks/languagePacks/javaLangPack';
import { typescriptLangPack } from '../services/extensionPacks/languagePacks/typescriptLangPack';
import { pythonLangPack } from '../services/extensionPacks/languagePacks/pythonLangPack';
import { rubyLangPack } from '../services/extensionPacks/languagePacks/rubyLangPack';
import { phpLangPack } from '../services/extensionPacks/languagePacks/phpLangPack';
import { goLangPack } from '../services/extensionPacks/languagePacks/goLangPack';
import type { TechHints } from '../services/extensionPacks';

const ASP_NET_CORE_HINTS: TechHints = {
  '0': { language: 'C#' },
  '1': { technology: 'ASP.NET Core' },
};

const ASP_NET_FRAMEWORK_HINTS: TechHints = {
  '0': { language: 'C#' },
  '1': { technology: 'ASP.NET' },
};

describe('C# V3 pack wiring', () => {
  it('csharpLangPack.extract produces IR for a seeded .cs file', () => {
    const files = new Map<string, string>([
      [
        'Controllers/ProductsController.cs',
        `using Microsoft.AspNetCore.Mvc;

namespace Shop.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ProductsController : ControllerBase
{
    [HttpGet]
    public ActionResult<List<ProductDto>> GetAll() => null;
}
`,
      ],
    ]);
    const irMap = csharpLangPack.extract(files, ASP_NET_CORE_HINTS);
    expect(irMap.size).toBe(1);
    const ir = irMap.get('Controllers/ProductsController.cs')!;
    expect(ir.language).toBe('csharp');
    expect(ir.classes.map((c) => c.name)).toContain('ProductsController');
    // Namespace is captured.
    expect(ir.packageOrNamespace).toBe('Shop.Controllers');
  });

  it('csharpLangPack skips test-file paths and /bin/ /obj/ build outputs', () => {
    const files = new Map<string, string>([
      [
        'src/Domain/Foo.cs',
        `namespace Domain;

public class Foo { public int Id { get; set; } }
`,
      ],
      [
        // /tests/ path — filtered by isCSharpTestFile.
        'tests/Domain/FooTests.cs',
        `namespace Domain.Tests;

public class FooTests { public void TestFoo() {} }
`,
      ],
      [
        // *Tests.cs filename suffix — filtered by isCSharpTestFile.
        'src/Domain/BarTests.cs',
        `namespace Domain;

public class BarTests { public void TestBar() {} }
`,
      ],
      [
        // /bin/ build output — filtered by filterCSharpFiles.
        'src/bin/Debug/Generated.cs',
        `namespace Domain.Generated;

public class Generated {}
`,
      ],
      [
        // /obj/ build output — filtered by filterCSharpFiles.
        'src/obj/Release/Snapshot.cs',
        `namespace Domain.Generated;

public class Snapshot {}
`,
      ],
    ]);
    const irMap = csharpLangPack.extract(files, ASP_NET_CORE_HINTS);
    // Only the non-test, non-build-output Foo.cs should make it through.
    expect([...irMap.keys()]).toEqual(['src/Domain/Foo.cs']);
  });

  it('aspNetCoreFrameworkPack.adapt produces controller + endpoint + entity candidates off seeded IR', () => {
    const files = new Map<string, string>([
      [
        'Controllers/ProductsController.cs',
        `using Microsoft.AspNetCore.Mvc;

namespace Shop.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ProductsController : ControllerBase
{
    [HttpGet]
    public ActionResult<List<ProductDto>> GetAll() => null;

    [HttpPost]
    public ActionResult<ProductDto> Create([FromBody] CreateProductDto dto) => null;
}
`,
      ],
      [
        'Data/ShopDbContext.cs',
        `using Microsoft.EntityFrameworkCore;

namespace Shop.Data;

public class ShopDbContext : DbContext {
    public DbSet<Product> Products { get; set; }
    public DbSet<Order> Orders { get; set; }
}
`,
      ],
    ]);
    const irMap = csharpLangPack.extract(files, ASP_NET_CORE_HINTS);
    const candidates = aspNetCoreFrameworkPack.adapt(
      irMap,
      'wiring-test',
      ASP_NET_CORE_HINTS,
    );

    // Interface for [ApiController].
    const ifaces = candidates.filter((c) => c.candidateType === 'interfaces');
    expect(ifaces.map((i) => i.name)).toContain('ProductsController');

    // Endpoints for [HttpGet] + [HttpPost] action methods.
    const eps = candidates.filter((c) => c.candidateType === 'endpoints');
    expect(eps.map((e) => e.name).sort()).toEqual([
      'GET /api/Products',
      'POST /api/Products',
    ]);

    // Physical entities for DbSet<Product> + DbSet<Order>.
    const ents = candidates
      .filter((c) => c.candidateType === 'physical_data_entities')
      .map((e) => e.name)
      .sort();
    expect(ents).toContain('Order');
    expect(ents).toContain('Product');

    // `_addedBy` tag preserved from V2 (aspnetcore-adapter).
    expect(ifaces[0].data._addedBy).toBe('aspnetcore-adapter');
  });

  it('aspNetFrameworkFrameworkPack.adapt produces candidates with framework-specific provenance tag', () => {
    const files = new Map<string, string>([
      [
        // MVC 5 controller: extends Controller (no [ApiController] attribute).
        'Controllers/HomeController.cs',
        `using System.Web.Mvc;

namespace Legacy.Controllers;

public class HomeController : Controller
{
    [HttpGet]
    public ActionResult Index() => null;
}
`,
      ],
      [
        // Web API 2 controller: extends ApiController (suffix matches).
        'Controllers/Api/UsersApiController.cs',
        `using System.Web.Http;

namespace Legacy.Controllers.Api;

[Route("api/[controller]")]
public class UsersApiController : ApiController
{
    [HttpGet]
    public IHttpActionResult GetAll() => null;
}
`,
      ],
    ]);
    const irMap = csharpLangPack.extract(files, ASP_NET_FRAMEWORK_HINTS);
    const candidates = aspNetFrameworkFrameworkPack.adapt(
      irMap,
      'wiring-test',
      ASP_NET_FRAMEWORK_HINTS,
    );

    // Both controllers detected via the suffix regex (Controller / ApiController
    // both end in `Controller`).
    const ifaces = candidates.filter((c) => c.candidateType === 'interfaces');
    expect(ifaces.map((i) => i.name).sort()).toEqual([
      'HomeController',
      'UsersApiController',
    ]);

    // _addedBy tag swapped to aspnet-framework-adapter (distinguishable
    // provenance vs aspnetcore-adapter).
    for (const iface of ifaces) {
      expect(iface.data._addedBy).toBe('aspnet-framework-adapter');
    }
  });

  it('pack ids are distinct and do not collide with other LanguagePacks / FrameworkPacks', () => {
    // LanguagePack ids must be globally unique so the registry does not
    // double-register. FrameworkPack ids must be unique across packs.
    expect(csharpLangPack.id).toBe('csharp-lang');
    expect(javaLangPack.id).toBe('java-lang');
    expect(typescriptLangPack.id).toBe('typescript-lang');
    expect(pythonLangPack.id).toBe('python-lang');
    expect(rubyLangPack.id).toBe('ruby-lang');
    expect(phpLangPack.id).toBe('php-lang');
    expect(goLangPack.id).toBe('go-lang');
    const langIds = new Set([
      csharpLangPack.id,
      javaLangPack.id,
      typescriptLangPack.id,
      pythonLangPack.id,
      rubyLangPack.id,
      phpLangPack.id,
      goLangPack.id,
    ]);
    expect(langIds.size).toBe(7);

    expect(aspNetCoreFrameworkPack.id).toBe('asp-net-core');
    expect(aspNetFrameworkFrameworkPack.id).toBe('asp-net-framework');
    expect(aspNetCoreFrameworkPack.id).not.toBe(aspNetFrameworkFrameworkPack.id);
  });

  it('csharpLangPack does NOT match .java or other non-C# source files (extension filter)', () => {
    // A file map containing only a .java file and a .py file should yield
    // an empty IR map even when the C# hint is present — the language
    // pack filters by extension first.
    const files = new Map<string, string>([
      ['src/Foo.java', 'package foo; public class Foo {}'],
      ['src/bar.py', 'class Bar: pass'],
      ['src/baz.rb', 'class Baz; end'],
    ]);
    const irMap = csharpLangPack.extract(files, ASP_NET_CORE_HINTS);
    expect(irMap.size).toBe(0);
  });

  it('aspNetCoreFrameworkPack predicate requires both C# + ASP.NET Core; aspNetFrameworkFrameworkPack predicate requires both C# + ASP.NET', () => {
    expect(aspNetCoreFrameworkPack.when).toEqual({
      language: 'C#',
      technology: 'ASP.NET Core',
    });
    expect(aspNetFrameworkFrameworkPack.when).toEqual({
      language: 'C#',
      technology: 'ASP.NET',
    });
    // Predicates differ — the two C# framework packs must NOT both match
    // the same techHints set.
    expect(aspNetCoreFrameworkPack.when.technology).not.toBe(
      aspNetFrameworkFrameworkPack.when.technology,
    );
  });
});
