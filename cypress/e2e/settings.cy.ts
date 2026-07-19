Cypress.config("defaultCommandTimeout", 10_000);

// See steel-thread.cy.ts for why this is here: a benign ECharts/
// ResizeObserver browser warning, not a real error.
Cypress.on("uncaught:exception", (err) => {
  if (err.message.includes("ResizeObserver loop completed")) return false;
});

/**
 * Settings page smoke spec (#P4-15 / issue #47 / ARCH-settings-local-store.md).
 * Asserts every Settings panel renders from fixture-derived config and
 * exercises one drill-link from the saved-views manager back to the
 * Sessions page (the canonical "I saved this view, go back to it" loop).
 * Definition-of-Done item (#P4-15): "route renders key sections from
 * fixtures; one drill-link lands filtered."
 */
describe("settings smoke", () => {
  it("renders every Settings panel from fixture config", () => {
    cy.visit("/settings");

    cy.contains("h1", "Settings").should("be.visible");

    // Pricing editor — known-model rows seeded from DEFAULT_MODEL_KEYS
    cy.get('[data-testid="pricing-editor"]')
      .should("be.visible")
      .within(() => {
        cy.contains("h2", /Pricing table/i).should("be.visible");
        cy.get("table").should("exist");
        cy.contains("button", "Save").should("be.visible");
      });

    // Scan roots editor — the host dimension seam
    cy.get('[data-testid="scan-roots-editor"]')
      .should("be.visible")
      .within(() => {
        cy.contains("h2", /Scan roots/i).should("be.visible");
        cy.contains(/label = host dimension/i).should("be.visible");
      });

    // Thresholds panel — budget/anomaly/gate thresholds unified
    cy.get('[data-testid="thresholds-panel"]')
      .should("be.visible")
      .within(() => {
        cy.contains("h2", /Budget.*thresholds/i).should("be.visible");
        cy.get("#settings-budget").should("exist");
        cy.get("#settings-anomaly").should("exist");
      });

    // Cost-capture setup guide
    cy.get('[data-testid="cost-capture-guide"]')
      .should("be.visible")
      .within(() => {
        cy.contains(/cost.*capture|capture.*cost/i).should("be.visible");
      });

    // Saved views + tags manager
    cy.get('[data-testid="saved-views-tags-panel"]')
      .should("be.visible")
      .within(() => {
        cy.contains(/saved views/i).should("be.visible");
        cy.contains(/tags/i).should("be.visible");
      });
  });

  it("drill-link from a saved view lands on the filtered Sessions page (#P4-15 DoD)", () => {
    // Seed a saved view through the FilterBar (architecture §11: filter
    // state lives in the URL, saved views are permalinks), then assert
    // the Settings → Saved-views manager renders a button that returns
    // the user to that filtered Sessions view.
    cy.visit(`/sessions?from=2026-07-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z`);

    // The FilterBar exposes the "Save view" action globally (ARCH A5).
    cy.contains("button", /save view/i).click();
    cy.get('[data-testid="save-view-name-input"]').type("July fixtures");
    cy.contains("button", /^save$/i).click();

    // Drill from the Settings saved-views manager back to the filtered
    // Sessions page (the documented user journey: save → manage → reload).
    cy.visit("/settings");
    cy.get('[data-testid="saved-views-tags-panel"]').within(() => {
      cy.contains("July fixtures").should("be.visible");
      cy.contains("button", /open|load|view/i)
        .first()
        .click();
    });

    cy.location("pathname").should("eq", "/sessions");
    cy.location("search").should("include", "from=2026-07-01");
    cy.location("search").should("include", "to=2026-08-01");
  });
});
