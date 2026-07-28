const FIXTURE_RANGE = "?from=2026-07-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
// ARCH-124-cache-scorecard.md: the K2-classifier fixture session (also used
// by cache-lab.cy.ts) has 11 main-thread calls with a real, hand-traceable
// mix of prefix-bust/idle-expiry/duplicated-warmup waste — everything the
// Cache Scorecard section needs that the "clean" 1111… fixture above does
// not exercise.
const SCORECARD_SESSION_ID = "55555555-5555-4555-8555-555555555555";
const SCORECARD_FIXTURE_RANGE =
  "?from=2026-06-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z";
const SCORECARD_TRANSCRIPT_PATH =
  "projects/-Users-demo-project-alpha/55555555-5555-4555-8555-555555555555.jsonl";

// See steel-thread.cy.ts for why this is here: a benign ECharts/
// ResizeObserver browser warning, not a real error.
Cypress.on("uncaught:exception", (err) => {
  if (err.message.includes("ResizeObserver loop completed")) return false;
});

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

    // #P4-12: the Report Card section now lands on Session Detail
    // (lazy-mounted, so the placeholder renders until the section
    // scrolls into view; either the placeholder or the rendered card
    // proves the wiring is present). Pre-#P4-12 this assertion was
    // a "no report card" check that was correct at the time.
    cy.get('[data-testid="session-detail-view"]').within(() => {
      cy.get('[data-testid="report-card-placeholder"], [data-testid="report-card"]').should(
        "exist",
      );
    });

    // ARCH-124-cache-scorecard.md T8: the Cache Scorecard section is
    // mounted alongside Report Card, same lazy-mount contract (placeholder
    // or rendered card both prove the wiring is present).
    cy.get('[data-testid="session-detail-view"]').within(() => {
      cy.get('[data-testid="scorecard-placeholder"], [data-testid="cache-scorecard"]').should(
        "exist",
      );
    });
  });

  it("deep-links straight to the Cache Scorecard section and renders its content (R6, #124 review finding #19)", () => {
    cy.viewport(1280, 900);
    cy.visit(`/sessions/${SCORECARD_SESSION_ID}${SCORECARD_FIXTURE_RANGE}#cache-scorecard`);

    // The section must actually mount and render real fixture-derived
    // content from a fresh page load, not just leave the lazy-mount
    // placeholder behind because nothing ever scrolled it into view.
    cy.get('[data-testid="cache-scorecard"]', { timeout: 10000 }).should("be.visible");
    cy.get('[data-testid="cache-scorecard"]').within(() => {
      cy.contains("h2", "Cache Hygiene").should("be.visible");
      cy.contains("dt", "rewritten").should("be.visible");
      cy.get('[data-testid^="waste-event-"]').should("have.length.at.least", 1);
    });
  });

  it("updates the Cache Scorecard section live when a new waste event is appended (R9)", () => {
    cy.visit(`/sessions/${SCORECARD_SESSION_ID}${SCORECARD_FIXTURE_RANGE}#cache-scorecard`);
    cy.get('[data-testid="cache-scorecard"]', { timeout: 10000 }).should("be.visible");
    cy.get('[data-testid="cache-scorecard"]').within(() => {
      cy.contains("dd", "58.2k").should("be.visible");
    });

    // Appends one call whose cache-creation is fully "rewritten" against the
    // fixture's already-established high-water mark, classified as a
    // prefix-bust waste event (verified against the real `computeScorecard`
    // engine, not guessed): 58,200 -> 58,700 rewritten tokens.
    cy.task("appendJsonl", {
      relativePath: SCORECARD_TRANSCRIPT_PATH,
      line: JSON.stringify({
        type: "assistant",
        uuid: "e2e-scorecard-live-append",
        sessionId: SCORECARD_SESSION_ID,
        timestamp: "2026-06-15T12:05:00.000Z",
        cwd: "/Users/demo/projects/alpha",
        gitBranch: "main",
        version: "2.1.199",
        entrypoint: "cli",
        isSidechain: false,
        message: {
          id: "e2e-scorecard-live-append-msg",
          model: "claude-fable-5",
          role: "assistant",
          type: "message",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Synthetic E2E scorecard append." }],
          usage: {
            input_tokens: 1000,
            output_tokens: 0,
            cache_read_input_tokens: 5000,
            cache_creation_input_tokens: 500,
            cache_creation: { ephemeral_5m_input_tokens: 500, ephemeral_1h_input_tokens: 0 },
          },
        },
      }),
    });

    // 15s headroom over the production 3s file poll + 300ms invalidation
    // debounce (matches steel-thread.cy.ts's live-append tolerance).
    cy.get('[data-testid="cache-scorecard"]', { timeout: 15000 }).within(() => {
      cy.contains("dd", "58.7k").should("be.visible");
    });
  });

  it("drills from a turn row to the canonical one-based Turn Inspector address", () => {
    cy.visit(`/sessions/${SESSION_ID}${FIXTURE_RANGE}`);

    cy.get('[data-testid="turn-drill-2"]').click();

    cy.location("pathname").should("eq", `/session/${SESSION_ID}/turn/2`);
    cy.get('[data-testid="turn-inspector-summary"]').within(() => {
      cy.contains("Turn 2 of 2").should("be.visible");
      cy.contains(SESSION_ID.slice(0, 8)).should("be.visible");
    });
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
