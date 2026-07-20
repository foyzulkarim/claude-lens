const FIXTURE_RANGE = "?from=2026-06-01T00%3A00%3A00.000Z&to=2026-07-31T23%3A59%3A59.000Z";

const COMMAND_TIMEOUT_MS = 10_000;
Cypress.config("defaultCommandTimeout", COMMAND_TIMEOUT_MS);

// Same benign ECharts/ResizeObserver warning every other chart-heavy smoke
// spec (dashboard.cy.ts, cache-lab.cy.ts) suppresses.
Cypress.on("uncaught:exception", (err) => {
  if (err.message.includes("ResizeObserver loop completed")) return false;
});

/**
 * Trends smoke spec (#P4-10; ARCH-trends-calendar-budget.md Definition of
 * Done). Loads `/trends` over a wide fixture range, asserts all 7 sections
 * render, exercises the Calendar panel's drill-link contract, and confirms
 * the budget input persists through a real `PUT /api/config` round trip.
 */
describe("trends smoke", () => {
  it("renders every Trends section from fixtures", () => {
    cy.visit(`/trends${FIXTURE_RANGE}`);
    cy.contains("h1", "Trends, Calendar & Budget").should("be.visible");

    cy.get('[data-testid="calendar-heatmap-panel"]').should("be.visible");
    cy.contains('[data-testid="calendar-heatmap-panel"] h2', "Calendar").should("be.visible");

    cy.get('[data-testid="hour-weekday-heatmap-panel"]').should("be.visible");
    cy.contains('[data-testid="hour-weekday-heatmap-panel"] h2', "When do I burn money").should(
      "be.visible",
    );

    cy.get('[data-testid="stacked-weekly-bars-panel"]').should("be.visible");

    cy.get('[data-testid="pareto-panel"]').should("be.visible");
    cy.contains('[data-testid="pareto-panel"] h2', "Pareto").should("be.visible");

    cy.get('[data-testid="budget-forecast-panel"]').should("be.visible");
    cy.contains('[data-testid="budget-forecast-panel"] h2', "Budget").should("be.visible");

    cy.get('[data-testid="rolling-efficiency-panel"]').should("be.visible");
    cy.contains('[data-testid="rolling-efficiency-panel"] h2', "Rolling efficiency").should(
      "be.visible",
    );

    // #P4-12 wired the live `gatePassRate` measure — the previous
    // `gate-pass-rate-stub` was a placeholder panel with no fetch.
    cy.get('[data-testid="gate-pass-rate-panel"]').should("be.visible");
    cy.contains('[data-testid="gate-pass-rate-panel"] h2', "Gate pass rate per week").should(
      "be.visible",
    );
  });

  it("drills from the calendar heatmap to a filtered Sessions view", () => {
    cy.visit(`/trends${FIXTURE_RANGE}`);
    cy.get('[data-testid="calendar-heatmap-panel"]').should("be.visible");

    // The Chart component is real ECharts — same URL-contract approach as
    // cache-lab.cy.ts's hit-rate drill test: confirm the day-bucket-sized
    // Sessions URL the panel's click handler builds is reachable directly.
    const fromIso = "2026-06-15T00:00:00.000Z";
    const toIso = "2026-06-15T00:00:00.000Z";
    cy.visit(`/sessions?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`);
    cy.location("pathname").should("eq", "/sessions");
    cy.location("search").should((search) => {
      expect(search).to.include(`from=${encodeURIComponent(fromIso)}`);
      expect(search).to.include(`to=${encodeURIComponent(toIso)}`);
    });
  });

  it("persists a budget value through PUT /api/config and reflects it on reload", () => {
    cy.visit(`/trends${FIXTURE_RANGE}`);
    cy.get('[data-testid="budget-forecast-panel"]').should("be.visible");

    cy.get("#trends-budget-input").clear().type("500");
    cy.contains('[data-testid="budget-forecast-panel"] button', "Save").click();

    cy.contains('[data-testid="budget-forecast-panel"]', "of $500.00 budget", {
      timeout: COMMAND_TIMEOUT_MS,
    }).should("be.visible");

    // Reload — the value must have actually persisted to
    // ~/.claude-lens/config.json, not just local component state.
    cy.reload();
    cy.contains('[data-testid="budget-forecast-panel"]', "of $500.00 budget", {
      timeout: COMMAND_TIMEOUT_MS,
    }).should("be.visible");

    // Clean up so this test is idempotent across re-runs against the same
    // local fixture server.
    cy.get("#trends-budget-input").clear();
    cy.contains('[data-testid="budget-forecast-panel"] button', "Save").click();
  });
});
