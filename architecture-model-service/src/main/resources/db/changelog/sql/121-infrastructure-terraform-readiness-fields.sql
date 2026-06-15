-- ============================================================================
-- Infrastructure Domain: Terraform Readiness Fields
-- Spec: 2026-05-05-infrastructure-terraform-discovery-readiness
-- Adds 5 nullable Terraform readiness columns (terraform_ready,
-- terraform_module_hint, terraform_resource_hint, terraform_variable_hints,
-- terraform_notes) to each of the 12 Infrastructure entity tables ONLY.
-- Relationships are NOT extended (per Q2). terraform_variable_hints is TEXT
-- (raw JSON string) NOT JSONB (per Q9, parallel to the existing tags
-- convention). Backwards-compatible: existing rows have NULL.
-- ============================================================================

ALTER TABLE environments              ADD COLUMN terraform_ready BOOLEAN;
ALTER TABLE environments              ADD COLUMN terraform_module_hint TEXT;
ALTER TABLE environments              ADD COLUMN terraform_resource_hint TEXT;
ALTER TABLE environments              ADD COLUMN terraform_variable_hints TEXT;
ALTER TABLE environments              ADD COLUMN terraform_notes TEXT;

ALTER TABLE cloud_accounts            ADD COLUMN terraform_ready BOOLEAN;
ALTER TABLE cloud_accounts            ADD COLUMN terraform_module_hint TEXT;
ALTER TABLE cloud_accounts            ADD COLUMN terraform_resource_hint TEXT;
ALTER TABLE cloud_accounts            ADD COLUMN terraform_variable_hints TEXT;
ALTER TABLE cloud_accounts            ADD COLUMN terraform_notes TEXT;

ALTER TABLE locations                 ADD COLUMN terraform_ready BOOLEAN;
ALTER TABLE locations                 ADD COLUMN terraform_module_hint TEXT;
ALTER TABLE locations                 ADD COLUMN terraform_resource_hint TEXT;
ALTER TABLE locations                 ADD COLUMN terraform_variable_hints TEXT;
ALTER TABLE locations                 ADD COLUMN terraform_notes TEXT;

ALTER TABLE networks                  ADD COLUMN terraform_ready BOOLEAN;
ALTER TABLE networks                  ADD COLUMN terraform_module_hint TEXT;
ALTER TABLE networks                  ADD COLUMN terraform_resource_hint TEXT;
ALTER TABLE networks                  ADD COLUMN terraform_variable_hints TEXT;
ALTER TABLE networks                  ADD COLUMN terraform_notes TEXT;

ALTER TABLE subnets                   ADD COLUMN terraform_ready BOOLEAN;
ALTER TABLE subnets                   ADD COLUMN terraform_module_hint TEXT;
ALTER TABLE subnets                   ADD COLUMN terraform_resource_hint TEXT;
ALTER TABLE subnets                   ADD COLUMN terraform_variable_hints TEXT;
ALTER TABLE subnets                   ADD COLUMN terraform_notes TEXT;

ALTER TABLE compute_clusters          ADD COLUMN terraform_ready BOOLEAN;
ALTER TABLE compute_clusters          ADD COLUMN terraform_module_hint TEXT;
ALTER TABLE compute_clusters          ADD COLUMN terraform_resource_hint TEXT;
ALTER TABLE compute_clusters          ADD COLUMN terraform_variable_hints TEXT;
ALTER TABLE compute_clusters          ADD COLUMN terraform_notes TEXT;

ALTER TABLE compute_resources         ADD COLUMN terraform_ready BOOLEAN;
ALTER TABLE compute_resources         ADD COLUMN terraform_module_hint TEXT;
ALTER TABLE compute_resources         ADD COLUMN terraform_resource_hint TEXT;
ALTER TABLE compute_resources         ADD COLUMN terraform_variable_hints TEXT;
ALTER TABLE compute_resources         ADD COLUMN terraform_notes TEXT;

ALTER TABLE deployment_units          ADD COLUMN terraform_ready BOOLEAN;
ALTER TABLE deployment_units          ADD COLUMN terraform_module_hint TEXT;
ALTER TABLE deployment_units          ADD COLUMN terraform_resource_hint TEXT;
ALTER TABLE deployment_units          ADD COLUMN terraform_variable_hints TEXT;
ALTER TABLE deployment_units          ADD COLUMN terraform_notes TEXT;

ALTER TABLE load_balancers            ADD COLUMN terraform_ready BOOLEAN;
ALTER TABLE load_balancers            ADD COLUMN terraform_module_hint TEXT;
ALTER TABLE load_balancers            ADD COLUMN terraform_resource_hint TEXT;
ALTER TABLE load_balancers            ADD COLUMN terraform_variable_hints TEXT;
ALTER TABLE load_balancers            ADD COLUMN terraform_notes TEXT;

ALTER TABLE listeners                 ADD COLUMN terraform_ready BOOLEAN;
ALTER TABLE listeners                 ADD COLUMN terraform_module_hint TEXT;
ALTER TABLE listeners                 ADD COLUMN terraform_resource_hint TEXT;
ALTER TABLE listeners                 ADD COLUMN terraform_variable_hints TEXT;
ALTER TABLE listeners                 ADD COLUMN terraform_notes TEXT;

ALTER TABLE data_store_instances      ADD COLUMN terraform_ready BOOLEAN;
ALTER TABLE data_store_instances      ADD COLUMN terraform_module_hint TEXT;
ALTER TABLE data_store_instances      ADD COLUMN terraform_resource_hint TEXT;
ALTER TABLE data_store_instances      ADD COLUMN terraform_variable_hints TEXT;
ALTER TABLE data_store_instances      ADD COLUMN terraform_notes TEXT;

ALTER TABLE infrastructure_resources  ADD COLUMN terraform_ready BOOLEAN;
ALTER TABLE infrastructure_resources  ADD COLUMN terraform_module_hint TEXT;
ALTER TABLE infrastructure_resources  ADD COLUMN terraform_resource_hint TEXT;
ALTER TABLE infrastructure_resources  ADD COLUMN terraform_variable_hints TEXT;
ALTER TABLE infrastructure_resources  ADD COLUMN terraform_notes TEXT;
