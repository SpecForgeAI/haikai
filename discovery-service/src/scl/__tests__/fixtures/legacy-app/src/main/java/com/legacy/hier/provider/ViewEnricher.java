package com.legacy.hier.provider;

import org.joda.time.LocalDate;

import com.legacy.hier.model.HierarchyViewDetail;

public class ViewEnricher {

    public void applyOpenEndedValidity(HierarchyViewDetail detail) {
        if (detail.getValidTo() == null) {
            detail.setValidTo(new LocalDate(9999, 12, 31));
        }
    }
}
