-- Add activity_issues and ui_issues columns to activity_steps table
ALTER TABLE activity_steps ADD COLUMN activity_issues TEXT NOT NULL DEFAULT '';
ALTER TABLE activity_steps ADD COLUMN ui_issues TEXT NOT NULL DEFAULT '';
