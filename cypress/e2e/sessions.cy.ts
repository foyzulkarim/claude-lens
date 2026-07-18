const FIXTURE_RANGE = "?from=2026-07-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z";

Cypress.config("defaultCommandTimeout", 10_000);

// See steel-thread.cy.ts for why this is here: a benign ECharts/
// ResizeObserver browser warning, not a real error.
Cypress.on("uncaught:exception", (err) => {
  if (err.message.includes("ResizeObserver loop completed")) return false;
});

/**
 * Sessions page smoke spec (ARCH-sessions-page.md T9 / #P4-4 / issue #36).
 * Loads the Sessions route over the fixture range, asserts every binding
 * section renders with real fixture-derived content, and exercises the
 * session drill-link journey. Backed by the existing four-session fixture
 * set (see test/fixtures/README.md) — no fixture rewrites.
 */
describe("sessions smoke", () => {
  it("renders every binding section from fixture data", () => {
    cy.visit(`/sessions${FIXTURE_RANGE}`);
    cy.contains("h1", "Sessions").should("be.visible");

    // 1. Prompt search seam — visibly unavailable (ARCH R8/A11).
    cy.get('[data-testid="prompt-search-slot"]')
      .should("be.visible")
      .within(() => {
        cy.contains("Search prompts").should("be.visible");
        cy.contains(/unavailable/i).should("be.visible");
      });

    // 2. Sessions filters (page-only: cost bounds, entrypoint, drilldown).
    cy.get('[data-testid="sessions-filters"]')
      .should("be.visible")
      .within(() => {
        cy.get("#min-cost").should("exist");
        cy.get("#max-cost").should("exist");
        cy.get("#entrypoint").should("exist");
      });

    // 3. Sessions table — fixture-derived rows exist and drill to a real
    // Session Detail destination.
    cy.get('[data-testid="session-browser"]')
      .should("be.visible")
      .within(() => {
        cy.get("table").should("exist");
        // 4 fixture sessions all land in the July 2026 range.
        cy.get("tbody tr").should("have.length.at.least", 1);
      });

    // 4. Timeline toggle uses the already-fetched response (ARCH R4) — no
    // extra request is exercised here, just that the toggle switches view.
    cy.get('[data-testid="session-browser"]').within(() => {
      cy.contains("button", "Timeline").click();
      cy.get('[data-testid="sessions-timeline"]').should("be.visible");
      cy.contains("button", "Table").click();
      cy.get("table").should("be.visible");
    });

    // 5. Efficiency scatter (server-computed regression/eligibility).
    cy.get('[data-testid="efficiency-scatter-card"]')
      .should("be.visible")
      .within(() => {
        cy.contains("h2", "Efficiency scatter").should("be.visible");
        cy.contains("button", "$ × duration").should("be.visible");
      });

    // 6. Cost distribution (histogram + percentiles).
    cy.get('[data-testid="cost-distribution-card"]')
      .should("be.visible")
      .within(() => {
        cy.contains("h2", "Session cost distribution").should("be.visible");
        cy.contains("button", "Histogram").should("be.visible");
      });

    // 7. Compare mode — empty-selection prompt when fewer than 2 IDs chosen.
    cy.get('[data-testid="session-compare"]')
      .should("be.visible")
      .within(() => {
        cy.contains("h2", "Compare sessions").should("be.visible");
        cy.contains(/select 2.3 sessions/i).should("be.visible");
      });

    // 8. Tags seam — visibly reserved for #P4-15.
    cy.get('[data-testid="tags-stub"]')
      .should("be.visible")
      .within(() => {
        cy.contains("h2", "Tags").should("be.visible");
      });
  });

  it("drills from a session row to the Session Detail destination", () => {
    cy.visit(`/sessions${FIXTURE_RANGE}`);
    cy.get('[data-testid="session-browser"]').within(() => {
      cy.get("tbody tr").first().find("button[aria-label^='View session']").click();
    });
    cy.location("pathname").should("match", /^\/sessions\/[0-9a-f-]+$/);
  });

  it("comparison URL state hydrates the compare panel with two selected sessions", () => {
    // Compare hydration is driven by the URL's `compare=` param (ARCH R10)
    // rather than a click-selection model in this issue's scope — assert
    // the URL-driven path renders a real comparison table.
    cy.visit(
      `/sessions${FIXTURE_RANGE}&compare=11111111-1111-4111-8111-111111111111,44444444-4444-4444-8444-444444444444`,
    );
    cy.get('[data-testid="session-compare"]').within(() => {
      cy.contains(/2\/3 selected/i).should("be.visible");
      cy.get("table").should("exist");
      cy.contains("th", "11111111").should("be.visible");
      cy.contains("th", "44444444").should("be.visible");
    });
  });
});
