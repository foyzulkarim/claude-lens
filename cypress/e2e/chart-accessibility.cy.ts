import "cypress-axe";

const FIXTURE_RANGE = "?from=2026-07-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z";

describe("chart accessibility (#84)", () => {
  it("has no automatically-detectable a11y violations on the loaded chart card", () => {
    cy.visit(`/${FIXTURE_RANGE}`);
    cy.get('[data-testid="chart-card"]').should("be.visible");

    cy.injectAxe();
    cy.checkA11y('[data-testid="chart-card"]');
  });

  it("has no automatically-detectable a11y violations while loading (AA contrast target)", () => {
    // Hold the response open so the `role="status"` "Loading…" text — the
    // exact element whose color this PR brought up to WCAG AA contrast —
    // is still on screen when axe scans it.
    cy.intercept("POST", "/api/metrics", (req) => {
      req.on("response", (res) => {
        res.setDelay(4000);
      });
    }).as("metricsDelayed");

    cy.visit(`/${FIXTURE_RANGE}`);
    cy.get('[data-testid="chart-card"] [role="status"]').should("contain.text", "Loading");

    cy.injectAxe();
    cy.checkA11y('[data-testid="chart-card"]');

    cy.wait("@metricsDelayed");
  });

  it("has no automatically-detectable a11y violations in the error state (AA contrast target)", () => {
    cy.intercept("POST", "/api/metrics", {
      statusCode: 500,
      body: { error: "Simulated failure" },
    }).as("metricsError");

    cy.visit(`/${FIXTURE_RANGE}`);
    cy.wait("@metricsError");
    // TanStack Query's default retries mean the error state can take a few
    // seconds to surface — same tolerance style as steel-thread.cy.ts's WS
    // update wait.
    cy.get('[data-testid="chart-card"] [role="alert"]', { timeout: 20000 }).should("be.visible");

    cy.injectAxe();
    cy.checkA11y('[data-testid="chart-card"]');
  });

  it("has no automatically-detectable a11y violations with the data table open", () => {
    cy.visit(`/${FIXTURE_RANGE}`);
    cy.get('[data-testid="chart-card"]').contains("button", "Data table").click();
    cy.get('[data-testid="chart-card"] table').should("be.visible");

    cy.injectAxe();
    cy.checkA11y('[data-testid="chart-card"]');
  });

  it("reaches the filtered Sessions destination via keyboard alone", () => {
    cy.visit(`/${FIXTURE_RANGE}`);
    cy.get('[role="img"][aria-label^="Cost over time chart;"]').should("be.visible");

    cy.get('[data-testid="chart-card"]').contains("button", "Data table").click();

    // No Tab-order plugin is installed, so drive the row's real <button>
    // directly via its accessible name (not a presentational CSS class —
    // see #84 review finding C1): .focus() proves it's a natively
    // focusable control in the DOM's tab order (not a div with an
    // onClick). Real `<button type="button">` elements activate on
    // Enter/Space as a browser platform guarantee, not app-level logic —
    // so proving this is a genuine focusable button is the load-bearing
    // check; ChartCard.test.tsx separately drives the Enter keypress
    // itself via userEvent to prove the same URL is reached.
    cy.get('[data-testid="chart-card"] table tbody tr')
      .first()
      .find('button[aria-label^="View sessions for "]')
      .focus()
      .click();

    cy.location("pathname").should("eq", "/sessions");
    cy.location("search").should((search) => {
      expect(search).to.include("from=");
      expect(search).to.include("to=");
    });
  });
});
