package com.legacy.hier.service;

import java.util.HashMap;
import java.util.Map;

public class CachingNodeServiceImpl implements NodeService {

    private Map<String, String> nodeCache = new HashMap<String, String>();

    @Override
    public String findNode(String nodeId) {
        if (nodeCache.containsKey(nodeId)) {
            return nodeCache.get(nodeId);
        }
        String resolved = "node:" + nodeId;
        nodeCache.put(nodeId, resolved);
        return resolved;
    }

    @Override
    public int countNodes() {
        return nodeCache.size();
    }
}
