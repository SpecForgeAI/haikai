package com.legacy.hier.provider;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.legacy.hier.dao.ViewDao;
import com.legacy.hier.exception.ViewNotFoundException;
import com.legacy.hier.model.HierarchyViewDetail;

public class ViewCache {

    private Map<Integer, HierarchyViewDetail> cache = new HashMap<Integer, HierarchyViewDetail>();
    private ViewDao viewDao;

    public HierarchyViewDetail getViewViaCache(Integer viewId, AuditInfo audit) throws ViewNotFoundException {
        if (cache.containsKey(viewId)) {
            return cache.get(viewId);
        } else {
            HierarchyViewDetail v = viewDao.findLatest(viewId);
            if (v == null) {
                throw new ViewNotFoundException("no view for id " + viewId);
            }
            cache.put(viewId, v);
            return v;
        }
    }

    public List<HierarchyViewDetail> getAllViews(AuditInfo audit) {
        return viewDao.findAll();
    }
}
