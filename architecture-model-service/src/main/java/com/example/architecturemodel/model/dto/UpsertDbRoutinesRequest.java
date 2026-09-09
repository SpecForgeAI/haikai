package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Bulk upsert body for the routine catalog (Stored Proc &amp; Function
 * Behaviour Program, Spec 1). The discovery DB scan sends every profiled
 * routine at completion; rows are matched by the natural key
 * (schema, name, kind) within the architecture. Snake_case wire.
 *
 * @param discoveryRunId the run that harvested the catalog (stamped on rows)
 * @param routines       the engine-neutral {@code RoutineRecord}s, verbatim
 */
public record UpsertDbRoutinesRequest(
    @JsonProperty("discovery_run_id") UUID discoveryRunId,
    @JsonProperty("routines") List<RoutineRecordDto> routines
) {

    /** One profiled routine as the discovery service produces it. */
    public record RoutineRecordDto(
        @JsonProperty("schema_name") String schemaName,
        @JsonProperty("routine_name") String routineName,
        @JsonProperty("routine_kind") String routineKind,
        @JsonProperty("language") String language,
        @JsonProperty("full_body") String fullBody,
        @JsonProperty("body_hash") String bodyHash,
        @JsonProperty("body_md5") String bodyMd5,
        @JsonProperty("params") List<Map<String, Object>> params,
        @JsonProperty("returns_type") String returnsType,
        @JsonProperty("trigger_on_table") String triggerOnTable,
        @JsonProperty("trigger_events") List<String> triggerEvents,
        @JsonProperty("profile") Map<String, Object> profile,
        @JsonProperty("reads") List<String> reads,
        @JsonProperty("writes") List<String> writes,
        @JsonProperty("proc_calls") List<String> procCalls,
        @JsonProperty("reads_closure") List<String> readsClosure,
        @JsonProperty("writes_closure") List<String> writesClosure,
        @JsonProperty("trigger_expanded_writes") List<String> triggerExpandedWrites,
        @JsonProperty("source") String source,
        @JsonProperty("signature_parsed") Boolean signatureParsed,
        @JsonProperty("signature_error") String signatureError
    ) {}
}
