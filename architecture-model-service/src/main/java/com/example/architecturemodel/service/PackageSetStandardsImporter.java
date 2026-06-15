package com.example.architecturemodel.service;

import com.example.architecturemodel.mapper.EntityMapper;
import com.example.architecturemodel.model.dto.entity.PackageSetStandardsImportResultDto;
import com.example.architecturemodel.model.entity.*;
import com.example.architecturemodel.repository.entity.*;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.OffsetDateTime;
import java.util.*;

/**
 * Service for importing Package Set standards from JSON files.
 *
 * Follows the RoadmapImportService pattern for project resolution and file reading.
 * Supports company-level and project-level standards with merge logic.
 *
 * Spec: Package Set Standards Import (Iteration 6)
 */
@Service
@ConditionalOnProperty(
    name = "app.features.include-database",
    havingValue = "true",
    matchIfMissing = true
)
@Slf4j
public class PackageSetStandardsImporter {

    private static final String STANDARDS_FOLDER = "standards";
    private static final String STANDARDS_FILENAME = "package-set-standards.json";
    private static final String COMPANY_SOURCE = "COMPANY";
    private static final String PROJECT_SOURCE = "PROJECT";

    private final ProjectService projectService;
    private final PackageSetRepository packageSetRepository;
    private final PackageRepository packageRepository;
    private final PackageSetDefaultRuleRepository defaultRuleRepository;
    private final PackageSetStandardsImportStatusRepository importStatusRepository;
    private final ObjectMapper objectMapper;

    public PackageSetStandardsImporter(
            ProjectService projectService,
            PackageSetRepository packageSetRepository,
            PackageRepository packageRepository,
            PackageSetDefaultRuleRepository defaultRuleRepository,
            PackageSetStandardsImportStatusRepository importStatusRepository) {
        this.projectService = projectService;
        this.packageSetRepository = packageSetRepository;
        this.packageRepository = packageRepository;
        this.defaultRuleRepository = defaultRuleRepository;
        this.importStatusRepository = importStatusRepository;
        this.objectMapper = new ObjectMapper();
    }

    /**
     * Resolves the paths for company and project standards files.
     *
     * Company: {projectParentFolder}/standards/package-set-standards.json
     * Project: {projectParentFolder}/{projectName}/standards/package-set-standards.json
     *
     * @return Map with "company" and "project" paths (may be null if not found)
     */
    public Map<String, Path> resolveStandardsPaths() {
        Map<String, Path> paths = new HashMap<>();

        try {
            ProjectEntity project = projectService.getActiveProjectEntity();
            String parentFolder = project.getProjectParentFolder();
            String projectName = project.getName();

            // Company-level path
            Path companyPath = Paths.get(parentFolder, STANDARDS_FOLDER, STANDARDS_FILENAME);
            if (Files.exists(companyPath)) {
                paths.put("company", companyPath);
                log.debug("Found company standards file: {}", companyPath);
            } else {
                log.debug("Company standards file not found: {}", companyPath);
            }

            // Project-level path
            Path projectPath = Paths.get(parentFolder, projectName, STANDARDS_FOLDER, STANDARDS_FILENAME);
            if (Files.exists(projectPath)) {
                paths.put("project", projectPath);
                log.debug("Found project standards file: {}", projectPath);
            } else {
                log.debug("Project standards file not found: {}", projectPath);
            }
        } catch (Exception e) {
            log.warn("Failed to resolve standards paths: {}", e.getMessage());
        }

        return paths;
    }

    /**
     * Parse a standards JSON file and extract package sets, packages, and default rules.
     *
     * @param path Path to the JSON file
     * @param source Standard source (COMPANY or PROJECT)
     * @return Parsed standards data
     */
    public ParsedStandards parseStandardsFile(Path path, String source) throws IOException {
        String content = Files.readString(path, StandardCharsets.UTF_8);
        JsonNode root = objectMapper.readTree(content);

        ParsedStandards result = new ParsedStandards();
        result.source = source;
        result.revision = root.has("revision") ? root.get("revision").asText() : null;
        result.packageSets = new ArrayList<>();
        result.packages = new ArrayList<>();
        result.defaultRules = new ArrayList<>();

        // Parse package_sets array
        if (root.has("package_sets") && root.get("package_sets").isArray()) {
            for (JsonNode setNode : root.get("package_sets")) {
                String key = setNode.has("key") ? setNode.get("key").asText() : null;
                String name = setNode.has("name") ? setNode.get("name").asText() : key;

                if (key != null) {
                    ParsedPackageSet pset = new ParsedPackageSet();
                    pset.key = key;
                    pset.name = name;
                    pset.packages = new ArrayList<>();

                    // Parse packages array within the set
                    if (setNode.has("packages") && setNode.get("packages").isArray()) {
                        int sortOrder = 0;
                        for (JsonNode pkgNode : setNode.get("packages")) {
                            ParsedPackage pkg = new ParsedPackage();
                            pkg.name = pkgNode.has("name") ? pkgNode.get("name").asText() : null;
                            pkg.purpose = pkgNode.has("purpose") ? pkgNode.get("purpose").asText() : null;
                            pkg.sortOrder = sortOrder++;
                            if (pkg.name != null) {
                                pset.packages.add(pkg);
                            }
                        }
                    }

                    result.packageSets.add(pset);
                }
            }
        }

        // Parse default_rules array
        if (root.has("default_rules") && root.get("default_rules").isArray()) {
            for (JsonNode ruleNode : root.get("default_rules")) {
                ParsedDefaultRule rule = new ParsedDefaultRule();
                rule.packageSetKey = ruleNode.has("package_set_key") ? ruleNode.get("package_set_key").asText() : null;
                rule.priority = ruleNode.has("priority") ? ruleNode.get("priority").asInt() : 0;

                // Parse core_tech_includes array
                if (ruleNode.has("core_tech_includes") && ruleNode.get("core_tech_includes").isArray()) {
                    rule.coreTechIncludes = objectMapper.convertValue(
                            ruleNode.get("core_tech_includes"),
                            new TypeReference<List<String>>() {});
                } else {
                    rule.coreTechIncludes = Collections.emptyList();
                }

                // Parse service_type_includes array
                if (ruleNode.has("service_type_includes") && ruleNode.get("service_type_includes").isArray()) {
                    rule.serviceTypeIncludes = objectMapper.convertValue(
                            ruleNode.get("service_type_includes"),
                            new TypeReference<List<String>>() {});
                } else {
                    rule.serviceTypeIncludes = Collections.emptyList();
                }

                if (rule.packageSetKey != null) {
                    result.defaultRules.add(rule);
                }
            }
        }

        return result;
    }

    /**
     * Merge company and project standards.
     * Project-level takes precedence for conflicting keys.
     *
     * @param company Company-level standards (may be null)
     * @param project Project-level standards (may be null)
     * @return Merged standards with source information preserved
     */
    public List<ParsedStandards> mergeStandards(ParsedStandards company, ParsedStandards project) {
        List<ParsedStandards> result = new ArrayList<>();
        if (company != null) {
            result.add(company);
        }
        if (project != null) {
            result.add(project);
        }
        return result;
    }

    /**
     * Generate a deterministic UUID based on model file ID, source, and key.
     * This ensures the same entity gets the same ID across imports.
     *
     * @param modelFileId The model file ID
     * @param source The standard source (COMPANY or PROJECT)
     * @param key The standard key
     * @return Deterministic UUID
     */
    public static UUID generateDeterministicUuid(UUID modelFileId, String source, String key) {
        String combined = modelFileId.toString() + ":" + source + ":" + key;
        return UUID.nameUUIDFromBytes(combined.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Import standards for a specific model file.
     * Implements upsert logic: update existing, insert new.
     *
     * @param modelFileId The model file ID to import standards for
     * @return Import result with counts and status
     */
    @Transactional
    public PackageSetStandardsImportResultDto importStandards(String modelFileId) {
        log.info("Starting package set standards import for model file: {}", modelFileId);

        List<String> warnings = new ArrayList<>();
        int insertedSets = 0, updatedSets = 0;
        int insertedPackages = 0, updatedPackages = 0;
        int insertedRules = 0, updatedRules = 0;
        String companyRevision = null, projectRevision = null;
        String companyFilePath = null, projectFilePath = null;

        // Resolve file paths
        Map<String, Path> paths = resolveStandardsPaths();
        boolean companyFileFound = paths.containsKey("company");
        boolean projectFileFound = paths.containsKey("project");

        if (!companyFileFound && !projectFileFound) {
            log.warn("No standards files found");
            return new PackageSetStandardsImportResultDto(
                    false,
                    "No package-set-standards.json files found in company or project standards folders",
                    OffsetDateTime.now(),
                    false, false, null, null,
                    0, 0, 0, 0, 0, 0,
                    warnings
            );
        }

        // Parse files
        ParsedStandards companyStandards = null;
        ParsedStandards projectStandards = null;

        if (companyFileFound) {
            try {
                companyFilePath = paths.get("company").toString();
                companyStandards = parseStandardsFile(paths.get("company"), COMPANY_SOURCE);
                companyRevision = companyStandards.revision;
                log.info("Parsed company standards: {} sets, {} rules",
                        companyStandards.packageSets.size(), companyStandards.defaultRules.size());
            } catch (IOException e) {
                warnings.add("Failed to parse company standards: " + e.getMessage());
                log.error("Failed to parse company standards", e);
            }
        }

        if (projectFileFound) {
            try {
                projectFilePath = paths.get("project").toString();
                projectStandards = parseStandardsFile(paths.get("project"), PROJECT_SOURCE);
                projectRevision = projectStandards.revision;
                log.info("Parsed project standards: {} sets, {} rules",
                        projectStandards.packageSets.size(), projectStandards.defaultRules.size());
            } catch (IOException e) {
                warnings.add("Failed to parse project standards: " + e.getMessage());
                log.error("Failed to parse project standards", e);
            }
        }

        // Merge and process standards
        List<ParsedStandards> allStandards = mergeStandards(companyStandards, projectStandards);
        UUID modelFileUuid = UUID.fromString(modelFileId);

        // Track package set IDs by key for rule resolution
        Map<String, String> packageSetIdsByKey = new HashMap<>();

        // Process package sets and packages
        for (ParsedStandards standards : allStandards) {
            for (ParsedPackageSet pset : standards.packageSets) {
                String setId = generateDeterministicUuid(modelFileUuid, standards.source, pset.key).toString();
                packageSetIdsByKey.put(pset.key, setId);

                // Upsert package set
                Optional<PackageSetEntity> existingSet = packageSetRepository
                        .findByModelFileIdAndStandardSourceAndStandardKey(modelFileId, standards.source, pset.key);

                PackageSetEntity setEntity;
                if (existingSet.isPresent()) {
                    setEntity = existingSet.get();
                    setEntity.setName(pset.name);
                    setEntity.setUpdatedAt(OffsetDateTime.now());
                    updatedSets++;
                } else {
                    setEntity = PackageSetEntity.builder()
                            .id(setId)
                            .modelFileId(modelFileId)
                            .name(pset.name)
                            .standardKey(pset.key)
                            .standardSource(standards.source)
                            .createdAt(OffsetDateTime.now())
                            .updatedAt(OffsetDateTime.now())
                            .build();
                    insertedSets++;
                }
                packageSetRepository.save(setEntity);

                // Process packages for this set
                for (ParsedPackage pkg : pset.packages) {
                    String pkgKey = pset.key + ":" + pkg.name;
                    String pkgId = generateDeterministicUuid(modelFileUuid, standards.source, pkgKey).toString();

                    Optional<PackageEntity> existingPkg = packageRepository.findById(pkgId);

                    PackageEntity pkgEntity;
                    if (existingPkg.isPresent()) {
                        pkgEntity = existingPkg.get();
                        pkgEntity.setName(pkg.name);
                        pkgEntity.setPurpose(pkg.purpose);
                        pkgEntity.setSortOrder(pkg.sortOrder);
                        pkgEntity.setUpdatedAt(OffsetDateTime.now());
                        updatedPackages++;
                    } else {
                        pkgEntity = PackageEntity.builder()
                                .id(pkgId)
                                .modelFileId(modelFileId)
                                .packageSetId(setId)
                                .name(pkg.name)
                                .purpose(pkg.purpose)
                                .sortOrder(pkg.sortOrder)
                                .standardSource(standards.source)
                                .standardKey(pkgKey)
                                .createdAt(OffsetDateTime.now())
                                .updatedAt(OffsetDateTime.now())
                                .build();
                        insertedPackages++;
                    }
                    packageRepository.save(pkgEntity);
                }
            }
        }

        // Process default rules
        for (ParsedStandards standards : allStandards) {
            for (ParsedDefaultRule rule : standards.defaultRules) {
                String packageSetId = packageSetIdsByKey.get(rule.packageSetKey);
                if (packageSetId == null) {
                    warnings.add("Default rule references unknown package_set_key: " + rule.packageSetKey);
                    continue;
                }

                String ruleKey = rule.packageSetKey + ":rule";
                String ruleId = generateDeterministicUuid(modelFileUuid, standards.source, ruleKey).toString();

                Optional<PackageSetDefaultRuleEntity> existingRule = defaultRuleRepository
                        .findByModelFileIdAndStandardSourceAndPackageSetId(modelFileId, standards.source, packageSetId);

                PackageSetDefaultRuleEntity ruleEntity;
                if (existingRule.isPresent()) {
                    ruleEntity = existingRule.get();
                    ruleEntity.setCoreTechIncludes(toJsonArray(rule.coreTechIncludes));
                    ruleEntity.setServiceTypeIncludes(toJsonArray(rule.serviceTypeIncludes));
                    ruleEntity.setPriority(rule.priority);
                    ruleEntity.setUpdatedAt(OffsetDateTime.now());
                    updatedRules++;
                } else {
                    ruleEntity = PackageSetDefaultRuleEntity.builder()
                            .id(ruleId)
                            .modelFileId(modelFileId)
                            .standardSource(standards.source)
                            .packageSetId(packageSetId)
                            .coreTechIncludes(toJsonArray(rule.coreTechIncludes))
                            .serviceTypeIncludes(toJsonArray(rule.serviceTypeIncludes))
                            .priority(rule.priority)
                            .createdAt(OffsetDateTime.now())
                            .updatedAt(OffsetDateTime.now())
                            .build();
                    insertedRules++;
                }
                defaultRuleRepository.save(ruleEntity);
            }
        }

        // Record import status
        OffsetDateTime importedAt = OffsetDateTime.now();
        PackageSetStandardsImportStatusEntity statusEntity = PackageSetStandardsImportStatusEntity.builder()
                .id(UUID.randomUUID().toString())
                .modelFileId(modelFileId)
                .importedAt(importedAt)
                .companyFilePath(companyFilePath)
                .projectFilePath(projectFilePath)
                .companyRevision(companyRevision)
                .projectRevision(projectRevision)
                .insertedSets(insertedSets)
                .updatedSets(updatedSets)
                .insertedPackages(insertedPackages)
                .updatedPackages(updatedPackages)
                .insertedRules(insertedRules)
                .updatedRules(updatedRules)
                .build();
        importStatusRepository.save(statusEntity);

        log.info("Package set standards import completed: {} sets inserted, {} updated; {} packages inserted, {} updated; {} rules inserted, {} updated",
                insertedSets, updatedSets, insertedPackages, updatedPackages, insertedRules, updatedRules);

        return new PackageSetStandardsImportResultDto(
                true,
                "Import completed successfully",
                importedAt,
                companyFileFound, projectFileFound,
                companyRevision, projectRevision,
                insertedSets, updatedSets,
                insertedPackages, updatedPackages,
                insertedRules, updatedRules,
                warnings
        );
    }

    /**
     * Get the import status for a model file.
     *
     * @param modelFileId The model file ID
     * @return Optional status, empty if no import has been done
     */
    public Optional<PackageSetStandardsImportStatusEntity> getImportStatus(String modelFileId) {
        return importStatusRepository.findFirstByModelFileIdOrderByImportedAtDesc(modelFileId);
    }

    private String toJsonArray(List<String> list) {
        if (list == null || list.isEmpty()) {
            return "[]";
        }
        try {
            return objectMapper.writeValueAsString(list);
        } catch (Exception e) {
            return "[]";
        }
    }

    // Inner classes for parsing
    public static class ParsedStandards {
        public String source;
        public String revision;
        public List<ParsedPackageSet> packageSets;
        public List<ParsedPackage> packages;
        public List<ParsedDefaultRule> defaultRules;
    }

    public static class ParsedPackageSet {
        public String key;
        public String name;
        public List<ParsedPackage> packages;
    }

    public static class ParsedPackage {
        public String name;
        public String purpose;
        public int sortOrder;
    }

    public static class ParsedDefaultRule {
        public String packageSetKey;
        public List<String> coreTechIncludes;
        public List<String> serviceTypeIncludes;
        public int priority;
    }
}
