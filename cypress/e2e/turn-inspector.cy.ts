const SESSION_ID = "11111111-1111-4111-8111-111111111111";

// See steel-thread.cy.ts for why this is here: a benign ECharts/
// ResizeObserver browser warning, not a real error.
Cypress.on("uncaught:exception", (err) => {
  if (err.message.includes("ResizeObserver loop completed")) return false;
});

/**
 * Turn Inspector smoke spec (#P4-6). Reuses the same fixture session
 * Session Detail's smoke spec drills from (never edited here — silent-
 * regression hotspot per ARCH-turn-inspector-page.md). Turn 2 of that
 * fixture has a main+sidechain split (prompt-2: msg_3 main, msg_4
 * sidechain agent-abc123, msg_5 main), so it exercises every binding
 * section including the sidechain breakdown.
 */
describe("turn inspector smoke", () => {
  it("renders every binding section from fixture data", () => {
    cy.visit(`/session/${SESSION_ID}/turn/2`);

    cy.get('[data-testid="turn-inspector-summary"]').within(() => {
      cy.contains("Turn 2 of 2").should("be.visible");
      cy.contains(SESSION_ID.slice(0, 8)).should("be.visible");
      cy.contains("Now summarize it using a sub-agent").should("be.visible");
    });

    cy.get('[data-testid="turn-inspector-waterfall"]').within(() => {
      // At least 3, not exactly 3: `steel-thread.cy.ts` (which runs earlier
      // in the suite) appends a synthetic call to this same fixture file to
      // exercise live tailing, and it lands in this turn (the latest
      // preceding prompt at append time) — an intentional, expected
      // cross-spec mutation of the shared fixture, not a regression here.
      cy.get("li").should("have.length.at.least", 3);
      cy.contains("Agent").should("exist");
    });

    cy.get('[data-testid="turn-inspector-cache-narrative"]').should("be.visible");

    cy.get('[data-testid="turn-inspector-sidechains"]').within(() => {
      cy.contains("sidechain").should("be.visible");
      cy.contains("claude-fable-5").should("be.visible");
    });

    // Transcript peek stays collapsed (no fetch) until expanded.
    cy.get('[data-testid="turn-inspector-transcript-peek"]').within(() => {
      cy.contains("Collapsed.").should("be.visible");
      cy.contains("button", "expand").click();
      cy.contains("The README describes a demo project.").should("be.visible");
    });
  });

  it("drills prev/next nav to an adjacent turn with the URL filters preserved", () => {
    cy.visit(`/session/${SESSION_ID}/turn/2?from=2026-07-01T00%3A00%3A00.000Z`);

    cy.contains("a", "← turn 1").click();

    cy.location("pathname").should("eq", `/session/${SESSION_ID}/turn/1`);
    cy.location("search").should("include", "from=");
    cy.get('[data-testid="turn-inspector-summary"]').within(() => {
      cy.contains("Turn 1 of 2").should("be.visible");
    });
  });
});
