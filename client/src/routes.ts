import type { ComponentType } from "react";
import { CacheLab } from "./pages/CacheLab.js";
import { Dashboard } from "./pages/Dashboard.js";
import { DataHealth } from "./pages/DataHealth.js";
import { Explore } from "./pages/Explore.js";
import { Models } from "./pages/Models.js";
import { Projects } from "./pages/Projects.js";
import { SessionDetail } from "./pages/SessionDetail.js";
import { Sessions } from "./pages/Sessions.js";
import { Settings } from "./pages/Settings.js";
import { Trends } from "./pages/Trends.js";
import { TurnInspector } from "./pages/TurnInspector.js";

export interface AppRoute {
  path: string;
  label: string;
  component: ComponentType;
}

// Single source of truth for both the wouter <Switch> (App.tsx) and the nav
// (layout/AppShell.tsx) so they can't drift apart. Order = the page map in
// specs/claude-lens-pages.md. Session Detail's param shape is settled
// (#P4-5); Turn Inspector's route is the canonical one-based evidence-link
// shape from `specs/gates.md` (A11) — the page body itself remains a stub
// until #P4-6.
export const routes: AppRoute[] = [
  { path: "/", label: "Dashboard", component: Dashboard },
  { path: "/sessions", label: "Sessions", component: Sessions },
  { path: "/sessions/:id", label: "Session Detail", component: SessionDetail },
  {
    path: "/session/:sessionId/turn/:turnNumber",
    label: "Turn Inspector",
    component: TurnInspector,
  },
  { path: "/projects", label: "Projects", component: Projects },
  { path: "/models", label: "Models", component: Models },
  { path: "/cache", label: "Cache Lab", component: CacheLab },
  { path: "/trends", label: "Trends, Calendar & Budget", component: Trends },
  { path: "/health", label: "Data Health", component: DataHealth },
  { path: "/settings", label: "Settings", component: Settings },
  { path: "/explore", label: "Explore", component: Explore },
];

// Routes shown in the primary nav — the two param routes are reached by
// drilling in from Sessions/Turn results, not linked directly from chrome.
export const navRoutes = routes.filter((route) => !route.path.includes(":"));
