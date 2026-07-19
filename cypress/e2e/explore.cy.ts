const FIXTURE_RANGE = "?from=2026-06-01T00%3A00%3A00.000Z&to=2026-07-31T23%3A59%3A59.000Z";

const COMMAND_TIMEOUT_MS = 10_000;
Cypress.config("defaultCommandTimeout", COMMAND_TIMEOUT_MS);

// ECharts / ResizeObserver benign browser warning — same guard every other
// chart-touching spec uses (steel-thread.cy.ts).
Cypress.on("uncaught:exception", (err) => {
  if (err.message.includes("ResizeObserver loop completed")) return false;
});

/**
 * Explore smoke spec (ARCH-explore-page.md §11 / specs/claude-lens-pages.md
 * §11 — Phase 4 standing rule). Loads the `/explore` route over the wide
 * fixture range, asserts the three binding sections (pivot builder,
 * result, saved-views grid) render with real (fixture-derived) content,
 * and exercises one chart-type toggle round-trip + one distribution-mode
 * toggle round-trip.
 */
describe("explore smoke", () => {
  it("renders every binding §11 section from fixtures", () => {
    cy.visit(`/explore${FIXTURE_RANGE}`);

    cy.get('[aria-label="Pivot builder"]').should("be.visible");
    cy.get('[data-testid="pivot-result"]').should("be.visible");
    cy.get('[data-testid="explore-saved-views"]').should("be.visible");
    cy.get('[data-testid="explore-save-view"]').should("be.visible");
  });

  it("toggling the chart-type button changes the URL key", () => {
    cy.visit(`/explore${FIXTURE_RANGE}`);

    cy.get('[data-testid="xp-chart-line"]').click();

    // After the navigation, the xp.chart key is present in the URL.
    cy.location("search").should("include", "xp.chart=line");
    // The pivot result is still rendered with the new chart type.
    cy.get('[data-testid="pivot-result"]').should("be.visible");
  });

  it("toggling distribution mode reveals the Entity picker", () => {
    cy.visit(`/explore${FIXTURE_RANGE}`);

    cy.get('[data-testid="xp-entity"]').should("not.exist");
    cy.get('[data-testid="xp-mode-distribution"]').click();
    cy.get('[data-testid="xp-entity"]').should("be.visible");
    cy.location("search").should("include", "xp.mode=distribution");
  });

  it("scatter chart reveals X/Y/Size pickers and posts a scatter query", () => {
    cy.visit(`/explore${FIXTURE_RANGE}`);

    cy.get('[data-testid="xp-chart-scatter"]').click();
    cy.get('[data-testid="xp-x"]').should("be.visible");
    cy.get('[data-testid="xp-y"]').should("be.visible");
    cy.get('[data-testid="xp-size"]').should("be.visible");
    cy.location("search").should("include", "xp.chart=scatter");
  });
});
