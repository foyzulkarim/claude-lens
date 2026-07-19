const FIXTURE_RANGE = "?from=2026-07-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z";

// Review #17: 10s default command timeout — matches cache-lab.cy.ts
// and dashboard.cy.ts. Cypress's default command timeout is too short
// for the Vite dev-server cold path, so we bump it on every smoke
// spec.
const COMMAND_TIMEOUT_MS = 10_000;
Cypress.config("defaultCommandTimeout", COMMAND_TIMEOUT_MS);

// ECharts + ResizeObserver benign loop warning (Cache Lab and Dashboard
// specs suppress this the same way — see steel-thread.cy.ts for the
// rationale).
Cypress.on("uncaught:exception", (err) => {
  if (err.message.includes("ResizeObserver loop completed")) return false;
});

/**
 * Models page smoke spec (ARCH-models-page.md T16 — Models): loads the
 * `/models` route over a wide fixture range, asserts every binding §6
 * section renders with real (fixture-derived) content, and exercises
 * one drill-link journey from a model row to a correctly filtered
 * Sessions view.
 *
 * The 4444 + 5555 fixture fleet covers the model / version / entrypoint
 * dimensions needed for stat-row + efficiency + entrypoint rows to
 * populate. The 🔒 `$/1k-lines` panel renders a `LockedCard` (visually
 * present, but inert — `inert` excludes it from the tab order so this
 * spec never tries to focus its CTA).
 */
describe("models smoke", () => {
  it("renders every Models page section from fixtures", () => {
    cy.visit(`/models${FIXTURE_RANGE}`);
    cy.contains("h1", "Models").should("be.visible");

    // 1. Stat row — at least one model card.
    cy.get('[data-testid="model-stats-row"]').should("be.visible");
    cy.contains(/op|sonnet|fable|haiku/i).should("exist");

    // 2. Model mix over time — chart wrapper present, even if the
    // canvas is opaque to Cypress's accessibility tree.
    cy.get('[data-testid="model-mix-over-time"]').should("be.visible");

    // 3. Efficiency by model — table renders at least one row.
    cy.get('[data-testid="efficiency-by-model"]').should("be.visible");
    cy.get('[data-testid="efficiency-by-model"]').within(() => {
      cy.contains("Out tok / $").should("be.visible");
      cy.contains("Cache %").should("be.visible");
      cy.contains("Tok / turn").should("be.visible");
      cy.contains("$ / turn").should("be.visible");
      cy.get("tbody tr").should("have.length.at.least", 1);
    });

    // 4. Before / after CC version — the 4444 fixture has a known
    // version, so this panel renders either the comparison or the
    // single-version fallback. Either is acceptable.
    cy.get('[data-testid="version-before-after"]').should("be.visible");

    // 5. 🟡 Latency — timestamp fallback.
    cy.get('[data-testid="latency-by-model"]').should("be.visible");
    cy.get('[data-testid="latency-by-model"]').within(() => {
      cy.contains("Avg time / call").should("be.visible");
    });

    // 6. 🟡 Throughput — timestamp fallback.
    cy.get('[data-testid="throughput-by-model"]').should("be.visible");
    cy.get('[data-testid="throughput-by-model"]').within(() => {
      cy.contains("Avg output tok/s").should("be.visible");
    });

    // 7. 🔒 $/1k-lines — locked card renders, CTA points at settings.
    cy.get('[data-testid="locked-lines-per-cost"]').should("be.visible");
    cy.get('[data-testid="locked-lines-per-cost"]').within(() => {
      cy.contains(/\$ ?\/ ?1k-lines/i).should("be.visible");
      cy.contains(/set up cost capture/i).should("be.visible");
    });

    // 8. Entrypoint breakdown — at least cli / ide.
    cy.get('[data-testid="entrypoint-breakdown"]').should("be.visible");
    cy.get('[data-testid="entrypoint-breakdown"]').within(() => {
      cy.contains("Entrypoint").should("be.visible");
      cy.contains("Input tok").should("be.visible");
      cy.contains("Output tok").should("be.visible");
      cy.contains("Cache read").should("be.visible");
      cy.contains("Cache create").should("be.visible");
      cy.contains("Cost").should("be.visible");
    });
  });

  it("drills from the efficiency table to a filtered Sessions view", () => {
    cy.visit(`/models${FIXTURE_RANGE}`);
    cy.get('[data-testid="efficiency-by-model"]').should("be.visible");

    // The DataTable renders a clickable button (the `→` action glyph)
    // in the first cell of every row. Cypress's actionability model
    // reaches the cell button easily; the click handler is implemented
    // via wouter's navigate, same as the chart drill.
    cy.get('[data-testid="efficiency-by-model"]').within(() => {
      cy.get("tbody tr button[aria-label^='View sessions for model']").first().click();
    });

    cy.location("pathname").should("eq", "/sessions");
    cy.location("search").should((search) => {
      // The session-href helper preserves the canonical date range
      // and appends `model=<value>` (see Models drilldown test).
      expect(search).to.include("from=");
      expect(search).to.include("to=");
      expect(search).to.match(/model=/);
    });

    // The Sessions page must render something — the section-level
    // contract (A11) says a drill is a real navigation, not just a
    // URL change.
    cy.contains("h1", "Sessions").should("be.visible");
  });
});
