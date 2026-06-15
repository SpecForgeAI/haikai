package com.example.sybasesidecar.model;

import java.util.List;
import java.util.Map;

/**
 * Response body for {@code POST /query}. On success, {@code rows} is the
 * (possibly truncated) result-set as a list of column-name to value maps.
 * {@code truncated} is true if {@code maxRows} fired before the server
 * stopped sending rows.
 */
public record QueryResponse(
        boolean ok,
        String error,
        List<Map<String, Object>> rows,
        int rowCount,
        boolean truncated
) {
}
