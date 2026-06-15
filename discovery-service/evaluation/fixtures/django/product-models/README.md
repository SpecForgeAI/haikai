# product-models

- **Source**: https://github.com/saleor/saleor @ b40f4635e155ecfe07bd914dad53f1cd304c4c5d
- **License**: BSD-3-Clause
- **Original upstream path**: saleor/product/models.py
- **Category**: happy path (product catalog with MPTT hierarchy)

## Why this fixture

Large domain-model file covering Saleor's product catalog: Product,
ProductVariant, ProductType, Category, CollectionChannelListing,
VariantMedia. Exercises the adapter across a broader surface:
declared `ForeignKey` / `ManyToManyField` / `OneToOneField`
relationships, `ImageField`, `DecimalField`, `JSONField`,
`PositiveIntegerField`, plus `class Meta` ordering / verbose_name /
app_label metadata. 23 candidates emitted (3 entities, 13 attributes,
7 relationships).

## Notes

- Potential LLM gap-fill targets: many models inherit from
  `ModelWithMetadata` (imported intermediate base) — the adapter
  emits only the directly `models.Model`-derived classes in this
  file; walking cross-file inheritance is a deferred capability.
  Custom `manager`/`objects` overrides, `SortableModel` chain, and
  `__str__` overrides are also invisible.
