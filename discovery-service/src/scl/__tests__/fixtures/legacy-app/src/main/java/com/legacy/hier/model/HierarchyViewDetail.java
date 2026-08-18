package com.legacy.hier.model;

import java.util.List;

import org.codehaus.jackson.annotate.JsonProperty;
import org.joda.time.LocalDate;

public class HierarchyViewDetail {

    private Integer id;

    @JsonProperty("view_name")
    private String name;

    private LocalDate validFrom;

    private LocalDate validTo;

    private List<FilterCriteria> filterCriterias;

    public Integer getId() {
        return id;
    }

    public void setId(Integer id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public LocalDate getValidFrom() {
        return validFrom;
    }

    public void setValidFrom(LocalDate validFrom) {
        this.validFrom = validFrom;
    }

    public LocalDate getValidTo() {
        return validTo;
    }

    public void setValidTo(LocalDate validTo) {
        this.validTo = validTo;
    }

    public List<FilterCriteria> getFilterCriterias() {
        return filterCriterias;
    }

    public void setFilterCriterias(List<FilterCriteria> filterCriterias) {
        this.filterCriterias = filterCriterias;
    }
}
