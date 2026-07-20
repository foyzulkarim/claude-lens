const RANGE = "?from=2026-07-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z";
// Session 1111… carries the C+B overlay in the premium pass (see
// test/fixtures/README.md → premium overlay). In the transcript-only pass the
// overlay is absent, so the same assertions verify the 🟡 estimated tier.
const PREMIUM_SESSION = "11111111-1111-4111-8111-111111111111";

// Cypress.env("premium") is set to "true" by scripts/e2e.ts on the premium
// (T+C/B/L) pass only; unset on the transcript-only (T) pass.
const isPremium = Cypress.env("premium") === true || Cypress.env("premium") === "true";

Cypress.on("uncaught:exception", (err) => {
  if (err.message.includes("ResizeObserver loop completed")) return false;
});

/**
 * Premium-tier upgrade spec (#P4-13). Run twice by scripts/e2e.ts: once with
 * transcript-only fixtures (asserts the 🟡 estimated tier), once with the
 * C/B/L overlay (asserts the 🟢 observed tier). Every assertion below branches
 * on `isPremium`, so the two passes prove each listed upgrade flips — and that
 * a transcript-only session is never wrongly upgraded.
 *
 * Scope: the per-session upgrades that a mixed fixture fleet can flip
 * deterministically (Session Detail tier/drift/context/turn columns, Turn
 * Inspector waterfall, Sessions-table observed columns). The fleet-aggregate
 * panels (Models latency/throughput, Cache Lab context-growth basis) only flip
 * when every shown session is premium, so their observed states are covered by
 * Storybook stories instead (acceptance criteria: "hard to reproduce on demand
 * with real data").
 */
describe(`premium tier (${isPremium ? "T+C/B/L observed" : "T-only estimated"})`, () => {
  it("Session Detail header reflects the cost tier and context source", () => {
    cy.visit(`/sessions/${PREMIUM_SESSION}${RANGE}`);
    cy.get('[data-testid="session-detail-header"]').within(() => {
      if (isPremium) {
        cy.contains("$ observed").should("be.visible");
        cy.contains("Context (observed)").should("exist");
      } else {
        cy.contains("$ computed").should("be.visible");
        cy.contains("Context (est.)").should("exist");
      }
    });
    // The "premium capture missing" banner is present only in the T tier.
    cy.get('[data-testid="premium-unavailable"]').should(isPremium ? "not.exist" : "exist");
  });

  it("Session Detail turn table shows observed Δlines only in the premium tier", () => {
    cy.visit(`/sessions/${PREMIUM_SESSION}${RANGE}`);
    cy.get('[data-testid="session-detail-turns"]').within(() => {
      // Turn 1 reconciles to +5/−1 lines (3+2 added, 0+1 removed).
      if (isPremium) {
        cy.contains("+5/").should("exist");
      } else {
        cy.contains("+5/").should("not.exist");
      }
    });
  });

  it("Turn Inspector waterfall sizes by observed api_duration in the premium tier", () => {
    cy.visit(`/session/${PREMIUM_SESSION}/turn/1${RANGE}`);
    cy.get('[data-testid="turn-inspector-waterfall"]').within(() => {
      cy.contains(isPremium ? "observed api_duration" : "timestamp fallback").should("exist");
    });
  });

  it("Sessions table lights up the observed line-delta column for a premium session", () => {
    cy.visit(`/sessions${RANGE}`);
    cy.get('[data-testid="session-browser"]').within(() => {
      // The Obs $ / Δlines / Ctx % columns always render; the values flip.
      cy.contains("Obs $").should("exist");
      // Session 1111… rolls up to +11/−3 observed lines under premium.
      if (isPremium) {
        cy.contains("+11/").should("exist");
      } else {
        cy.contains("+11/").should("not.exist");
      }
    });
  });
});
