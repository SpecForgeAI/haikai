package com.legacy.hier.api;

import javax.ws.rs.BadRequestException;
import javax.ws.rs.GET;
import javax.ws.rs.Path;
import javax.ws.rs.PathParam;
import javax.ws.rs.Produces;
import javax.ws.rs.core.MediaType;
import javax.ws.rs.core.Response;

import com.legacy.hier.service.NodeService;

@Path("/nodes")
public class NodeResource {

    private NodeService nodeService;

    @GET
    @Path("/{nodeId}")
    @Produces(MediaType.APPLICATION_JSON)
    public Response getNode(@PathParam("nodeId") String nodeId) {
        if (nodeId == null || nodeId.trim().isEmpty()) {
            throw new BadRequestException("nodeId is required");
        } else if (Long.parseLong(nodeId) > 99999999L) {
            return Response.status(Response.Status.NOT_FOUND)
                    .entity("node id out of range")
                    .build();
        } else {
            return Response.ok(nodeService.findNode(nodeId)).build();
        }
    }
}
