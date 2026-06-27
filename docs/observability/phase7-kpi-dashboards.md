# Phase 7 Pilot KPI Dashboards

## Dashboard

Dashboard ID: `phase7-pilot-ops`

Refresh interval: 60 seconds

Implementation: `services/ops/src/observability.js`

Renderer: `renderPilotKpiDashboardMarkdown` for a simple pilot-readable dashboard artifact.

## Wired Metrics

- `curation_throughput`: counts audit events by `event_type` or `action`.
- `suggestion_feedback_rates`: counts accept, reject, and revise feedback records, plus rates.
- `low_confidence_expert_routing`: counts total review queue items, expert-review routed items, expert-review rate, and open expert-review items.
- `release_and_rollback_events`: counts release candidate creation, proposal staging, mapping staging, and rollback events.
- `search_usage`: counts total searches, unique users, zero-result searches, and average result count.
- `error_rates`: counts total errors, critical errors, impacted services, and per-service error totals.

All metrics are computed after server-side tenant/environment scoping and authorization filtering. The dashboard does not emit `hidden_count`, `filtered_count`, cross-tenant totals, or global totals that could reveal hidden rows.

## KPI Row Shape

Pilot KPI evidence can be joined to dashboard panels using Kevin's pilot-readiness row shape: `kpi_id`, `name`, `phase`, `pilot_scope`, `owner_role`, `definition`, `measurement_window`, `data_source`, `target`, `warning_threshold`, `critical_threshold`, `exit_gate`, and `evidence`.

## Event Inputs

The dashboard builder accepts already-collected operational events so pilot deployments can wire it to the current stores without forcing a metrics vendor:

- `audit_events`: proposal workflow, mapping workflow, release candidate, and rollback audit events.
- `review_queue_items`: curation and expert review queue records from proposal workflow.
- `feedback_records`: human feedback records for AI suggestions.
- `release_events`: release manager events not already present in the audit stream.
- `search_events`: search API usage events with `actor_user_id` and `result_count`.
- `error_events`: service error events with `service` and `severity`.

## Pilot Operating View

Pilot admins should review the dashboard daily during pilot operations and after each release or rollback. A healthy pilot has non-zero curation throughput, explicit accept/reject/revise feedback, low-confidence suggestions visible in expert routing, release and rollback events reflected within one refresh interval, search usage without sustained zero-result spikes, and no critical errors.
