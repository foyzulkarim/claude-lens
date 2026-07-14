import { Route, Switch } from "wouter";
import { AppShell } from "./layout/AppShell.js";
import { NotFound } from "./pages/NotFound.js";
import { routes } from "./routes.js";

export function App() {
  return (
    <AppShell>
      <Switch>
        {routes.map(({ path, component: Component }) => (
          <Route key={path} path={path} component={Component} />
        ))}
        <Route component={NotFound} />
      </Switch>
    </AppShell>
  );
}
