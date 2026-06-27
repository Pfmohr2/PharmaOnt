# services/authz-filter

Server-side result authorization filter for Phase 5 query, search, and export paths.

`filterAuthorizedResults({ principal, results, action, releaseContext })` is the mandatory chokepoint before a result set leaves a backend service. Clients may not receive raw search, API, or export rows and filter them locally.

The filter fails closed when a result is missing tenant or environment context, belongs to another tenant/environment, lacks required role visibility, violates assertion-type visibility, lacks release context for export, has blocked license status, or lacks the requested permitted use.

The filter and its API/search/export wrappers do not return authorization-hidden counts. Fields such as `filtered_count`, `hidden_count`, or `authorization_filtered_count` are prohibited on serialized service responses because they can reveal cross-tenant or restricted candidates.

Primary callers:

- Stanley/API: `services/api/src/query-boundary.js`
- Dwight/Search: `services/search/src/index.js`
- Export: `services/export/src/index.js`
