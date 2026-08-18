package com.legacy.hier.dao;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

import javax.sql.DataSource;

import com.legacy.hier.model.HierarchyViewDetail;

public class ViewDao {

    private static final String FIND_LATEST_SQL = "SELECT id, name, valid_from, valid_to FROM hier_view WHERE view_id = ? ORDER BY version DESC";
    private static final String FIND_ALL_SQL = "SELECT id, name, valid_from, valid_to FROM hier_view WHERE valid_to IS NULL";

    private DataSource dataSource;

    public HierarchyViewDetail findLatest(Integer viewId) {
        try {
            Connection conn = dataSource.getConnection();
            PreparedStatement stmt = conn.prepareStatement(FIND_LATEST_SQL);
            stmt.setInt(1, viewId);
            ResultSet rs = stmt.executeQuery();
            if (rs.next()) {
                return mapRow(rs);
            }
            return null;
        } catch (SQLException e) {
            throw new RuntimeException("findLatest failed for view " + viewId, e);
        }
    }

    public List<HierarchyViewDetail> findAll() {
        List<HierarchyViewDetail> out = new ArrayList<HierarchyViewDetail>();
        try {
            Connection conn = dataSource.getConnection();
            PreparedStatement stmt = conn.prepareStatement(FIND_ALL_SQL);
            ResultSet rs = stmt.executeQuery();
            while (rs.next()) {
                out.add(mapRow(rs));
            }
            return out;
        } catch (SQLException e) {
            throw new RuntimeException("findAll failed", e);
        }
    }

    private HierarchyViewDetail mapRow(ResultSet rs) throws SQLException {
        HierarchyViewDetail detail = new HierarchyViewDetail();
        detail.setId(rs.getInt("id"));
        detail.setName(rs.getString("name"));
        return detail;
    }
}
