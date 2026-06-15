package com.example.jiraservice.service;

import com.example.jiraservice.config.JiraProperties;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Drives Jira's transitions API for status changes.
 *
 * <p>Status can't be set via {@code fields.status} on Jira's PUT endpoint —
 * Jira refuses it and requires {@code POST /rest/api/3/issue/{key}/transitions}
 * with a transition id. The set of available transitions depends on the issue's
 * current status and the project's workflow scheme.</p>
 *
 * <p>This service maps a tool status (PLANNED / IN_PROGRESS / DEV_COMPLETE /
 * COMPLETED / CANCELLED) to a list of candidate Jira status names, then finds
 * the first available transition whose target status matches one of those
 * candidates (case-insensitive).</p>
 */
@Service
@Slf4j
public class JiraIssueTransitionService {

    /**
     * Hardcoded fallback mapping. Tool status → ordered list of Jira target-status
     * names to try. First match (any available transition whose {@code to.name}
     * matches a candidate) wins. Mirrors {@code normalizeStatus} in the read direction.
     *
     * <p>These are the defaults; per-project overrides can be configured via
     * {@code jira.status-mapping.<projectKey>.<TOOL_STATUS>: [list, of, jira, names]}
     * in {@code application.yml}. When yml provides a list for a (project, tool-status),
     * it fully replaces the default for that combination.</p>
     */
    static final Map<String, List<String>> DEFAULT_TOOL_STATUS_TO_JIRA_CANDIDATES = Map.of(
        "PLANNED",      List.of("To Do", "Open", "Backlog", "New", "Selected for Development", "Planned"),
        "IN_PROGRESS",  List.of("In Progress", "In Development", "Active"),
        "DEV_COMPLETE", List.of("In Review", "Code Review", "Ready for Review", "In QA", "Ready for QA",
                                 "Awaiting QA", "In Test", "In Testing", "Ready to Test", "Ready for Testing",
                                 "In Verification", "Awaiting Verification"),
        "COMPLETED",    List.of("Done", "Closed", "Resolved", "Verified", "Completed"),
        "CANCELLED",    List.of("Cancelled", "Canceled", "Won't Do", "Wont Do", "Will Not Do", "Deferred")
    );

    private final RestClient jiraRestClient;
    private final JiraProperties jiraProperties;

    public JiraIssueTransitionService(@Qualifier("jiraRestClient") RestClient jiraRestClient,
                                      JiraProperties jiraProperties) {
        this.jiraRestClient = jiraRestClient;
        this.jiraProperties = jiraProperties;
    }

    /**
     * Resolves the candidate Jira status names for a (project, tool-status) pair.
     * Prefers the yml override when present; falls back to {@link #DEFAULT_TOOL_STATUS_TO_JIRA_CANDIDATES}.
     */
    List<String> resolveCandidates(String jiraProjectKey, String toolStatus) {
        String normalisedTool = toolStatus.toUpperCase(Locale.ROOT);
        if (jiraProjectKey != null && jiraProperties.statusMapping() != null) {
            Map<String, List<String>> projectMapping = jiraProperties.statusMapping().get(jiraProjectKey);
            if (projectMapping != null) {
                List<String> overridden = projectMapping.get(normalisedTool);
                if (overridden != null && !overridden.isEmpty()) {
                    log.debug("Using yml-configured status candidates for {}/{}: {}",
                        jiraProjectKey, normalisedTool, overridden);
                    return overridden;
                }
            }
        }
        return DEFAULT_TOOL_STATUS_TO_JIRA_CANDIDATES.get(normalisedTool);
    }

    /** Derives the Jira project key from an issue key (e.g. "KAN-2" -> "KAN"). */
    private static String deriveJiraProjectKey(String externalKey) {
        if (externalKey == null) return null;
        int dash = externalKey.indexOf('-');
        return dash > 0 ? externalKey.substring(0, dash) : null;
    }

    /**
     * Outcome of a transition attempt.
     */
    public sealed interface TransitionResult {
        record Transitioned(String toStatusName) implements TransitionResult {}
        record AlreadyAtTarget(String currentStatusName) implements TransitionResult {}
        record NoMatchingTransition(String toolStatus, List<String> candidates,
                                    List<String> availableTargets) implements TransitionResult {}
    }

    /**
     * Attempt to transition an issue to a status that matches the tool's intent.
     *
     * @param externalKey  the Jira issue key (e.g. KAN-2)
     * @param toolStatus   the tool's status to express in Jira (e.g. COMPLETED)
     * @return the transition outcome (transitioned, no-op already there, or no match)
     * @throws IllegalArgumentException if {@code toolStatus} is unknown
     */
    public TransitionResult transitionTo(String externalKey, String toolStatus) {
        if (externalKey == null || externalKey.isBlank()) {
            throw new IllegalArgumentException("externalKey must not be blank");
        }
        if (toolStatus == null || toolStatus.isBlank()) {
            throw new IllegalArgumentException("toolStatus must not be blank");
        }

        String jiraProjectKey = deriveJiraProjectKey(externalKey);
        List<String> candidates = resolveCandidates(jiraProjectKey, toolStatus);
        if (candidates == null || candidates.isEmpty()) {
            throw new IllegalArgumentException(
                "Unknown tool status '" + toolStatus + "' — expected one of "
                    + DEFAULT_TOOL_STATUS_TO_JIRA_CANDIDATES.keySet()
                    + " (or a per-project override under jira.status-mapping)");
        }

        // 1) List available transitions for the issue
        @SuppressWarnings("unchecked")
        Map<String, Object> response = jiraRestClient.get()
            .uri("/rest/api/3/issue/{key}/transitions", externalKey)
            .retrieve()
            .body(Map.class);

        if (response == null || !(response.get("transitions") instanceof List<?> rawTransitions)) {
            throw new IllegalStateException("Could not list transitions for " + externalKey);
        }

        record Transition(String id, String toName) {}
        List<Transition> transitions = rawTransitions.stream()
            .filter(t -> t instanceof Map<?, ?>)
            .map(t -> (Map<?, ?>) t)
            .map(t -> {
                String id = String.valueOf(t.get("id"));
                String toName = (t.get("to") instanceof Map<?, ?> to && to.get("name") != null)
                    ? String.valueOf(to.get("name"))
                    : null;
                return new Transition(id, toName);
            })
            .filter(t -> t.toName() != null)
            .toList();

        log.info("Available transitions for {}: {}", externalKey,
            transitions.stream().map(Transition::toName).toList());

        // 2) Try each candidate in priority order
        for (String candidate : candidates) {
            for (Transition t : transitions) {
                if (t.toName().equalsIgnoreCase(candidate.trim())) {
                    log.info("Executing transition {} ({} -> {}) on {}",
                        t.id(), candidate, t.toName(), externalKey);
                    jiraRestClient.post()
                        .uri("/rest/api/3/issue/{key}/transitions", externalKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(Map.of("transition", Map.of("id", t.id())))
                        .retrieve()
                        .toBodilessEntity();
                    return new TransitionResult.Transitioned(t.toName());
                }
            }
        }

        // 3) No match: inform caller
        List<String> availableTargets = transitions.stream().map(Transition::toName).distinct().toList();
        log.warn("No matching transition for {} → tool status '{}'. Tried: {}. Available: {}",
            externalKey, toolStatus, candidates, availableTargets);
        return new TransitionResult.NoMatchingTransition(toolStatus, candidates, availableTargets);
    }
}
