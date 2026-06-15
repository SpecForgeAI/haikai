package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

public record MetaModelDto(
    @JsonProperty("entities")
    MetaModelEntitiesDto entities,

    @JsonProperty("relationships")
    MetaModelRelationshipsDto relationships
) {}
