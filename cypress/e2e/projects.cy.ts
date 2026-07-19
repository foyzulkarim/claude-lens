const FIXTURE_RANGE = "?from=2026-06-01T00%3A00%3A00.000Z&to=2026-07-31T23%3A59%3A59.000Z";

// Review #17: 10s default command timeout — matches the Models / Trends /
// Dashboard smoke specs. Cypress's stock timeout is too short for the
// Vite dev-server cold path.
const COMMAND_TIMEOUT_MS = 10_000;
Cypress.config("defaultCommandTimeout", COMMAND_TIMEOUT_MS);

// ECharts + ResizeObserver benign loop warning — every chart-heavy
// smoke spec (Dashboard, Cache Lab, Trends, Models) suppresses this.
Cypress.on("uncaught:exception", (err) => {
  if (err.message.includes("ResizeObserver loop completed")) return false;
});

/**
 * Projects page smoke spec (ARCH §5 — Projects; #P4-7). Loads
 * `/projects` over the fixture range, asserts every binding §5
 * section renders with real (fixture-derived) content, and
 * exercises one project-row drill + one branch-bar drill into
 * filtered `/sessions` views.
 *
 * The fixture fleet covers `project` × `gitBranch` dimensions, so
 * the efficiency table populates, the project-selector chip row
 * renders, and the branch panel has at least one branch to drill.
 */
describe("projects smoke", () => {
  it("renders every Projects page section from fixtures", () => {
    cy.visit(`/projects${FIXTURE_RANGE}`);
    cy.contains("h1", "Projects").should("be.visible");

    // 1. Spend composition over time — stacked-area wrapper present.
    cy.get('[data-testid="spend-composition"]').should("be.visible");
    cy.contains('[data-testid="spend-composition"] h2', "Spend composition").should("be.visible");

    // 2. Projects efficiency table — every binding column renders at
    // least its header.
    cy.get('[data-testid="projects-efficiency"]').should("be.visible");
    cy.get('[data-testid="projects-efficiency"]').within(() => {
      cy.contains("Project").should("be.visible");
      cy.contains("Spend").should("be.visible");
      cy.contains("Sessions").should("be.visible");
      cy.contains("$ / session").should("be.visible");
      cy.contains("Cache %").should("be.visible");
      cy.contains("Tok / turn").should("be.visible");
      cy.contains("Gate pass").should("be.visible");
      cy.contains("Last active").should("be.visible");
      cy.get("tbody tr").should("have.length.at.least", 1);
    });

    // 3. Project selector — chip row visible with at least one chip.
    cy.get('[data-testid="project-selector"]').should("be.visible");
    cy.get('[data-testid="project-selector"] button[aria-pressed]').should(
      "have.length.at.least",
      1,
    );

    // 4. Branch breakdown — once the auto-select lands, the panel
    // renders `<top-project> · by branch` and at least one bar.
    cy.get('[data-testid="branch-breakdown"]').should("be.visible");
    cy.get('[data-testid="branch-breakdown"]').within(() => {
      cy.get("li button[aria-label^='View sessions for branch']").should("have.length.at.least", 1);
    });
  });

  it("drills from the efficiency table to a filtered Sessions view", () => {
    cy.visit(`/projects${FIXTURE_RANGE}`);
    cy.get('[data-testid="projects-efficiency"]').should("be.visible");

    // The DataTable renders a clickable `→` action button in the
    // first cell of every row, mirroring the Models page's drill
    // contract (so Cypress can drive it without juggling row coords).
    cy.get('[data-testid="projects-efficiency"]').within(() => {
      cy.get("tbody tr button[aria-label^='View sessions for project']").first().click();
    });

    cy.location("pathname").should("eq", "/sessions");
    cy.location("search").should((search) => {
      // The projectHref helper preserves the canonical date range and
      // appends `project=<value>` (see projects/drilldown.test.ts).
      expect(search).to.include("from=");
      expect(search).to.include("to=");
      expect(search).to.match(/project=/);
    });

    // The Sessions page must render — a drill is a real navigation,
    // not just a URL swap.
    cy.contains("h1", "Sessions").should("be.visible");
  });

  it("drills from a branch bar to a project+branch filtered Sessions view", () => {
    cy.visit(`/projects${FIXTURE_RANGE}`);
    cy.get('[data-testid="branch-breakdown"]').should("be.visible");

    cy.get('[data-testid="branch-breakdown"]').within(() => {
      cy.get("li button[aria-label^='View sessions for branch']").first().click();
    });

    cy.location("pathname").should("eq", "/sessions");
    cy.location("search").should((search) => {
      // branchHref emits `project=` AND `branch=` so the Sessions
      // page filters on both chips — see projects/drilldown.test.ts.
      expect(search).to.match(/project=/);
      expect(search).to.match(/branch=/);
    });

    cy.contains("h1", "Sessions").should("be.visible");
  });
});
