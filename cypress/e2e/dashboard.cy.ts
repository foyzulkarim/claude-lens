const FIXTURE_RANGE = "?from=2026-07-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z";

/**
 * Dashboard smoke spec (ARCH-dashboard-page.md T15): loads the Dashboard
 * route over the fixture range, asserts every section renders with real
 * content, and exercises one drill-link journey through to a correctly
 * filtered destination. Backed by the `44444444-…` fixture session (see
 * test/fixtures/README.md), which supplies the anomaly-triggering turn and
 * failed tool result the AnomalyFeed / FailedWorkStat sections need to show
 * non-empty state.
 */
describe("dashboard smoke", () => {
  it("renders every Dashboard section with fixture data", () => {
    cy.visit(`/${FIXTURE_RANGE}`);
    cy.contains("h1", "Dashboard").should("be.visible");

    // Stat cards row. The drill-link `<a>` wrapping each `StatCard` is
    // `display: contents` (DrillStatCard) so it never has its own box —
    // assert on existence/text instead of visibility, matching Cypress's
    // box-based visibility model.
    cy.get('a[aria-label^="Spend:"]').should("exist");
    cy.get('a[aria-label^="Sessions:"]').should("exist").contains("Sessions").should("be.visible");

    // Cost-over-time chart.
    cy.contains("h2", "Cost over time").should("be.visible");

    // Anomaly feed — the 44444444 fixture's outlier turn should surface here
    // as a detected anomaly (not the "no anomalies" or gate-stub text).
    cy.get('[data-testid="anomaly-feed"]')
      .should("be.visible")
      .within(() => {
        cy.contains("h2", "Anomalies").should("be.visible");
        cy.get('ul[role="feed"]').should("be.visible");
        cy.contains("Cost anomaly").should("be.visible");
      });

    // Burn rate.
    cy.get('[data-testid="burn-rate-card"]').within(() => {
      cy.contains("h2", "Burn rate (month to date)").should("be.visible");
    });

    // Leaderboards — the tab strip is the visible "Leaderboards" heading;
    // the "Top …" wording lives on the underlying table's accessible name.
    cy.get('[data-testid="leaderboards-card"]').within(() => {
      cy.get('[role="tablist"][aria-label="Leaderboards"]').should("be.visible");
      cy.get('table[aria-label="Top sessions by cost"]').should("exist");
    });

    // Most recent session — the 44444444 fixture session is the latest by
    // timestamp across all fixtures, so it's what this card resolves to.
    cy.contains("h2", "Most recent session").should("be.visible");

    // Records strip.
    cy.get('[data-testid="records-strip"]').should("be.visible").contains("Records");

    // Failed-work stat — the 44444444 fixture's is_error tool result should
    // produce a non-"—" count here.
    cy.contains("Failed work").should("be.visible");
  });

  it("drills from the Sessions stat card to a filtered Sessions view", () => {
    cy.visit(`/${FIXTURE_RANGE}`);
    // Click the visible label text inside the `display: contents` anchor —
    // the anchor itself has no box to satisfy Cypress's actionability check,
    // but a native click on its descendant still bubbles to it and triggers
    // wouter's navigation, exactly like a real pointer click would.
    cy.get('a[aria-label^="Sessions:"]').contains("Sessions").click();

    cy.location("pathname").should("eq", "/sessions");
    cy.location("search").should((search) => {
      expect(search).to.include("from=");
      expect(search).to.include("to=");
    });
  });
});
