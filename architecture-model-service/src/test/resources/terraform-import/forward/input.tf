# Forward-fixture input for TerraformImportForwardFixtureTest.
# Hand-rolled to exercise every supported GCP family + edge cases.
// Line-style comment for coverage.
/* Block-style comment for coverage. */

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "instance_size" {
  description = "Default machine size"
  type        = string
  default     = "e2-medium"
}

# Unresolved variable: referenced below with no default + no user-form override.
variable "unset_value" {
  description = "Will not be resolved -- exercises TODO warning."
  type        = string
}

locals {
  bucket_storage_class = "STANDARD"
  scheduler_cron       = "0 8 * * *"
}

provider "google" {
  project = "fixture-project"
  region  = "europe-west1"
}

# Supported resource families (one of each)
resource "google_compute_network" "fixture_vpc" {
  name                    = "fixture-vpc"
  description             = "VPC for fixture"
  routing_mode            = "REGIONAL"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "fixture_subnet" {
  name          = "fixture-subnet"
  ip_cidr_range = "10.0.1.0/24"
  region        = var.region
  network       = google_compute_network.fixture_vpc.id
}

resource "google_container_cluster" "fixture_gke" {
  name     = "fixture-gke"
  location = var.region
  network  = google_compute_network.fixture_vpc.id
  initial_node_count = 1
}

resource "google_compute_instance" "fixture_vm" {
  name         = "fixture-vm"
  machine_type = var.instance_size
  zone         = "europe-west1-b"
}

resource "google_cloud_run_v2_service" "fixture_run" {
  name     = "fixture-run"
  location = var.region
  template {
    containers {
      image = "gcr.io/fixture-project/api:latest"
    }
  }
}

resource "google_cloudfunctions2_function" "fixture_fn" {
  name     = "fixture-fn"
  location = var.region
  build_config {
    source = "gs://fixture-bucket/fn.zip"
  }
}

resource "google_sql_database_instance" "fixture_db" {
  name             = "fixture-db"
  database_version = "POSTGRES_15"
  region           = var.region
  settings {
    tier = "db-f1-micro"
  }
}

resource "google_redis_instance" "fixture_cache" {
  name           = "fixture-cache"
  tier           = "BASIC"
  memory_size_gb = 1
  region         = var.region
}

resource "google_storage_bucket" "fixture_bucket" {
  name          = "fixture-bucket"
  location      = "EU"
  storage_class = local.bucket_storage_class
}

resource "google_pubsub_topic" "fixture_topic" {
  name = "fixture-topic"
}

resource "google_pubsub_subscription" "fixture_subscription" {
  name  = "fixture-subscription"
  topic = google_pubsub_topic.fixture_topic.id
}

resource "google_secret_manager_secret" "fixture_secret" {
  secret_id = "fixture-secret"
}

resource "google_cloud_scheduler_job" "fixture_scheduler" {
  name     = "fixture-scheduler"
  schedule = local.scheduler_cron
  region   = var.region
  http_target {
    uri = "https://example.com/cron"
  }
}

resource "google_artifact_registry_repository" "fixture_repo" {
  repository_id = "fixture-repo"
  location      = var.region
  format        = "DOCKER"
}

# Composite Load Balancer success path: 5 components wired together.
resource "google_compute_backend_service" "fixture_lb_backend" {
  name                  = "fixture-lb-backend"
  load_balancing_scheme = "EXTERNAL"
  protocol              = "HTTPS"
}

resource "google_compute_url_map" "fixture_lb_urlmap" {
  name            = "fixture-lb-urlmap"
  default_service = google_compute_backend_service.fixture_lb_backend.id
}

resource "google_compute_target_https_proxy" "fixture_lb_proxy" {
  name    = "fixture-lb-proxy"
  url_map = google_compute_url_map.fixture_lb_urlmap.id
}

resource "google_compute_global_forwarding_rule" "fixture_lb_fwd" {
  name       = "fixture-lb-fwd"
  target     = google_compute_target_https_proxy.fixture_lb_proxy.id
  port_range = "443"
}

resource "google_compute_network_endpoint_group" "fixture_lb_neg" {
  name                  = "fixture-lb-neg"
  network_endpoint_type = "SERVERLESS"
  region                = var.region
}

# Unsupported resource type -- preserved verbatim with a TODO warning.
resource "google_compute_firewall" "fixture_fw" {
  name    = "fixture-fw"
  network = google_compute_network.fixture_vpc.id
  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

# Local module reference -- target file lives at modules/m/main.tf.
module "m" {
  source = "./modules/m"
}

# Reference an unset variable to exercise unresolved-var TODO.
resource "google_storage_bucket" "fixture_unset_ref_bucket" {
  name     = var.unset_value
  location = "EU"
}
