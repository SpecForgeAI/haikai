package com.example.architecturemodel.repository.entity;

import com.example.architecturemodel.model.entity.LibraryEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface LibraryRepository extends JpaRepository<LibraryEntity, String> {

    List<LibraryEntity> findByModelFileId(String modelFileId);

    void deleteByModelFileId(String modelFileId);

    /**
     * Find a Library row by its identity composite (model_file_id, name, ecosystem).
     *
     * <p>Used by the discovery-service find-or-create flow (Spec:
     * 2026-05-06-library-discovery-integration) to deduplicate Library inserts
     * at the application layer (Spec 1 deliberately omitted a DB UNIQUE on
     * (libraries.name, ecosystem); identity dedup is the resolver layer's
     * responsibility).</p>
     *
     * <p>Spring Data JPA derives the query from the method name -- no
     * {@code @Query} annotation needed.</p>
     *
     * @param modelFileId the owning model_file_id
     * @param name        the library name (Maven {@code groupId:artifactId} or
     *                    npm package name)
     * @param ecosystem   the ecosystem identifier (e.g. {@code "MAVEN"},
     *                    {@code "NPM"})
     * @return the matching library row, or empty if none.
     */
    Optional<LibraryEntity> findByModelFileIdAndNameAndEcosystem(String modelFileId,
                                                                 String name,
                                                                 String ecosystem);
}
