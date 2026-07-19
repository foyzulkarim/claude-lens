import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { createQueryClient } from "./api/queryClient.js";
import "./index.css";
import { connectWs } from "./ws.js";

const queryClient = createQueryClient();
connectWs(queryClient);

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element missing from client/index.html");
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
