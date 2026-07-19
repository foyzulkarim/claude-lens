import type { Meta, StoryObj } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ReactElement } from "react";
import type {
  TurnTranscriptPeekError,
  TurnTranscriptPeekResponse,
} from "../../../../shared/turn-inspector-contract.js";
import { TranscriptPeek } from "./TranscriptPeek.js";

// TranscriptPeek starts collapsed and only mounts the underlying useQuery
// when expanded. For Storybook we want to render the post-expand states
// without simulating the click — `ForceExpanded` mounts a hidden expand
// button and clicks it once the tree is alive, so the real component's own
// `expanded` state takes over and we see the genuine conditional branches.
function ForceExpanded({ children }: { children: ReactElement }) {
  useEffect(() => {
    const button = document.querySelector<HTMLButtonElement>(
      '[data-testid="turn-inspector-transcript-peek"] button',
    );
    button?.click();
  }, []);
  return children;
}

function withQueryClient(Story: () => ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <Story />
    </QueryClientProvider>
  );
}

const meta: Meta<typeof TranscriptPeek> = {
  title: "TurnInspector/TranscriptPeek",
  component: TranscriptPeek,
};

export default meta;
type Story = StoryObj<typeof TranscriptPeek>;

/** Collapsed default — the lazy-fetch guarantee the inspector page relies
 * on; expanding is the only thing that ever mounts the network call. */
export const Collapsed: Story = {
  args: { sessionId: "s1", turnNumber: 2 },
};

/** Expanded with a normal response: two text lines, one tool_use, one
 * tool_result. Previews stay below the cap so `truncated` is false. */
export const ExpandedSuccess: Story = {
  decorators: [
    withQueryClient,
    (Story) => {
      window.fetch = (async () =>
        new Response(
          JSON.stringify({
            lines: [
              { role: "assistant-text", preview: "Reading the file…" },
              {
                role: "tool-use",
                toolName: "Read",
                preview: JSON.stringify({ file_path: "/repo/x.ts" }),
              },
              {
                role: "tool-result",
                toolName: "Read",
                preview: "export const x = 1;",
                bytes: 21,
              },
            ],
            truncated: false,
          } satisfies TurnTranscriptPeekResponse),
          { status: 200 },
        )) as typeof window.fetch;
      return (
        <ForceExpanded>
          <Story />
        </ForceExpanded>
      );
    },
  ],
  args: { sessionId: "s1", turnNumber: 2 },
};

/** Expanded with a long assistant-text line — exercises the 200-char
 * preview cap and the `truncated` flag the page renders beneath the lines. */
export const ExpandedTruncated: Story = {
  decorators: [
    withQueryClient,
    (Story) => {
      const longText = "x".repeat(420);
      window.fetch = (async () =>
        new Response(
          JSON.stringify({
            lines: [{ role: "assistant-text", preview: longText }],
            truncated: true,
          } satisfies TurnTranscriptPeekResponse),
          { status: 200 },
        )) as typeof window.fetch;
      return (
        <ForceExpanded>
          <Story />
        </ForceExpanded>
      );
    },
  ],
  args: { sessionId: "s1", turnNumber: 2 },
};

/** Loading state — fetch never resolves within the story frame, so the
 * "Loading transcript…" line is what the user sees during the round-trip. */
export const ExpandedLoading: Story = {
  decorators: [
    withQueryClient,
    (Story) => {
      window.fetch = (async () => new Promise<Response>(() => {})) as typeof window.fetch;
      return (
        <ForceExpanded>
          <Story />
        </ForceExpanded>
      );
    },
  ],
  args: { sessionId: "s1", turnNumber: 2 },
};

/** 404 — transcript moved/deleted. The component shows the specific
 * "Transcript unavailable" message instead of the generic failure line. */
export const ExpandedUnavailable: Story = {
  decorators: [
    withQueryClient,
    (Story) => {
      window.fetch = (async () =>
        new Response(
          JSON.stringify({
            error: "transcript unavailable",
            sessionId: "s1",
            turnNumber: 2,
          } satisfies TurnTranscriptPeekError),
          { status: 404 },
        )) as typeof window.fetch;
      return (
        <ForceExpanded>
          <Story />
        </ForceExpanded>
      );
    },
  ],
  args: { sessionId: "s1", turnNumber: 2 },
};

/** Generic 500 — the fallback "Failed to load transcript." branch. */
export const ExpandedError: Story = {
  decorators: [
    withQueryClient,
    (Story) => {
      window.fetch = (async () =>
        new Response(JSON.stringify({ error: "boom" }), { status: 500 })) as typeof window.fetch;
      return (
        <ForceExpanded>
          <Story />
        </ForceExpanded>
      );
    },
  ],
  args: { sessionId: "s1", turnNumber: 2 },
};
