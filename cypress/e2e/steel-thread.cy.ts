const FIXTURE_RANGE = "?from=2026-07-01T00%3A00%3A00.000Z&to=2026-08-01T00%3A00%3A00.000Z";
const RESTORED_FIXTURE_RANGE = "?from=2026-07-01&to=2026-08-01";
const TRANSCRIPT_PATH =
  "projects/-Users-demo-project-alpha/11111111-1111-4111-8111-111111111111.jsonl";

function totalFromLabel(label: string): number {
  const match = /total \$([\d,.]+)/.exec(label);
  if (!match) throw new Error(`Unable to read chart total from label: ${label}`);
  return Number(match[1].replaceAll(",", ""));
}

function setDateInput(index: number, value: string): void {
  cy.get('input[type="date"]')
    .eq(index)
    .then(($input) => {
      const input = $input[0] as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!setter) throw new Error("The browser does not expose a date-input value setter");
      // React tracks direct property writes on controlled inputs. Using the
      // native setter then a bubbling input event is equivalent to a user
      // editing the visible control while preserving a valid date throughout.
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

describe("steel-thread smoke", () => {
  it("renders fixture data, persists filters, and live-updates the chart", () => {
    let initialTotal = 0;

    cy.visit(`/${FIXTURE_RANGE}`);
    cy.contains("h1", "Dashboard").should("be.visible");
    cy.contains("h2", "Cost over time").should("be.visible");
    cy.get('[role="img"][aria-label^="Cost over time chart;"]')
      .should("be.visible")
      .invoke("attr", "aria-label")
      .then((label) => {
        expect(label, "chart label").to.be.a("string");
        initialTotal = totalFromLabel(label as string);
      });

    cy.contains("button", "30D").click();
    cy.location("search").should((search) => {
      expect(search).to.include("range=30d");
      expect(search).not.to.include("from=");
      expect(search).not.to.include("to=");
    });
    cy.contains("nav a", "Sessions").click();
    cy.location("pathname").should("eq", "/sessions");
    cy.location("search").should("include", "range=30d");

    cy.contains("nav a", "Dashboard").click();
    cy.contains("button", "Custom").click();
    setDateInput(0, "2026-07-01");
    setDateInput(1, "2026-08-01");
    cy.location("search").should("eq", RESTORED_FIXTURE_RANGE);
    cy.get('[role="img"][aria-label^="Cost over time chart;"]')
      .invoke("attr", "aria-label")
      .then((label) => {
        expect(totalFromLabel(label as string)).to.equal(initialTotal);
      });

    cy.task("appendJsonl", {
      relativePath: TRANSCRIPT_PATH,
      line: JSON.stringify({
        type: "assistant",
        uuid: "e2e-live-update-record",
        sessionId: "11111111-1111-4111-8111-111111111111",
        timestamp: "2026-07-03T12:00:00.000Z",
        cwd: "/Users/demo/projects/alpha",
        gitBranch: "main",
        version: "2.1.199",
        entrypoint: "cli",
        isSidechain: false,
        message: {
          id: "e2e-live-update-message",
          model: "claude-sonnet-5",
          role: "assistant",
          type: "message",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "Synthetic E2E append." }],
          usage: {
            input_tokens: 1000000,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      }),
    });

    cy.get('[role="img"][aria-label^="Cost over time chart;"]', { timeout: 15000 })
      .invoke("attr", "aria-label")
      .should((label) => {
        if (!label) throw new Error("Cost chart lost its accessible label");
        expect(totalFromLabel(label)).to.be.greaterThan(initialTotal);
      });
  });
});
