const FIXTURE_RANGE = "?from=2026-07-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";

/**
 * Session Detail smoke spec (#P4-5, T11). Loads the real detail resource
 * from the existing multi-turn/sidechain fixture (never edited here —
 * silent-regression hotspot per the architecture doc), asserts every
 * binding section renders fixture-derived data, exercises one turn-row
 * drill to the canonical `/session/:sessionId/turn/:turnNumber` address,
 * and confirms navigation back to Sessions preserves the active query
 * filters (the FilterBar/AppShell contract already covered by
 * `steel-thread.cy.ts`; this spec drills specifically from Session Detail).
 *
 * Live-update evidence for the per-session WS invalidation path is already
 * covered by the T6 `client/src/ws.test.ts` unit test — this spec does not
 * duplicate that transport-level assertion.
 */
describe("session detail smoke", () => {
  it("renders every binding section with fixture-derived data", () => {
    cy.visit(`/sessions/${SESSION_ID}${FIXTURE_RANGE}`);

    // Header: identity + project + tier.
    cy.get('[data-testid="session-detail-header"]').within(() => {
      cy.contains(SESSION_ID.slice(0, 8)).should("be.visible");
      cy.contains("/Users/demo/projects/alpha").should("be.visible");
      cy.contains("main").should("be.visible");
      // Two logical turns: prompt-1 (main only) + prompt-2 (main + sidechain).
      cy.contains("dd", "2").should("exist");
    });

    // Cost timeline: bars + turn rules render for a non-empty session.
    cy.get('[data-testid="session-detail-timeline"]').within(() => {
      cy.get("svg").should("exist");
      cy.get("svg line").should("have.length.at.least", 1);
    });

    // Turns section: bars, table (with a turn-2 drill link), and history
    // distribution.
    cy.get('[data-testid="session-detail-turns"]').within(() => {
      cy.get('[data-testid="turn-drill-1"]').should("exist");
      cy.get('[data-testid="turn-drill-2"]').should("exist");
    });

    // Cache strip: at least one cause badge rendered (the fixture's first
    // call always classifies as "first call").
    cy.get('[data-testid="session-detail-cache"]').within(() => {
      cy.contains("first call").should("exist");
    });

    // Tool mix + timeline: Bash and Agent tool uses from the fixture.
    cy.get('[data-testid="session-detail-tool-mix"]').within(() => {
      cy.contains("Bash").should("exist");
      cy.contains("Agent").should("exist");
    });

    // Prompt list: both fixture prompts render with their typed text.
    cy.get('[data-testid="session-detail-prompts"]').within(() => {
      cy.contains("List the files in this repo").should("be.visible");
      cy.contains("Now summarize it using a sub-agent").should("be.visible");
    });

    // Workflow funnel: all 5 canonical stage labels present (counts may be
    // 0 for this fixture — it has no Edit/Write/git-commit calls).
    cy.get('[data-testid="session-detail-workflow"]').within(() => {
      cy.contains("Edit cohort").should("be.visible");
      cy.contains("Read-first").should("be.visible");
      cy.contains("Planned").should("be.visible");
      cy.contains("Verified").should("be.visible");
      cy.contains("Committed").should("be.visible");
    });

    // Token funnel: reconciled bars render.
    cy.get('[data-testid="session-detail-token-funnel"]').within(() => {
      cy.contains("Context offered").should("be.visible");
      cy.contains("Cache served").should("be.visible");
      cy.contains("Fresh billed").should("be.visible");
      cy.contains("Output").should("be.visible");
    });

    // Context composition: at least one tool-result byte bucket (the
    // fixture's Bash tool result).
    cy.get('[data-testid="session-detail-context-composition"]').within(() => {
      cy.contains("Bash").should("exist");
    });

    // No Report Card section or claim anywhere on the page (#P4-5 scope:
    // Report Card lands in #P4-12).
    cy.get('[data-testid="session-detail-view"]')
      .invoke("text")
      .should("not.match", /report card/i);
  });

  it("drills from a turn row to the canonical one-based Turn Inspector address", () => {
    cy.visit(`/sessions/${SESSION_ID}${FIXTURE_RANGE}`);

    cy.get('[data-testid="turn-drill-2"]').click();

    cy.location("pathname").should("eq", `/session/${SESSION_ID}/turn/2`);
    cy.contains(`session ${SESSION_ID}`).should("be.visible");
    cy.contains("turn #2").should("be.visible");
  });

  it("preserves active query filters when navigating back to Sessions", () => {
    cy.visit(`/sessions/${SESSION_ID}${FIXTURE_RANGE}`);

    cy.contains("nav a", "Sessions").click();

    cy.location("pathname").should("eq", "/sessions");
    cy.location("search").should((search) => {
      expect(search).to.include("from=");
      expect(search).to.include("to=");
    });
  });
});
