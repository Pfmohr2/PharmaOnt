export class FusekiClient {
  constructor({
    baseUrl = process.env.FUSEKI_BASE_URL ?? "http://localhost:3030",
    dataset = process.env.FUSEKI_DATASET ?? "pharmaops_ci",
    username = process.env.FUSEKI_ADMIN_USER ?? "admin",
    password = process.env.FUSEKI_ADMIN_PASSWORD ?? "",
    fetchImpl = globalThis.fetch
  } = {}) {
    if (!fetchImpl) {
      throw new Error("FusekiClient requires fetch support");
    }
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.dataset = dataset;
    this.username = username;
    this.password = password;
    this.fetch = fetchImpl;
  }

  datasetUrl(path = "") {
    return `${this.baseUrl}/${encodeURIComponent(this.dataset)}${path}`;
  }

  async ping() {
    const response = await this.fetch(`${this.baseUrl}/$/ping`);
    return response.ok;
  }

  async query(sparql) {
    const response = await this.fetch(this.datasetUrl("/query"), {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "content-type": "application/sparql-query",
        accept: "application/sparql-results+json"
      },
      body: sparql
    });
    await assertOk(response, "SPARQL query failed");
    return response.json();
  }

  async update(sparql) {
    const body = new URLSearchParams({ update: sparql });
    const response = await this.fetch(this.datasetUrl("/update"), {
      method: "POST",
      headers: {
        ...this.authHeaders(),
        "content-type": "application/x-www-form-urlencoded"
      },
      body
    });
    await assertOk(response, "SPARQL update failed");
  }

  async putGraph(graphName, turtle) {
    const response = await this.fetch(`${this.datasetUrl("/data")}?graph=${encodeURIComponent(graphName)}`, {
      method: "PUT",
      headers: {
        ...this.authHeaders(),
        "content-type": "text/turtle"
      },
      body: turtle
    });
    await assertOk(response, `put graph failed for ${graphName}`);
  }

  async getGraph(graphName) {
    const response = await this.fetch(`${this.datasetUrl("/data")}?graph=${encodeURIComponent(graphName)}`, {
      headers: {
        ...this.authHeaders(),
        accept: "text/turtle"
      }
    });
    if (response.status === 404) {
      return "";
    }
    await assertOk(response, `get graph failed for ${graphName}`);
    return response.text();
  }

  async clearGraph(graphName) {
    await this.update(`CLEAR GRAPH <${escapeIri(graphName)}>`);
  }

  async insertTurtle(graphName, turtle) {
    const existing = await this.getGraph(graphName);
    const next = [existing.trim(), turtle.trim()].filter(Boolean).join("\n\n");
    await this.putGraph(graphName, next);
  }

  async graphHasTriples(graphName) {
    const result = await this.query(`ASK WHERE { GRAPH <${escapeIri(graphName)}> { ?s ?p ?o } }`);
    return Boolean(result.boolean);
  }

  async copyGraph(sourceGraph, targetGraph) {
    await this.update(`COPY <${escapeIri(sourceGraph)}> TO <${escapeIri(targetGraph)}>`);
  }

  authHeaders() {
    if (!this.password) {
      return {};
    }
    const token = Buffer.from(`${this.username}:${this.password}`).toString("base64");
    return { authorization: `Basic ${token}` };
  }
}

export function escapeIri(value) {
  return String(value).replace(/[<>"{}|^`\\]/g, encodeURIComponent);
}

async function assertOk(response, message) {
  if (response.ok) {
    return;
  }
  const text = await response.text().catch(() => "");
  throw new Error(`${message}: HTTP ${response.status} ${response.statusText}${text ? `: ${text}` : ""}`);
}
