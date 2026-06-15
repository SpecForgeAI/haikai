package com.example.jiraservice.service;

import com.example.jiraservice.model.dto.jira.JiraIssue;
import com.example.jiraservice.model.dto.jira.JiraSearchResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Service for expanding parent issues by fetching their direct children from Jira.
 *
 * <p>Batches parent keys into groups of {@value #BATCH_SIZE} to avoid Jira JQL length limits,
 * and issues secondary JQL queries using {@code parent in (...)} syntax.</p>
 *
 * <p>Expansion is one level deep only -- children of children are not fetched.</p>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ChildExpansionService {

    /** Maximum number of parent keys per JQL batch query */
    public static final int BATCH_SIZE = 50;

    private final JiraSearchService jiraSearchService;

    /**
     * Fetches direct child issues for the given list of parent issue keys.
     *
     * <p>Parent keys are batched into groups of {@value #BATCH_SIZE} to stay within
     * Jira JQL length limits. Each batch produces a separate JQL query of the form
     * {@code parent in (KEY-1, KEY-2, ...) ORDER BY created DESC}.</p>
     *
     * @param parentKeys the list of parent issue keys to fetch children for
     * @return aggregated list of all child issues across all batches
     */
    public List<JiraIssue> fetchChildren(List<String> parentKeys) {
        if (parentKeys == null || parentKeys.isEmpty()) {
            return List.of();
        }

        List<List<String>> batches = partitionIntoBatches(parentKeys, BATCH_SIZE);
        log.info("Fetching children for {} parent keys in {} batch(es)", parentKeys.size(), batches.size());

        List<JiraIssue> allChildren = new ArrayList<>();

        for (List<String> batch : batches) {
            String parentKeysJql = batch.stream()
                .collect(Collectors.joining(", "));
            String jql = "parent in (" + parentKeysJql + ") ORDER BY created DESC";

            JiraSearchResponse response = jiraSearchService.searchIssues(jql, BATCH_SIZE);
            if (response != null && response.issues() != null) {
                allChildren.addAll(response.issues());
            }
        }

        log.info("Total children fetched: {}", allChildren.size());
        return allChildren;
    }

    /**
     * Partitions a list into sublists of the given maximum size.
     */
    static <T> List<List<T>> partitionIntoBatches(List<T> list, int batchSize) {
        List<List<T>> batches = new ArrayList<>();
        for (int i = 0; i < list.size(); i += batchSize) {
            batches.add(list.subList(i, Math.min(i + batchSize, list.size())));
        }
        return batches;
    }
}
