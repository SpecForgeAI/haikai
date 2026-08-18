package com.legacy.hier.api;

import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.PathParam;
import javax.ws.rs.HeaderParam;
import javax.ws.rs.Produces;
import javax.ws.rs.core.Context;
import javax.ws.rs.core.HttpHeaders;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;

import com.legacy.hier.model.ResponseEnvelope;
import com.legacy.hier.provider.HierarchyViewProvider;
import com.legacy.hier.util.CookieUtils;

@Path("/views")
public class ViewResource {

    private HierarchyViewProvider hierarchyViewProvider;

    @GET
    @Path("/{viewId}")
    @Produces({MediaType.APPLICATION_JSON, MediaType.APPLICATION_XML})
    public Response getView(@HeaderParam("system") String system,
                            @HeaderParam("ssoToken") String ssoToken,
                            @PathParam("viewId") Integer viewId,
                            @Context HttpHeaders headers) {
        String token = CookieUtils.readSsoCookie(headers);
        if (token != null) {
            ssoToken = token;
        }
        AuditInfo audit = AuditInfoDecoder.decode(system, ssoToken);
        ResponseEnvelope envelope = hierarchyViewProvider.getView(viewId, audit);
        return Response.ok(envelope).build();
    }

    @GET
    @Produces({MediaType.APPLICATION_JSON, MediaType.APPLICATION_XML})
    public Response getAllViews(@HeaderParam("system") String system,
                                @HeaderParam("ssoToken") String ssoToken,
                                @Context HttpHeaders headers) {
        String token = CookieUtils.readSsoCookie(headers);
        if (token != null) {
            ssoToken = token;
        }
        AuditInfo audit = AuditInfoDecoder.decode(system, ssoToken);
        ResponseEnvelope envelope = hierarchyViewProvider.getAllViews(audit);
        return Response.ok(envelope).build();
    }
}
