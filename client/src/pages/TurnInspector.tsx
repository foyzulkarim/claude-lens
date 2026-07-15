import { useParams } from "wouter";
import { PageStub } from "./PageStub.js";

export function TurnInspector() {
  const { id } = useParams<{ id: string }>();
  return <PageStub title={`Turn Inspector — ${id}`} />;
}
