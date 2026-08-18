package com.legacy.hier.service;

public class NodeServiceImpl implements NodeService {

    @Override
    public String findNode(String nodeId) {
        return "node:" + nodeId;
    }

    @Override
    public int countNodes() {
        return 0;
    }
}
