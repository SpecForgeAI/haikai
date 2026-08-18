package com.legacy.hier.provider;

import static java.util.Collections.singletonList;

import com.legacy.hier.aspect.AuditDbLogging;
import com.legacy.hier.aspect.ExecutionTimeLogging;
import com.legacy.hier.exception.NoDataFoundException;
import com.legacy.hier.exception.ViewNotFoundException;
import com.legacy.hier.model.HierarchyViewDetail;
import com.legacy.hier.model.ResponseCode;
import com.legacy.hier.model.ResponseEnvelope;

public class HierarchyViewProvider {

    private ViewCache cache;
    private ResponseBuilder responseBuilder;

    @ExecutionTimeLogging
    @AuditDbLogging
    public ResponseEnvelope getView(Integer viewId, AuditInfo audit) {
        try {
            HierarchyViewDetail view = cache.getViewViaCache(viewId, audit);
            return responseBuilder.renderWithViews("ViewId", viewId, audit.getUserName(),
                    singletonList(view), ResponseCode.SUCCESS);
        } catch (ViewNotFoundException e) {
            return responseBuilder.renderError("ViewId", viewId, audit.getUserName(),
                    ResponseCode.NO_DATA_FOUND, e.getMessage());
        } catch (NoDataFoundException e) {
            return responseBuilder.renderError("BusinessDate", e.getBusinessDate(), audit.getUserName(),
                    ResponseCode.NO_DATA_FOUND, e.getMessage());
        } catch (Exception e) {
            return responseBuilder.renderError("ViewId", viewId, audit.getUserName(),
                    ResponseCode.FATAL, e.getMessage());
        }
    }

    @ExecutionTimeLogging
    public ResponseEnvelope getAllViews(AuditInfo audit) {
        try {
            return responseBuilder.renderWithViews("All", null, audit.getUserName(),
                    cache.getAllViews(audit), ResponseCode.SUCCESS);
        } catch (Exception e) {
            return responseBuilder.renderError("All", null, audit.getUserName(),
                    ResponseCode.FATAL, e.getMessage());
        }
    }
}
