"""
Idempotent edits to frontend/src/config/gridConfigs.ts for spec 7.

Tasks:
- Extend defaults import with 4 new picklist arrays consumed by the 2 new grids
  (iacSourceTypeOptions, repositoryProviderOptions, iacSourceProviderOptions,
   bindingStatusOptions).
- Append 2 new gridConfigs entries (iac_sources, iac_resource_bindings) at the
  end of the gridConfigs object literal.
- tabToEntityType:    append 'IaC Sources' -> 'iac_sources'
- relationshipTabToType: append 'IaC Resource Bindings' -> 'iac_resource_bindings'
- entityTabNames:     append 'IaC Sources'
- domainGroupings.infrastructure: append 'IaC Sources'
- DOMAIN_ENTITY_TYPES.infrastructure: append 'iac_sources'
- relationshipTabNames: append 'IaC Resource Bindings'
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
GC = ROOT / "frontend/src/config/gridConfigs.ts"

NEW_IMPORTS_BLOCK = """  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 new picklist arrays
  deploymentRoleOptions,
  hostingRoleOptions,
  dependencyTypeOptions,
  accessModeOptions,
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 4 new picklist arrays consumed by grids
  iacSourceTypeOptions,
  repositoryProviderOptions,
  iacSourceProviderOptions,
  bindingStatusOptions,
} from './defaults';"""

OLD_IMPORTS_BLOCK = """  // Spec 2026-05-05: Infrastructure Cross-Domain Integration - 4 new picklist arrays
  deploymentRoleOptions,
  hostingRoleOptions,
  dependencyTypeOptions,
  accessModeOptions,
} from './defaults';"""

NEW_GRIDS = """  // ============================================================================
  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 2 new gridConfigs
  // - iac_sources: entity-shaped grid (full envelope: name/description/tags + 13 source-specific
  //   fields). `name` is required. Repository / module / commit / provider / timestamp
  //   columns track the IaC source-of-record.
  // - iac_resource_bindings: relationship-shaped grid binding an Infrastructure entity
  //   (via the polymorphic infrastructure_point_picker - NO `allowedKinds` restriction
  //   per spec 7) to a current/future IaC resource address. `infrastructure_point_id`
  //   and `iac_source_id` are required. `confidence` / `start_line` / `end_line` use
  //   numeric-as-text per spec 4 precedent.
  // ============================================================================
  iac_sources: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 120, autoGenerate: true },
    { field: 'name', displayName: 'Name', cellType: 'text', required: true, width: 200 },
    { field: 'source_type', displayName: 'Source Type', cellType: 'dropdown', required: false, width: 160, options: iacSourceTypeOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'provider', displayName: 'Provider', cellType: 'dropdown', required: false, width: 140, options: iacSourceProviderOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'repository_url', displayName: 'Repository URL', cellType: 'text', required: false, width: 240 },
    { field: 'repository_provider', displayName: 'Repository Provider', cellType: 'dropdown', required: false, width: 160, options: repositoryProviderOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'branch', displayName: 'Branch', cellType: 'text', required: false, width: 140 },
    { field: 'commit_sha', displayName: 'Commit SHA', cellType: 'text', required: false, width: 180 },
    { field: 'path', displayName: 'Path', cellType: 'text', required: false, width: 200 },
    { field: 'workspace', displayName: 'Workspace', cellType: 'text', required: false, width: 160 },
    { field: 'module_name', displayName: 'Module Name', cellType: 'text', required: false, width: 180 },
    { field: 'module_path', displayName: 'Module Path', cellType: 'text', required: false, width: 200 },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'environments' },
    { field: 'owner', displayName: 'Owner', cellType: 'text', required: false, width: 160 },
    { field: 'last_scanned_at', displayName: 'Last Scanned At', cellType: 'text', required: false, width: 180 },
    { field: 'last_imported_at', displayName: 'Last Imported At', cellType: 'text', required: false, width: 180 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
    { field: 'valid_from', displayName: 'Valid From', cellType: 'text', required: false, width: 100 },
    { field: 'valid_to', displayName: 'Valid To', cellType: 'text', required: false, width: 100 },
  ],
  iac_resource_bindings: [
    { field: 'id', displayName: 'ID', cellType: 'text', required: true, width: 100, autoGenerate: true },
    // NO `allowedKinds` restriction per spec 7 - bindings can target any of the 12 Infra entity kinds.
    { field: 'infrastructure_point_id', displayName: 'Infrastructure Point', cellType: 'infrastructure_point_picker', required: true, width: 280, fkTarget: 'infrastructure_points', displayFormatter: infrastructurePointDisplayFormatter },
    { field: 'iac_source_id', displayName: 'IaC Source', cellType: 'fk_typeahead', required: true, width: 220, fkTarget: 'iac_sources' },
    { field: 'environment_id', displayName: 'Environment', cellType: 'fk_typeahead', required: false, width: 200, fkTarget: 'environments' },
    { field: 'iac_address', displayName: 'IaC Address', cellType: 'text', required: false, width: 280 },
    { field: 'iac_resource_type', displayName: 'IaC Resource Type', cellType: 'text', required: false, width: 220 },
    { field: 'iac_resource_name', displayName: 'IaC Resource Name', cellType: 'text', required: false, width: 200 },
    { field: 'provider', displayName: 'Provider', cellType: 'dropdown', required: false, width: 140, options: iacSourceProviderOptions, formatOptionLabel: snakeCaseToTitleCase },
    { field: 'file_path', displayName: 'File Path', cellType: 'text', required: false, width: 240 },
    // Numeric-as-text per spec 4 precedent (start_line / end_line are INTEGER on backend).
    { field: 'start_line', displayName: 'Start Line', cellType: 'text', required: false, width: 100 },
    { field: 'end_line', displayName: 'End Line', cellType: 'text', required: false, width: 100 },
    { field: 'state_resource_id', displayName: 'State Resource ID', cellType: 'text', required: false, width: 220 },
    { field: 'external_id', displayName: 'External ID', cellType: 'text', required: false, width: 180 },
    { field: 'binding_status', displayName: 'Binding Status', cellType: 'dropdown', required: false, width: 160, options: bindingStatusOptions, formatOptionLabel: snakeCaseToTitleCase },
    // DECIMAL(4,3) on backend - numeric-as-text per spec 4 precedent.
    { field: 'confidence', displayName: 'Confidence', cellType: 'text', required: false, width: 100 },
    { field: 'last_seen_at', displayName: 'Last Seen At', cellType: 'text', required: false, width: 180 },
    { field: 'description', displayName: 'Description', cellType: 'text', required: false, width: 250 },
    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },
  ],
"""

OLD_GRIDCONFIGS_TAIL = (
    "  application_load_balancer_exposures: [\n"
)

# We'll do replacements that look for the LAST grid (application_load_balancer_exposures)
# and the closing `};` of the gridConfigs object literal. To target precisely we look for
# the unique closing pattern that comes right after the last column row of that grid.

OLD_OBJECT_CLOSE = (
    "    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },\n"
    "  ],\n"
    "};\n"
)
NEW_OBJECT_CLOSE = (
    "    { field: 'tags', displayName: 'Tags', cellType: 'tags', required: false, width: 200 },\n"
    "  ],\n"
    + NEW_GRIDS
    + "};\n"
)

OLD_TAB_TO_ENTITY_TYPE_END = "  'Infrastructure Points': 'infrastructure_points',\n};"
NEW_TAB_TO_ENTITY_TYPE_END = (
    "  'Infrastructure Points': 'infrastructure_points',\n"
    "  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness\n"
    "  'IaC Sources': 'iac_sources',\n"
    "};"
)

OLD_REL_TAB_TO_TYPE_END = "  'App <-> Load Balancer': 'application_load_balancer_exposures',\n};"
NEW_REL_TAB_TO_TYPE_END = (
    "  'App <-> Load Balancer': 'application_load_balancer_exposures',\n"
    "  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness\n"
    "  'IaC Resource Bindings': 'iac_resource_bindings',\n"
    "};"
)

OLD_ENTITY_TAB_NAMES_END = "  'Infrastructure Resources',\n];"
NEW_ENTITY_TAB_NAMES_END = (
    "  'Infrastructure Resources',\n"
    "  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness\n"
    "  'IaC Sources',\n"
    "];"
)

OLD_DOMAIN_GROUPINGS = (
    "  infrastructure: [\n"
    "    'Environments',\n"
    "    'Cloud Accounts',\n"
    "    'Locations',\n"
    "    'Networks',\n"
    "    'Subnets',\n"
    "    'Compute Clusters',\n"
    "    'Compute Resources',\n"
    "    'Deployment Units',\n"
    "    'Load Balancers',\n"
    "    'Listeners',\n"
    "    'Data Stores',\n"
    "    'Infrastructure Resources',\n"
    "  ],\n"
    "};"
)
NEW_DOMAIN_GROUPINGS = (
    "  infrastructure: [\n"
    "    'Environments',\n"
    "    'Cloud Accounts',\n"
    "    'Locations',\n"
    "    'Networks',\n"
    "    'Subnets',\n"
    "    'Compute Clusters',\n"
    "    'Compute Resources',\n"
    "    'Deployment Units',\n"
    "    'Load Balancers',\n"
    "    'Listeners',\n"
    "    'Data Stores',\n"
    "    'Infrastructure Resources',\n"
    "    // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness\n"
    "    'IaC Sources',\n"
    "  ],\n"
    "};"
)

OLD_DOMAIN_ENTITY_TYPES = (
    "  infrastructure: [\n"
    "    'environments',\n"
    "    'cloud_accounts',\n"
    "    'locations',\n"
    "    'networks',\n"
    "    'subnets',\n"
    "    'compute_clusters',\n"
    "    'compute_resources',\n"
    "    'deployment_units',\n"
    "    'load_balancers',\n"
    "    'listeners',\n"
    "    'data_store_instances',\n"
    "    'infrastructure_resources',\n"
    "    'infrastructure_points',\n"
    "  ],\n"
    "};"
)
NEW_DOMAIN_ENTITY_TYPES = (
    "  infrastructure: [\n"
    "    'environments',\n"
    "    'cloud_accounts',\n"
    "    'locations',\n"
    "    'networks',\n"
    "    'subnets',\n"
    "    'compute_clusters',\n"
    "    'compute_resources',\n"
    "    'deployment_units',\n"
    "    'load_balancers',\n"
    "    'listeners',\n"
    "    'data_store_instances',\n"
    "    'infrastructure_resources',\n"
    "    'infrastructure_points',\n"
    "    // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness\n"
    "    'iac_sources',\n"
    "  ],\n"
    "};"
)

OLD_REL_TAB_NAMES_END = "  'App <-> Load Balancer',\n];"
NEW_REL_TAB_NAMES_END = (
    "  'App <-> Load Balancer',\n"
    "  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness\n"
    "  'IaC Resource Bindings',\n"
    "];"
)


def replace_once(src: str, old: str, new: str, label: str) -> str:
    if new in src and old not in src:
        return src  # already applied
    if old not in src:
        raise RuntimeError(f"replace_once: pattern '{label}' not found")
    if src.count(old) != 1:
        raise RuntimeError(f"replace_once: pattern '{label}' is not unique (count={src.count(old)})")
    return src.replace(old, new, 1)


def main() -> int:
    src = GC.read_text(encoding="utf-8")
    original = src

    # 1) Imports block
    if "iacSourceTypeOptions," not in src:
        src = replace_once(src, OLD_IMPORTS_BLOCK, NEW_IMPORTS_BLOCK, "imports")

    # 2) Append 2 new gridConfigs entries before the closing `};` of gridConfigs object.
    if "iac_sources: [" not in src:
        src = replace_once(src, OLD_OBJECT_CLOSE, NEW_OBJECT_CLOSE, "gridConfigs object close")

    # 3) tabToEntityType
    if "'IaC Sources': 'iac_sources'" not in src:
        src = replace_once(src, OLD_TAB_TO_ENTITY_TYPE_END, NEW_TAB_TO_ENTITY_TYPE_END, "tabToEntityType")

    # 4) relationshipTabToType
    if "'IaC Resource Bindings': 'iac_resource_bindings'" not in src:
        src = replace_once(src, OLD_REL_TAB_TO_TYPE_END, NEW_REL_TAB_TO_TYPE_END, "relationshipTabToType")

    # 5) entityTabNames
    # Need to be careful: the 'Infrastructure Resources',\n]; pattern appears once at the end of entityTabNames.
    # But the same 12-table list also appears in domainGroupings (closing with `  ],\n};`) so this is unique.
    if not (
        "  'Infrastructure Resources',\n  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness\n  'IaC Sources',\n];"
        in src
    ):
        src = replace_once(src, OLD_ENTITY_TAB_NAMES_END, NEW_ENTITY_TAB_NAMES_END, "entityTabNames")

    # 6) domainGroupings.infrastructure
    if "    'Infrastructure Resources',\n    // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness\n    'IaC Sources',\n  ],\n};" not in src:
        src = replace_once(src, OLD_DOMAIN_GROUPINGS, NEW_DOMAIN_GROUPINGS, "domainGroupings.infrastructure")

    # 7) DOMAIN_ENTITY_TYPES.infrastructure
    if "    'infrastructure_points',\n    // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness\n    'iac_sources',\n  ],\n};" not in src:
        src = replace_once(src, OLD_DOMAIN_ENTITY_TYPES, NEW_DOMAIN_ENTITY_TYPES, "DOMAIN_ENTITY_TYPES.infrastructure")

    # 8) relationshipTabNames
    if "'App <-> Load Balancer',\n  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness\n  'IaC Resource Bindings',\n];" not in src:
        src = replace_once(src, OLD_REL_TAB_NAMES_END, NEW_REL_TAB_NAMES_END, "relationshipTabNames")

    if src == original:
        print("gridConfigs.ts unchanged (already up to date)")
    else:
        GC.write_text(src, encoding="utf-8")
        print(f"gridConfigs.ts updated ({len(src) - len(original)} bytes added)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
