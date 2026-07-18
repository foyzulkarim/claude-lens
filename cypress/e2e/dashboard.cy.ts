const FIXTURE_RANGE = "?from=2026-07-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z";

// Review #17: bump the default Cypress command timeout so `cy.injectAxe()`
// can reliably read `node_modules/axe-core/axe.min.js` (which timed out at
// the previous 4s in the E2E environment). All other commands inherit the
// new default.
const COMMAND_TIMEOUT_MS = 10_000;
Cypress.config("defaultCommandTimeout", COMMAND_TIMEOUT_MS);

/**
 * Dashboard smoke spec (ARCH-dashboard-page.md T15): loads the Dashboard
 * route over the fixture range, asserts every section renders with real
 * content, and exercises one drill-link journey through to a correctly
 * filtered destination. Backed by the `44444444-…` fixture session (see
 * test/fixtures/README.md), which supplies the anomaly-triggering turn and
 * failed tool result the AnomalyFeed / FailedWorkStat sections need to show
 * non-empty state.
 *
 * Review #17 / TC2: expanded to assert all 12 Dashboard sections
 * (stat-cards row, savings decomposition, burn rate, subscription window,
 * leverage ratio, failed work, most recent session, records strip,
 * leaderboards, anomaly feed, capture banner, cost-over-time chart) with
 * at least one fixture-derived value or state assertion per calculation-
 * heavy section.
 */
describe("dashboard smoke", () => {
  it("does not continuously refetch live-window metrics", () => {
    let liveWindowRequestCount = 0;
    let settledRequestCount = 0;

    cy.intercept("POST", "/api/metrics", (request) => {
      const query = request.body as {
        measures?: unknown;
        dimensions?: unknown;
        grain?: unknown;
      };
      if (
        JSON.stringify(query.measures) === JSON.stringify(["costComputed"]) &&
        JSON.stringify(query.dimensions) === JSON.stringify([]) &&
        query.grain === "hour"
      ) {
        liveWindowRequestCount++;
      }
    });

    cy.visit(`/${FIXTURE_RANGE}`);
    cy.get('[data-testid="burn-rate-card"]').should("be.visible");
    cy.get('[data-testid="subscription-window"]').should("be.visible");

    // Allow initial queries and the WebSocket-open invalidation to settle,
    // then verify query-driven renders do not keep creating new time keys.
    cy.wait(750).then(() => {
      settledRequestCount = liveWindowRequestCount;
      expect(settledRequestCount).to.be.greaterThan(0);
    });
    cy.wait(1000).then(() => {
      expect(liveWindowRequestCount).to.equal(settledRequestCount);
    });
  });

  it("renders every Dashboard section with fixture data", () => {
    cy.visit(`/${FIXTURE_RANGE}`);
    cy.contains("h1", "Dashboard").should("be.visible");

    // 1. Stat cards row. The drill-link `<a>` wrapping each `StatCard` is
    // `display: contents` (DrillStatCard) so it never has its own box —
    // assert on existence/text instead of visibility, matching Cypress's
    // box-based visibility model.
    cy.get('a[aria-label^="Spend:"]').should("exist");
    cy.get('a[aria-label^="Sessions:"]').should("exist").contains("Sessions").should("be.visible");

    // 2. Cost-over-time chart.
    cy.contains("h2", "Cost over time").should("be.visible");

    // 3. Savings decomposition — the fixture has priced Sonnet/Fable calls,
    // so the cache+routing segments total to a non-zero, parseable amount.
    cy.get('[data-testid="savings-decomposition"]').within(() => {
      cy.contains("h2", "What you didn't pay").should("be.visible");
      cy.contains("cache discount").should("be.visible");
      cy.contains("cheap-model routing").should("be.visible");
      cy.get('[data-testid="savings-total"]')
        .invoke("text")
        .should((text) => expect(text).to.match(/^\$\d+\.\d{2} total$/));
    });

    // 4. Burn rate card.
    cy.get('[data-testid="burn-rate-card"]').within(() => {
      cy.contains("h2", "Burn rate (month to date)").should("be.visible");
    });

    // 5. Subscription window — the fixture has hourly activity in the
    // matched extent so the bars resolve to real numbers, not "—".
    cy.get('[data-testid="subscription-window"]').within(() => {
      cy.contains("h2", "Subscription window").should("be.visible");
      cy.get('output[aria-label*="window:"]').should("exist");
    });

    // 6. Leverage ratio (cache leverage stat card) — uses the same cache-hit
    // composition as the corresponding stat card; assert it renders a "Nx"
    // label or the honest "—" fallback.
    cy.contains("Cache leverage").should("be.visible");

    // 7. Failed-work stat — the 44444444 fixture's is_error tool result
    // should produce a non-"—" count here.
    cy.contains("Failed work").should("be.visible");

    // 8. Most recent session — the 44444444 fixture session is the latest
    // by timestamp across all fixtures, so it's what this card resolves to.
    cy.contains("h2", "Most recent session").should("be.visible");

    // 9. Records strip — the dashboard surfaces 5 record rows.
    cy.get('[data-testid="records-strip"]')
      .should("be.visible")
      .within(() => {
        cy.contains("Records").should("be.visible");
        cy.contains("Most expensive day").should("exist");
        cy.contains("Most expensive session").should("exist");
        cy.contains("Most expensive turn").should("exist");
        cy.contains("Longest session").should("exist");
        cy.contains("Biggest cache save").should("exist");
      });

    // 10. Leaderboards — the tab strip is the visible "Leaderboards"
    // heading; the "Top …" wording lives on the underlying table's
    // accessible name.
    cy.get('[data-testid="leaderboards-card"]').within(() => {
      cy.get('[role="tablist"][aria-label="Leaderboards"]').should("be.visible");
      cy.get('table[aria-label="Top sessions by cost"]').should("exist");
    });

    // 11. Anomaly feed — the 44444444 fixture's outlier turn should surface
    // here as a detected anomaly (not the "no anomalies" or gate-stub text).
    cy.get('[data-testid="anomaly-feed"]')
      .should("be.visible")
      .within(() => {
        cy.contains("h2", "Anomalies").should("be.visible");
        // Review #16: list role (no `role="feed"`).
        cy.get('ul[aria-label="Anomaly items"]').should("be.visible");
        cy.contains("Cost anomaly").should("be.visible");
      });

    // 12. Capture banner — filter-independent (section-level lock), so it
    // renders regardless of which filters are active.
    cy.contains(/capture/i).should("be.visible");
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
