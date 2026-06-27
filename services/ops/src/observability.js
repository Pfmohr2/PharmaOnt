export const PHASE7_KPI_DASHBOARD_SPEC = Object.freeze({
  dashboard_id: "phase7-pilot-ops",
  title: "Phase 7 Pilot Operations",
  panels: [
    "curation_throughput",
    "suggestion_feedback_rates",
    "low_confidence_expert_routing",
    "release_and_rollback_events",
    "search_usage",
    "error_rates"
  ],
  refresh_interval_seconds: 60
});

export function buildPilotKpiDashboard({
  tenant_id,
  environment,
  audit_events = [],
  review_queue_items = [],
  feedback_records = [],
  release_events = [],
  search_events = [],
  error_events = []
} = {}) {
  assertNonEmpty(tenant_id, "tenant_id");
  assertNonEmpty(environment, "environment");
  const scope = { tenant_id, environment };
  const scopedAuditEvents = scopedAuthorized(audit_events, scope);
  const scopedReviewQueueItems = scopedAuthorized(review_queue_items, scope);
  const scopedFeedbackRecords = scopedAuthorized(feedback_records, scope);
  const scopedReleaseEvents = scopedAuthorized(release_events, scope);
  const scopedSearchEvents = scopedAuthorized(search_events, scope);
  const scopedErrorEvents = scopedAuthorized(error_events, scope);
  const metrics = {
    curation_throughput: countBy(scopedAuditEvents, (event) => event.event_type ?? event.action ?? "unknown"),
    suggestion_feedback_rates: feedbackRates(scopedFeedbackRecords),
    low_confidence_expert_routing: expertRouting(scopedReviewQueueItems),
    release_and_rollback_events: releaseEvents([...scopedAuditEvents, ...scopedReleaseEvents]),
    search_usage: searchUsage(scopedSearchEvents),
    error_rates: errorRates(scopedErrorEvents)
  };
  return {
    ...PHASE7_KPI_DASHBOARD_SPEC,
    tenant_id,
    environment,
    generated_at: new Date().toISOString(),
    metrics,
    wired_metrics: Object.keys(metrics)
  };
}

export function renderPilotKpiDashboardMarkdown(dashboard) {
  const lines = [
    `# ${dashboard.title}`,
    "",
    `Dashboard ID: ${dashboard.dashboard_id}`,
    `Refresh: ${dashboard.refresh_interval_seconds}s`,
    "",
    "## Curation Throughput",
    tableFromObject(dashboard.metrics.curation_throughput),
    "",
    "## Suggestion Feedback Rates",
    tableFromObject(dashboard.metrics.suggestion_feedback_rates),
    "",
    "## Low Confidence Expert Routing",
    tableFromObject(dashboard.metrics.low_confidence_expert_routing),
    "",
    "## Release And Rollback Events",
    tableFromObject(dashboard.metrics.release_and_rollback_events),
    "",
    "## Search Usage",
    tableFromObject(dashboard.metrics.search_usage),
    "",
    "## Error Rates",
    tableFromObject(dashboard.metrics.error_rates),
    ""
  ];
  return `${lines.join("\n")}\n`;
}

function feedbackRates(records) {
  const total = records.length;
  const byDecision = countBy(records, (record) => record.decision ?? "unknown");
  return {
    total,
    accept: byDecision.accept ?? 0,
    reject: byDecision.reject ?? 0,
    revise: byDecision.revise ?? 0,
    accept_rate: rate(byDecision.accept ?? 0, total),
    reject_rate: rate(byDecision.reject ?? 0, total),
    revise_rate: rate(byDecision.revise ?? 0, total)
  };
}

function expertRouting(items) {
  const total = items.length;
  const expert = items.filter((item) => item.requires_expert_review === true || item.queue === "expert-review").length;
  return {
    total_queue_items: total,
    expert_review_items: expert,
    expert_review_rate: rate(expert, total),
    open_expert_review_items: items.filter((item) =>
      (item.requires_expert_review === true || item.queue === "expert-review") &&
      item.status !== "closed"
    ).length
  };
}

function releaseEvents(events) {
  return {
    release_candidate_created: events.filter((event) => event.event_type === "release_candidate_created").length,
    release_rollback: events.filter((event) => event.event_type === "release_rollback").length,
    staged_for_release: events.filter((event) =>
      event.event_type === "proposal_staged_for_release" ||
      event.event_type === "mapping_candidate_staged"
    ).length
  };
}

function searchUsage(events) {
  const total = events.length;
  const uniqueUsers = new Set(events.map((event) => event.actor_user_id).filter(Boolean)).size;
  const resultCounts = events.map((event) => Number(event.result_count ?? 0));
  return {
    total_searches: total,
    unique_users: uniqueUsers,
    zero_result_searches: events.filter((event) => Number(event.result_count ?? 0) === 0).length,
    average_result_count: total === 0 ? 0 : round(resultCounts.reduce((sum, value) => sum + value, 0) / total)
  };
}

function errorRates(events) {
  const total = events.length;
  const byService = countBy(events, (event) => event.service ?? "unknown");
  return {
    total_errors: total,
    critical_errors: events.filter((event) => event.severity === "critical").length,
    services_impacted: Object.keys(byService).length,
    ...Object.fromEntries(Object.entries(byService).map(([service, count]) => [`service_${service}`, count]))
  };
}

function countBy(records, selector) {
  const counts = {};
  for (const record of records) {
    const key = selector(record);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function scopedAuthorized(records, { tenant_id, environment }) {
  return records.filter((record) =>
    record?.tenant_id === tenant_id &&
    record?.environment === environment &&
    record.authz_hidden !== true &&
    record.hidden !== true &&
    record.authorized !== false
  );
}

function assertNonEmpty(value, fieldName) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} is required for server-side KPI scope`);
  }
}

function rate(numerator, denominator) {
  return denominator === 0 ? 0 : round(numerator / denominator);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function tableFromObject(value) {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return "| Metric | Value |\n|---|---|\n| none | 0 |";
  }
  return [
    "| Metric | Value |",
    "|---|---|",
    ...entries.map(([metric, metricValue]) => `| ${metric} | ${metricValue} |`)
  ].join("\n");
}
