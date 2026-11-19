import { createRootRoute, createRoute, createRouter, createMemoryHistory, type RouterHistory } from "@tanstack/react-router";
import { AppShell } from "./components/AppShell.tsx";
import { Overview } from "./pages/Overview.tsx";
import { Placeholder } from "./pages/Placeholder.tsx";
import { useTheme } from "./theme.ts";

function Root() {
  const { theme, toggle } = useTheme();
  return <AppShell theme={theme} onToggleTheme={toggle} />;
}

const rootRoute = createRootRoute({ component: Root });
const page = <const P extends string>(path: P, component: () => React.JSX.Element) =>
  createRoute({ getParentRoute: () => rootRoute, path, component });

const routeTree = rootRoute.addChildren([
  page("/", Overview),
  page("/inbox", () => <Placeholder title="Inbox" milestone="M2" description="Issues from Slack, email and chat in one queue, with SLA timers and AI drafts." />),
  page("/mine", () => <Placeholder title="My issues" milestone="M2" description="Everything assigned to you, sorted by SLA due time." />),
  page("/accounts", () => <Placeholder title="Accounts" milestone="M2" description="Customer accounts with their issues, contacts, channels and signals." />),
  page("/ai", () => <Placeholder title="AI agent" milestone="M5" description="Copilot drafts, shadow mode, backtests and spend limits." />),
  page("/knowledge", () => <Placeholder title="Knowledge" milestone="M5" description="Docs and resolved issues the AI answers from." />),
  page("/analytics", () => <Placeholder title="Analytics" milestone="M4" description="Volume, response times, SLA compliance and AI outcomes." />),
  page("/settings", () => <Placeholder title="Settings" milestone="M1" description="Members, roles, channels, business hours and integrations." />),
  page("/more", () => <Placeholder title="More" milestone="M2" description="AI agent, knowledge, analytics and settings on phones." />),
]);

export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, ...(history ? { history } : {}) });
}

export const testHistory = (path = "/") => createMemoryHistory({ initialEntries: [path] });

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
