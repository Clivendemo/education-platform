-- Migration 0018: Search Intelligence Autocomplete & Telemetry Optimization
-- Milestone: Prompt 29

-- 1. Autocomplete Prefix Index on Published Resources
-- Uses text_pattern_ops because lower(title) returns text.
-- Enables B-tree range scan for LIKE 'prefix%' under all collations.
CREATE INDEX IF NOT EXISTS idx_resources_title_autocomplete 
ON content.resources (status, (lower(title)) text_pattern_ops);

-- 2. Search Demand Partial Telemetry Index
-- Excludes events without a normalized query from the index.
-- Optimizes time-window demand aggregation when query selectivity favors an index scan.
CREATE INDEX IF NOT EXISTS idx_analytics_events_search_demand 
ON analytics.analytics_events (event_type_id, occurred_at DESC) 
WHERE (context->>'normalized_query') IS NOT NULL;
