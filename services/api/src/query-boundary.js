import { filterAuthorizedResponse, filterAuthorizedResults } from "../../authz-filter/src/index.js";

export async function executeAuthorizedQuery({
  principal,
  query,
  resolver,
  candidateResults = null,
  releaseContext = null
}) {
  const rawResults = candidateResults ?? await resolver(query, principal);
  const results = filterAuthorizedResults({
    principal,
    results: rawResults,
    action: "read",
    releaseContext
  });
  return {
    query,
    results,
    total: results.length,
    authorization_filtered: true
  };
}

export function filterApiResponse({ principal, response, releaseContext = null }) {
  return filterAuthorizedResponse({
    principal,
    response,
    action: "read",
    releaseContext
  });
}
