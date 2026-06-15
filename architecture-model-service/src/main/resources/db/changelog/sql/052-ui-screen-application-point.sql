ALTER TABLE ui_screens ADD COLUMN application_point_id TEXT REFERENCES application_points(id);
CREATE INDEX idx_ui_screens_application_point ON ui_screens(application_point_id);
