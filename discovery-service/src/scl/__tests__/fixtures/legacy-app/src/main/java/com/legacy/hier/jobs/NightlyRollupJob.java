package com.legacy.hier.jobs;

import com.legacy.hier.service.NodeService;

public class NightlyRollupJob implements Runnable {

    private NodeService nodeService;

    public void run() {
        int total = nodeService.countNodes();
        for (int i = 0; i < total; i++) {
            nodeService.findNode(String.valueOf(i));
        }
    }
}
