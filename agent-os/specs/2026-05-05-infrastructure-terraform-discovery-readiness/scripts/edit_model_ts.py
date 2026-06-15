"""
Idempotent edit of frontend/src/types/model.ts for spec 7
(Infrastructure Terraform & Discovery Readiness).

Tasks:
- Add 11 optional provenance + readiness fields to each of the 12 existing
  Infra entity interfaces (Environment, CloudAccount, Location, Network,
  Subnet, ComputeCluster, ComputeResource, DeploymentUnit, LoadBalancer,
  Listener, DataStoreInstance, InfrastructureResource).
- Add 6 optional provenance fields to each of the 3 existing Infra-internal
  relationship interfaces (ResourceSubnetHosting, DeploymentUnitComputeResource,
  LoadBalancerResourceRoute).
- Add 2 new interfaces (IaCSource, IaCResourceBinding) immediately before the
  MetaModel block.
- Extend MetaModelEntities with `iac_sources: IaCSource[]`.
- Extend MetaModelRelationships with `iac_resource_bindings: IaCResourceBinding[]`.
- Extend EntityType, RelationshipType, AnyEntity, AnyRelationship unions.

Idempotent: if a marker comment is already present, re-runs are no-ops.
"""

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[4]  # repo root
MODEL_PATH = ROOT / "frontend/src/types/model.ts"

MARKER = "// Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness"

PROVENANCE_FIELDS_ENTITY = """  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 6 provenance + 5 readiness fields
  source_origin?: string;
  source_system?: string;
  source_reference?: string;
  generation_status?: string;
  generation_notes?: string;
  last_verified_at?: string;
  terraform_ready?: boolean;
  terraform_module_hint?: string;
  terraform_resource_hint?: string;
  terraform_variable_hints?: string;
  terraform_notes?: string;
"""

PROVENANCE_FIELDS_RELATIONSHIP = """  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness - 6 provenance fields
  source_origin?: string;
  source_system?: string;
  source_reference?: string;
  generation_status?: string;
  generation_notes?: string;
  last_verified_at?: string;
"""

ENTITY_INTERFACES = [
    "Environment",
    "CloudAccount",
    "Location",
    "Network",
    "Subnet",
    "ComputeCluster",
    "ComputeResource",
    "DeploymentUnit",
    "LoadBalancer",
    "Listener",
    "DataStoreInstance",
    "InfrastructureResource",
]

RELATIONSHIP_INTERFACES = [
    "ResourceSubnetHosting",
    "DeploymentUnitComputeResource",
    "LoadBalancerResourceRoute",
]


def insert_fields_into_interface(text: str, iface_name: str, fields: str) -> str:
    """Insert `fields` block right before the closing `}` of an interface body."""
    # match `export interface IFACE_NAME {` ... up through the closing brace
    # use non-greedy match for body so we land on FIRST closing brace
    pattern = re.compile(
        r"(export\s+interface\s+" + re.escape(iface_name) + r"\s*\{[^}]*?)(\n\})",
        re.DOTALL,
    )
    m = pattern.search(text)
    if not m:
        raise RuntimeError(f"Interface {iface_name} not found")
    body, close = m.group(1), m.group(2)
    if MARKER in body:
        return text  # already inserted
    # ensure body ends with newline before insert
    if not body.endswith("\n"):
        body += "\n"
    new_block = body + fields + close
    return text[: m.start()] + new_block + text[m.end():]


NEW_INTERFACES = """
// ============================================================================
// Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness
// 2 new interfaces:
//   - IaCSource (entity-shaped, full envelope with name/description/tags)
//   - IaCResourceBinding (relationship-shaped, no `name`, polymorphic-target via
//     infrastructure_point_id; references an iac_sources row via iac_source_id)
// snake_case fields throughout, mirroring backend JSON contract.
// ============================================================================

/** IaCSource - IaC source-of-record (Terraform repo / OpenTofu / CloudFormation / Pulumi etc.). */
export interface IaCSource {
  id: string;
  name: string;
  description: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
  environment_id?: string;
  source_type?: string;
  repository_url?: string;
  repository_provider?: string;
  branch?: string;
  commit_sha?: string;
  path?: string;
  workspace?: string;
  module_name?: string;
  module_path?: string;
  provider?: string;
  owner?: string;
  last_scanned_at?: string;
  last_imported_at?: string;
}

/** IaCResourceBinding - mapping between an Infrastructure entity (via InfrastructurePoint)
 *  and a current/future IaC resource address (Terraform module address, CloudFormation
 *  logical ID, Pulumi URN, etc.). */
export interface IaCResourceBinding {
  id: string;
  iac_source_id: string;
  infrastructure_point_id: string;
  environment_id?: string;
  iac_address?: string;
  iac_resource_type?: string;
  iac_resource_name?: string;
  provider?: string;
  file_path?: string;
  start_line?: number;
  end_line?: number;
  state_resource_id?: string;
  external_id?: string;
  binding_status?: string;
  // DECIMAL(4,3) on backend - number on frontend
  confidence?: number;
  last_seen_at?: string;
  description: string;
  tags: string;
}

"""


def main() -> int:
    src = MODEL_PATH.read_text(encoding="utf-8")
    original = src

    # 1) extend the 12 existing Infra entity interfaces
    for name in ENTITY_INTERFACES:
        src = insert_fields_into_interface(src, name, PROVENANCE_FIELDS_ENTITY)

    # 2) extend the 3 existing Infra-internal relationship interfaces
    for name in RELATIONSHIP_INTERFACES:
        src = insert_fields_into_interface(src, name, PROVENANCE_FIELDS_RELATIONSHIP)

    # 3) insert 2 new interfaces just before the `// MetaModel nested structure` comment
    metamodel_marker = "// MetaModel nested structure"
    if "interface IaCSource {" not in src:
        idx = src.index(metamodel_marker)
        src = src[:idx] + NEW_INTERFACES + src[idx:]

    # 4) extend MetaModelEntities with iac_sources
    if "iac_sources: IaCSource[]" not in src:
        src = src.replace(
            "  infrastructure_points: InfrastructurePoint[];\n}",
            "  infrastructure_points: InfrastructurePoint[];\n"
            "  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness\n"
            "  iac_sources: IaCSource[];\n}",
            1,
        )

    # 5) extend MetaModelRelationships with iac_resource_bindings
    if "iac_resource_bindings: IaCResourceBinding[]" not in src:
        src = src.replace(
            "  application_load_balancer_exposures: ApplicationLoadBalancerExposure[];\n}",
            "  application_load_balancer_exposures: ApplicationLoadBalancerExposure[];\n"
            "  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness\n"
            "  iac_resource_bindings: IaCResourceBinding[];\n}",
            1,
        )

    # 6) extend EntityType union with 'iac_sources'
    if "| 'iac_sources'" not in src:
        src = src.replace(
            "  | 'infrastructure_points';",
            "  | 'infrastructure_points'\n"
            "  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness\n"
            "  | 'iac_sources';",
            1,
        )

    # 7) extend RelationshipType union with 'iac_resource_bindings'
    if "| 'iac_resource_bindings'" not in src:
        src = src.replace(
            "  | 'application_load_balancer_exposures';",
            "  | 'application_load_balancer_exposures'\n"
            "  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness\n"
            "  | 'iac_resource_bindings';",
            1,
        )

    # 8) extend AnyEntity union with IaCSource
    if "| IaCSource" not in src:
        src = src.replace(
            "  | InfrastructurePoint;",
            "  | InfrastructurePoint\n"
            "  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness\n"
            "  | IaCSource;",
            1,
        )

    # 9) extend AnyRelationship union with IaCResourceBinding
    if "| IaCResourceBinding" not in src:
        src = src.replace(
            "  | ApplicationLoadBalancerExposure;",
            "  | ApplicationLoadBalancerExposure\n"
            "  // Spec 2026-05-05: Infrastructure Terraform & Discovery Readiness\n"
            "  | IaCResourceBinding;",
            1,
        )

    if src == original:
        print("model.ts unchanged (already up to date)")
    else:
        MODEL_PATH.write_text(src, encoding="utf-8")
        print(f"model.ts updated ({len(src) - len(original)} bytes added)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
