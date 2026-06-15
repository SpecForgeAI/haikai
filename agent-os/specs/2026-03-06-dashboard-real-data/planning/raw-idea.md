# Raw Idea

Make the dashboard show real data instead of mock data for all 10 cards. Based on analysis:

- 5 cards are already real or partially real (Product Definition, Standards, HLA, Test Strategy, Roadmap partial)
- 3 cards need a new work item count/stats endpoint (Roadmap completed, Backlog, Implementation)
- 2 cards (Testing Suite, Verification) will show 0 for all metrics for now since no data model exists yet

Key decisions:
- Need a new stats/count endpoint on architecture-model-service for work item counts by type and status
- Stories with AC count needs a convention (check description content or add column)
- Detailed Architecture counts need entity-type grouping from meta-model
- Last Updated dates for Product Definition and Test Strategy should use file mtime
- Testing Suite and Verification cards will display 0s (no real data source yet)
