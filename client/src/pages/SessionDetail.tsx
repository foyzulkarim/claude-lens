import { useParams } from "wouter";
import { PageStub } from "./PageStub.js";

export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  return <PageStub title={`Session Detail — ${id}`} />;
}
