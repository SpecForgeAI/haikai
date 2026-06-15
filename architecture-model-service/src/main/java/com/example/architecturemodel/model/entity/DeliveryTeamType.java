package com.example.architecturemodel.model.entity;

/**
 * Enum representing the type of a delivery team.
 *
 * Used for Java-side validation only; the database stores the value as plain TEXT.
 *
 * Spec: RM Increment 3 -- DeliveryTeam Entity (DB Only, No UI)
 */
public enum DeliveryTeamType {
    INTERNAL,
    EXTERNAL
}
