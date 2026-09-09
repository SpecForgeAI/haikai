package com.example.sybasesidecar.controller;

import com.example.sybasesidecar.model.CallRequest;
import com.example.sybasesidecar.model.CallResponse;
import com.example.sybasesidecar.model.IntrospectionRequest;
import com.example.sybasesidecar.model.IntrospectionResponse;
import com.example.sybasesidecar.model.MutationRequest;
import com.example.sybasesidecar.model.MutationResponse;
import com.example.sybasesidecar.model.QueryRequest;
import com.example.sybasesidecar.model.QueryResponse;
import com.example.sybasesidecar.model.TestConnectionRequest;
import com.example.sybasesidecar.model.TestConnectionResponse;
import com.example.sybasesidecar.service.CallSqlGuard;
import com.example.sybasesidecar.service.MutationSqlGuard;
import com.example.sybasesidecar.service.SidecarSqlGuard;
import com.example.sybasesidecar.service.SybaseCallService;
import com.example.sybasesidecar.service.SybaseMutationService;
import com.example.sybasesidecar.service.SybaseQueryService;
import jakarta.validation.Valid;
import java.util.Collections;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * HTTP surface for the Sybase Discovery Sidecar.
 *
 * <p>Spec: 2026-05-16 Database Discovery Packs - Task Group 4 (sidecar).</p>
 *
 * <p>All endpoints are {@code POST} so credentials travel in the request
 * body rather than a query string. No endpoint logs the SQL or any
 * credential value; only a short query category string is emitted.</p>
 *
 * <p>Diagnostic logging: each endpoint emits {@code [diag-sidecar]}
 * structured key=value lines at request entry + response exit so the
 * discovery runbook can correlate sidecar activity with discovery-service
 * activity without exposing host, database, table, or SQL values.</p>
 */
@RestController
public class SidecarController {

    private static final Logger LOG = LoggerFactory.getLogger(SidecarController.class);

    private final SybaseQueryService queryService;
    private final SybaseMutationService mutationService;
    private final SybaseCallService callService;

    public SidecarController(
            final SybaseQueryService queryService,
            final SybaseMutationService mutationService,
            final SybaseCallService callService
    ) {
        this.queryService = queryService;
        this.mutationService = mutationService;
        this.callService = callService;
    }

    /**
     * Validate credentials against the target database. Returns
     * {@code ok=true} on success with the engine version, or
     * {@code ok=false} with a password-masked error message.
     */
    @PostMapping("/test-connection")
    public ResponseEntity<TestConnectionResponse> testConnection(
            @Valid @RequestBody final TestConnectionRequest req
    ) {
        final long start = System.currentTimeMillis();
        LOG.info("[diag-sidecar] op=test_connection status=accepted host_set={} driver_choice={}",
                req.getHost() != null && !req.getHost().isEmpty(),
                req.getDriver());
        final TestConnectionResponse body = this.queryService.testConnection(
                req.getDriver(),
                req.getHost(),
                req.getPort(),
                req.getDatabase(),
                req.getUsername(),
                req.getPassword()
        );
        LOG.info("[diag-sidecar] op=test_connection status=200 result={} driver_used={} elapsed_ms={}",
                body.ok() ? "ok" : "fail",
                body.driverUsed() == null ? "none" : body.driverUsed(),
                System.currentTimeMillis() - start);
        return ResponseEntity.ok(body);
    }

    /**
     * Run the full introspection batch (schemas/tables/columns/keys/views/
     * procedures/triggers) for the target Sybase database. Per-request
     * connection; no pooling.
     */
    @PostMapping("/introspect")
    public ResponseEntity<IntrospectionResponse> introspect(
            @Valid @RequestBody final IntrospectionRequest req
    ) {
        final long start = System.currentTimeMillis();
        LOG.info("[diag-sidecar] op=introspect status=accepted host_set={} driver_choice={}",
                req.getHost() != null && !req.getHost().isEmpty(),
                req.getDriver());
        final int timeoutSec = req.getQueryTimeoutSeconds() == null
                ? 30
                : Math.max(5, Math.min(300, req.getQueryTimeoutSeconds()));
        final IntrospectionResponse body = this.queryService.introspect(
                req.getDriver(),
                req.getHost(),
                req.getPort(),
                req.getDatabase(),
                req.getUsername(),
                req.getPassword(),
                req.getIncludeSchemas(),
                req.getIncludeTables(),
                timeoutSec,
                req.getCharset()
        );
        // Counts only, never names.
        LOG.info("[diag-sidecar] op=introspect status=200 result={} elapsed_ms={} "
                + "tables={} columns={} views={} procedures={} triggers={}",
                body.ok() ? "ok" : "fail",
                System.currentTimeMillis() - start,
                body.tables() == null ? 0 : body.tables().size(),
                body.columns() == null ? 0 : body.columns().size(),
                body.views() == null ? 0 : body.views().size(),
                body.procedures() == null ? 0 : body.procedures().size(),
                body.triggers() == null ? 0 : body.triggers().size());
        return ResponseEntity.ok(body);
    }

    /**
     * Execute a single guarded SELECT. The SQL is validated against
     * {@link SidecarSqlGuard} at the JVM layer; violations produce HTTP 400
     * with a structured error body so the caller can distinguish a guard
     * rejection from a SQL execution failure.
     */
    @PostMapping("/query")
    public ResponseEntity<QueryResponse> query(@Valid @RequestBody final QueryRequest req) {
        final long start = System.currentTimeMillis();
        LOG.info("[diag-sidecar] op=query status=accepted host_set={} driver_choice={}",
                req.getHost() != null && !req.getHost().isEmpty(),
                req.getDriver());
        try {
            // Pre-flight the guard so we can return a 400 (instead of 200
            // with ok=false) on a guard rejection - that signals to the
            // caller that this is a contract violation, not a runtime
            // failure that might be retried.
            SidecarSqlGuard.assertReadonlySelect(req.getSql());
        } catch (final SidecarSqlGuard.SqlGuardException e) {
            LOG.warn("Sidecar query category=query_guard_reject reason={}", e.getReason());
            // Structured diag for the runbook -- category only, no SQL.
            LOG.warn("[diag-sidecar] op=query status=403 reason=non_select elapsed_ms={}",
                    System.currentTimeMillis() - start);
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(new QueryResponse(
                    false,
                    "SQL guard rejected: " + e.getMessage(),
                    Collections.emptyList(),
                    0,
                    false
            ));
        }

        final int timeoutSec = req.getQueryTimeoutSeconds() == null
                ? 30
                : Math.max(1, Math.min(300, req.getQueryTimeoutSeconds()));
        final int maxRows = req.getMaxRows() == null
                ? 1000
                : Math.max(1, Math.min(10_000, req.getMaxRows()));
        final QueryResponse body = this.queryService.query(
                req.getDriver(),
                req.getHost(),
                req.getPort(),
                req.getDatabase(),
                req.getUsername(),
                req.getPassword(),
                req.getSql(),
                timeoutSec,
                maxRows,
                req.getCharset()
        );
        LOG.info("[diag-sidecar] op=query status=200 result={} rows={} truncated={} elapsed_ms={}",
                body.ok() ? "ok" : "fail",
                body.rowCount(),
                body.truncated(),
                System.currentTimeMillis() - start);
        return ResponseEntity.ok(body);
    }

    /**
     * Execute a guarded COMPENSATION batch (Capture-State Discipline Spec 1 —
     * the ONLY write surface on the sidecar). Every statement must satisfy
     * {@link MutationSqlGuard}'s grammar (derived inverse DML, the
     * IDENTITY_INSERT toggles, or the identity_burn_max reseed); a guard
     * violation is HTTP 400 BEFORE any JDBC work, distinguishing a contract
     * violation from a runtime failure. The read path ({@code /query} +
     * {@link SidecarSqlGuard}) is untouched and stays SELECT-only.
     */
    @PostMapping("/mutate")
    public ResponseEntity<MutationResponse> mutate(
            @Valid @RequestBody final MutationRequest req
    ) {
        final long start = System.currentTimeMillis();
        LOG.info("[diag-sidecar] op=mutate status=accepted host_set={} driver_choice={} statements={} mode={}",
                req.getHost() != null && !req.getHost().isEmpty(),
                req.getDriver(),
                req.getStatements() == null ? 0 : req.getStatements().size(),
                req.isRestoreMode() ? "restore" : "compensation");
        try {
            if (req.isRestoreMode()) {
                MutationSqlGuard.assertRestoreBatch(req.getStatements());
            } else {
                MutationSqlGuard.assertCompensationBatch(req.getStatements());
            }
        } catch (final SidecarSqlGuard.SqlGuardException e) {
            LOG.warn("Sidecar mutate category=mutate_guard_reject reason={}", e.getReason());
            LOG.warn("[diag-sidecar] op=mutate status=400 reason={} elapsed_ms={}",
                    e.getReason(), System.currentTimeMillis() - start);
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(new MutationResponse(
                    false,
                    "SQL guard rejected: " + e.getMessage(),
                    Collections.emptyList()
            ));
        }

        final int timeoutSec = req.getQueryTimeoutSeconds() == null
                ? 30
                : Math.max(1, Math.min(300, req.getQueryTimeoutSeconds()));
        final MutationResponse body = this.mutationService.mutate(
                req.getDriver(),
                req.getHost(),
                req.getPort(),
                req.getDatabase(),
                req.getUsername(),
                req.getPassword(),
                req.getStatements(),
                req.getTransactional() == null || req.getTransactional(),
                timeoutSec,
                req.isRestoreMode(),
                req.getCharset()
        );
        LOG.info("[diag-sidecar] op=mutate status=200 result={} statements={} elapsed_ms={}",
                body.ok() ? "ok" : "fail",
                req.getStatements().size(),
                System.currentTimeMillis() - start);
        return ResponseEntity.ok(body);
    }

    /**
     * Invoke ONE stored procedure or function and return the full
     * behaviour envelope (Stored-Proc Behaviour Program, Spec 2).
     *
     * <p>The request carries NO SQL text: {@link CallSqlGuard} proves the
     * routine identifier is 1-3 bare identifier parts, blocks non-allowlisted
     * {@code sp_*}/{@code xp_*}, caps the parameter list and matches every
     * session SET line against a fixed allowlist -- then
     * {@link SybaseCallService} composes the call escape itself. A guard
     * rejection is HTTP 400 BEFORE any JDBC work (a contract violation, not a
     * retryable runtime failure), exactly like {@code /query} and
     * {@code /mutate}.</p>
     *
     * <p>A routine that RAN and raised still returns HTTP 200 with
     * {@code ok=true, outcome=error} and a populated {@code error_detail}:
     * that error is the observed behaviour the capture exists to record.</p>
     *
     * <p>Never logs the routine name, its parameters, or any value.</p>
     */
    @PostMapping("/call")
    public ResponseEntity<CallResponse> call(@Valid @RequestBody final CallRequest req) {
        final long start = System.currentTimeMillis();
        LOG.info("[diag-sidecar] op=call status=accepted host_set={} driver_choice={} "
                        + "kind={} params={} session_sets={}",
                req.getHost() != null && !req.getHost().isEmpty(),
                req.getDriver(),
                req.isFunction() ? "function" : "procedure",
                req.resolveParams().size(),
                req.resolveSessionSet().size());
        try {
            CallSqlGuard.assertCall(req);
        } catch (final SidecarSqlGuard.SqlGuardException e) {
            LOG.warn("Sidecar call category=call_guard_reject reason={}", e.getReason());
            LOG.warn("[diag-sidecar] op=call status=400 reason={} elapsed_ms={}",
                    e.getReason(), System.currentTimeMillis() - start);
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(
                    CallResponse.failure("Call guard rejected: " + e.getMessage(), null));
        }

        // Clamps: rows [1, 10000] default 1000; result sets [1, 50] default 10;
        // timeout [1, 86400] default 30 -- the LONG ceiling, not /query's 300s.
        final CallResponse body = this.callService.call(
                req,
                req.resolveQueryTimeoutSeconds(),
                req.resolveMaxRowsPerResultSet(),
                req.resolveMaxResultSets());
        LOG.info("[diag-sidecar] op=call status=200 result={} outcome={} result_sets={} "
                        + "update_counts={} messages={} elapsed_ms={}",
                body.ok() ? "ok" : "fail",
                body.outcome(),
                body.resultSets() == null ? 0 : body.resultSets().size(),
                body.updateCounts() == null ? 0 : body.updateCounts().size(),
                body.messages() == null ? 0 : body.messages().size(),
                System.currentTimeMillis() - start);
        return ResponseEntity.ok(body);
    }
}
