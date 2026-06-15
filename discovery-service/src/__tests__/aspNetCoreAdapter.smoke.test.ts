/**
 * Smoke test for the V3 ASP.NET Core pack pair.
 *
 * Spec: V3 Pack Migration Batch (Task Group 8)
 *
 * Migrated from direct `extractCSharpIR` + `runAspNetCoreAdapter`
 * invocation to the V3 pack shape: `csharpLangPack.extract` +
 * `aspNetCoreFrameworkPack.adapt`. All assertions are preserved
 * verbatim — only the invocation shape changes (find-and-replace
 * pattern established in Task Group 2's `springBootAdapter.smoke.test.ts`
 * and re-used in Task Group 4's `djangoAdapter.smoke.test.ts`,
 * Task Group 5's `railsAdapter.smoke.test.ts`, Task Group 6's PHP
 * smoke tests, and Task Group 7's `kratosAdapter.smoke.test.ts`).
 */
import { csharpLangPack } from '../services/extensionPacks/languagePacks/csharpLangPack';
import { aspNetCoreFrameworkPack } from '../services/extensionPacks/frameworkPacks/aspNetCoreFrameworkPack';
import type { TechHints } from '../services/extensionPacks';

const ASP_NET_CORE_HINTS: TechHints = {
  '0': { language: 'C#' },
  '1': { technology: 'ASP.NET Core' },
};

const CONTROLLER_SRC = `
using Microsoft.AspNetCore.Mvc;

namespace Shop.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ProductsController : ControllerBase
{
    [HttpGet]
    public ActionResult<List<ProductDto>> GetAll() => null;

    [HttpGet("{id}")]
    public ActionResult<ProductDto> GetOne(int id) => null;

    [HttpPost]
    public ActionResult<ProductDto> Create([FromBody] CreateProductDto dto) => null;
}
`;

const DBCONTEXT_SRC = `
using Microsoft.EntityFrameworkCore;

public class ShopDbContext : DbContext {
    public DbSet<Product> Products { get; set; }
    public DbSet<Order> Orders { get; set; }
}
`;

const ENTITY_SRC = `
using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

[Table("products")]
public class Product {
    [Key]
    public int Id { get; set; }
    [Column("name")]
    public string Name { get; set; }
    public decimal Price { get; set; }
    [NotMapped]
    public string DisplayName { get; set; }
}
`;

const DTO_SRC = `
public class ProductDto {
    public int Id { get; set; }
    public string Name { get; set; }
}
public class CreateProductDto {
    public string Name { get; set; }
    public decimal Price { get; set; }
}
`;

/**
 * Helper: run the full V3 pipeline (extract + adapt) for a set of file
 * sources. Mirrors the earlier "build IR list, then run adapter" two-step
 * shape but goes through `csharpLangPack` + `aspNetCoreFrameworkPack`.
 */
function runV3Pipeline(files: Map<string, string>, runId: string) {
  const irFiles = csharpLangPack.extract(files, ASP_NET_CORE_HINTS);
  return aspNetCoreFrameworkPack.adapt(irFiles, runId, ASP_NET_CORE_HINTS);
}

describe('ASP.NET Core V3 pack pair smoke tests', () => {
  let files: Map<string, string>;

  beforeAll(() => {
    files = new Map<string, string>([
      ['Controllers/ProductsController.cs', CONTROLLER_SRC],
      ['Data/ShopDbContext.cs', DBCONTEXT_SRC],
      ['Models/Product.cs', ENTITY_SRC],
      ['Dto/ProductDto.cs', DTO_SRC],
    ]);
  });

  it('emits interface for [ApiController] class', () => {
    const c = runV3Pipeline(files, 'ac-smoke');
    const ifaces = c.filter((x) => x.candidateType === 'interfaces').map((i) => i.name);
    expect(ifaces).toContain('ProductsController');
  });

  it('emits endpoints with full path [controller] substitution', () => {
    const c = runV3Pipeline(files, 'ac-smoke');
    const eps = c.filter((x) => x.candidateType === 'endpoints').map((e) => e.name).sort();
    expect(eps).toContain('GET /api/Products');
    expect(eps).toContain('GET /api/Products/{id}');
    expect(eps).toContain('POST /api/Products');
  });

  it('emits physical_entity for each DbSet<T> in DbContext', () => {
    const c = runV3Pipeline(files, 'ac-smoke');
    const ents = c.filter((x) => x.candidateType === 'physical_data_entities').map((e) => e.name).sort();
    expect(ents).toContain('Order');
    expect(ents).toContain('Product');
  });

  it('emits physical_attribute for [Key] / [Column] fields', () => {
    const c = runV3Pipeline(files, 'ac-smoke');
    const attrs = c.filter((x) => x.candidateType === 'physical_data_attributes' && x.data.entityClassName === 'Product');
    const names = attrs.map((a) => a.name).sort();
    expect(names).toEqual(['Id', 'Name', 'Price']); // DisplayName has [NotMapped]
    expect(attrs.find((a) => a.name === 'Id')!.data.isPrimaryKey).toBe(true);
  });

  it('emits logical_entity for DTOs referenced in controller', () => {
    const c = runV3Pipeline(files, 'ac-smoke');
    const logs = c.filter((x) => x.candidateType === 'logical_data_entities').map((l) => l.name).sort();
    expect(logs).toContain('CreateProductDto');
    expect(logs).toContain('ProductDto');
  });
});
