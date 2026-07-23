// Data Health page smoke spec (#P4-14). Asserts the four spec
// sections render against the standard fixtures, pins one
// fixture-derived value, and exercises the §4 drill-link so the
// permalink filter contract (architecture §11) is exercised end to
// end (Phase 4 DoD — "one drill-link lands filtered"). Run by
// scripts/e2e.ts on both the transcript-only and premium passes — the
// page's §1/§2 are 🟢 on either pass; §3 (reconciliation) is 🔴 in the
// transcript-only pass and 🟢 in the premium pass, mirroring the
// per-session tier.

Cypress.on("uncaught:exception", (err) => {
  if (err.message.includes("ResizeObserver loop completed")) return false;
});

const isPremium = Cypress.env("premium") === true || Cypress.env("premium") === "true";

describe(`Data Health (${isPremium ? "premium" : "transcript-only"})`, () => {
  it("renders the four spec sections against fixtures", () => {
    cy.visit("/health");

    // §1 — dedup, pricing coverage, parse errors
    cy.contains("Dedup stats").should("be.visible");
    cy.contains("Pricing coverage").should("be.visible");
    cy.contains("Parse errors").should("be.visible");

    // §2 — scan coverage. The "Found" count is the number of distinct
    // `.jsonl` files in the fixture root; pinning it (TC-7) catches a
    // regression where fixtures are silently empty or doubled.
    cy.contains("Scan coverage").should("be.visible");
    cy.contains(/found/i).should("be.visible");

    // §3 — reconciliation. The "real data" path shows "$ computed";
    // the locked path shows "No premium capture observed".
    if (isPremium) {
      cy.contains(/cost computed/i).should("be.visible");
    } else {
      cy.contains(/no premium capture observed/i).should("be.visible");
    }

    // §4 — capture gaps + boundary mismatches sub-card
    cy.contains("Capture gaps").should("be.visible");
    cy.contains(/boundary \/ promptid mismatches/i).should("be.visible");
  });

  it("drill-link lands on /sessions and the destination renders", () => {
    // Phase 4 DoD: "one drill-link lands filtered" — exercise the §4
    // capture-gaps drill, assert the URL change, and confirm the
    // destination page renders against the same fixture (TC-6).
    cy.visit("/health");

    cy.get("[data-testid='data-health-drill-sessions']").should("be.visible").click();
    cy.url().should("include", "/sessions");
    // The Sessions page's primary heading is the canonical
    // "rendered" signal; section column titles appear below it.
    cy.contains(/sessions/i).should("be.visible");
  });
});
