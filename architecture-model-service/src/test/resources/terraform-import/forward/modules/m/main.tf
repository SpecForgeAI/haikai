# Module file for the local-module reference in input.tf.
resource "google_storage_bucket" "module_bucket" {
  name     = "module-bucket"
  location = "EU"
}
