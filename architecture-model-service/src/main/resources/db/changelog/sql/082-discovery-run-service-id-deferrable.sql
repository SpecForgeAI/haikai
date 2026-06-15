-- 082-discovery-run-service-id-deferrable.sql
-- Spec: Service-Scoped Discovery (follow-up fix)
--
-- Makes the discovery_run.service_id FK constraint DEFERRABLE INITIALLY DEFERRED.
--
-- Why: ModelService.saveModel uses a DELETE ALL -> re-INSERT pattern for
-- entities belonging to a model_file. When services are deleted mid-transaction,
-- the non-deferred FK in discovery_run fires immediately and blocks the DELETE,
-- even though the same service IDs are re-inserted moments later in the same
-- transaction. Making the constraint deferrable moves the check to COMMIT,
-- by which point the service rows are back with the same IDs and the FK is
-- satisfied.

ALTER TABLE discovery_run DROP CONSTRAINT IF EXISTS discovery_run_service_id_fkey;

ALTER TABLE discovery_run
  ADD CONSTRAINT discovery_run_service_id_fkey
  FOREIGN KEY (service_id) REFERENCES services(id)
  DEFERRABLE INITIALLY DEFERRED;
