package com.example.architecturemodel.model.dto.security;

import com.example.architecturemodel.model.entity.security.SecurityLinkingAliasEntity;

import java.util.UUID;

/**
 * Wire mirror of one {@code security_linking_aliases} row (Security health
 * dashboard, 2026-07-19, Spec 1 of 3). Snake_case wire (AMS global default).
 */
public record SecurityLinkingAliasDto(
    UUID id,
    String level,
    String aliasValue,
    String entityId,
    String entityName
) {

    public static SecurityLinkingAliasDto from(SecurityLinkingAliasEntity e) {
        return new SecurityLinkingAliasDto(
            e.getId(), e.getLevel(), e.getAliasValue(), e.getEntityId(), e.getEntityName());
    }
}
