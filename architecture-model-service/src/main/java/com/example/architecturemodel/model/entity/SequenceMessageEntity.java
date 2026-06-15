package com.example.architecturemodel.model.entity;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;

@Entity
@Table(name = "sequence_messages")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SequenceMessageEntity {

    @Id
    @Column(name = "id", nullable = false)
    private String id;

    @Column(name = "sequence_diagram_id", nullable = false)
    private String sequenceDiagramId;

    @Column(name = "exchange_id", nullable = false)
    private String exchangeId;

    @Column(name = "exchange_role", nullable = false)
    private String exchangeRole;

    @Column(name = "from_participant_id", nullable = false)
    private String fromParticipantId;

    @Column(name = "to_participant_id", nullable = false)
    private String toParticipantId;

    @Column(name = "ref_kind")
    private String refKind;

    @Column(name = "ref_id")
    private String refId;

    @Column(name = "label_text")
    private String labelText;

    @Column(name = "is_collection")
    private Boolean isCollection;

    @Column(name = "show_endpoint_name")
    private Boolean showEndpointName;

    @Column(name = "show_endpoint_verb_path")
    private Boolean showEndpointVerbPath;

    @Column(name = "show_endpoint_req_res_data")
    private Boolean showEndpointReqResData;

    @Column(name = "response_mode")
    private String responseMode;

    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
