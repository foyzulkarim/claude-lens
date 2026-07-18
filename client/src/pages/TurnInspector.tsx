import { useParams } from "wouter";
import { PageStub } from "./PageStub.js";

/**
 * Turn Inspector route stub (#P4-6 builds the real page). Accepts the
 * canonical one-based evidence-link shape settled in `specs/gates.md` and
 * used by Session Detail's turn-table drill links (A11):
 * `/session/:sessionId/turn/:turnNumber`. This establishes the parameter
 * identity #P4-6 and future gate-evidence producers build on; only the
 * page body remains a stub.
 */
export function TurnInspector() {
  const { sessionId, turnNumber } = useParams<{ sessionId: string; turnNumber: string }>();
  return <PageStub title={`Turn Inspector — session ${sessionId}, turn #${turnNumber}`} />;
}
