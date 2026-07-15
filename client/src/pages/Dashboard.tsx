import { ChartCard } from "../charts/ChartCard.js";
import { PageStub } from "./PageStub.js";

export function Dashboard() {
  return (
    <PageStub title="Dashboard">
      <ChartCard title="Cost over time" defaultUnit="$" />
    </PageStub>
  );
}
