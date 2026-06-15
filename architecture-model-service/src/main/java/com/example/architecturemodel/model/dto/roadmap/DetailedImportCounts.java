package com.example.architecturemodel.model.dto.roadmap;

/**
 * Helper record to track detailed counts per item type during roadmap import.
 *
 * Spec 2026-01-04: Roadmap Import UX Glue - Persisted Status + Detailed Counts + Error UX
 * Task Group 1: Track inserted/updated/archived/deleted counts.
 */
public record DetailedImportCounts(
    int inserted,
    int updated,
    int archived,
    int deleted
) {
    /**
     * Creates an empty counts object (all zeros).
     */
    public static DetailedImportCounts empty() {
        return new DetailedImportCounts(0, 0, 0, 0);
    }

    /**
     * Returns a new counts object with inserted incremented by 1.
     */
    public DetailedImportCounts withInserted() {
        return new DetailedImportCounts(inserted + 1, updated, archived, deleted);
    }

    /**
     * Returns a new counts object with updated incremented by 1.
     */
    public DetailedImportCounts withUpdated() {
        return new DetailedImportCounts(inserted, updated + 1, archived, deleted);
    }

    /**
     * Returns a new counts object with archived incremented by 1.
     */
    public DetailedImportCounts withArchived() {
        return new DetailedImportCounts(inserted, updated, archived + 1, deleted);
    }

    /**
     * Returns a new counts object with deleted incremented by 1.
     */
    public DetailedImportCounts withDeleted() {
        return new DetailedImportCounts(inserted, updated, archived, deleted + 1);
    }

    /**
     * Merges two counts objects by adding all values.
     */
    public DetailedImportCounts merge(DetailedImportCounts other) {
        return new DetailedImportCounts(
            inserted + other.inserted,
            updated + other.updated,
            archived + other.archived,
            deleted + other.deleted
        );
    }

    /**
     * Returns a new Mutable instance for accumulating counts.
     */
    public static Mutable mutable() {
        return new Mutable();
    }

    /**
     * Mutable accumulator class for building counts incrementally.
     */
    public static class Mutable {
        private int inserted = 0;
        private int updated = 0;
        private int archived = 0;
        private int deleted = 0;

        public void incrementInserted() {
            inserted++;
        }

        public void incrementUpdated() {
            updated++;
        }

        public void incrementArchived() {
            archived++;
        }

        public void incrementDeleted() {
            deleted++;
        }

        public DetailedImportCounts toImmutable() {
            return new DetailedImportCounts(inserted, updated, archived, deleted);
        }
    }
}
