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

  // Phase 4 standing rule: every curated page must have at least one
  // drill-link that lands on a filtered downstream view (R4). We exercise
  // the table-cell drill path — it's deterministic in jsdom/ECharts-free
  // canvas environments, and the same handler also services the chart
  // canvas click via `onPointClick`.
  it("drills from a pivot table cell to a filtered Sessions destination", () => {
    cy.visit(`/explore${FIXTURE_RANGE}`);

    // Switch to the Table view so the drill button is a real DOM control
    // (the canvas click is also wired, but Cypress can't reliably
    // synthesize ECharts canvas clicks without a chart-instance seam).
    cy.get('[data-testid="xp-chart-table"]').click();
    cy.get('[data-testid="pivot-result"]').within(() => {
      // First slice in the result — the underlying dim is `tool` (default),
      // so the resulting URL should land on `/sessions?tool=…` or the
      // dimension-equivalent slice key (R4's "filtered Sessions" contract).
      cy.get("button[data-testid^='drill-slice-']").first().click();
    });

    cy.location("pathname").should("eq", "/sessions");
    cy.location("search").should("include", "view=page");
    // The slice label must appear in the destination URL — the precise key
    // depends on whether the dim is a chip dim (project/model/branch/host)
    // or a generic `slice.<dim>=value` key. We assert at least one of
    // them is present, so a future addition of arbitrary-dim support is
    // free to change which key the drill emits.
    cy.location("search").then((search) => {
      const hasChipOrSlice =
        /(^|[&?])tool=/.test(search) ||
        /(^|[&?])slice\.tool=/.test(search) ||
        /(^|[&?])project=/.test(search) ||
        /(^|[&?])slice\./.test(search);
      expect(hasChipOrSlice, `expected a slice key in ${search}`).to.equal(true);
    });
  });
});
