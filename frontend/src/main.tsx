import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";
import { QueryClientProvider } from "@tanstack/react-query";

import "./index.css";
import App from "./App";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { applyTheme, initialTheme } from "./context/theme";
import { createQueryClient } from "./data/queries";

// Set the theme before React renders so there's no light/dark flash
applyTheme(initialTheme());
const queryClient = createQueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Toaster
            position="bottom-right"
            containerClassName="no-print"
            toastOptions={{
              duration: 3500,
              style: {
                background: "var(--surface)",
                color: "var(--fg)",
                border: "1px solid var(--line)",
                borderRadius: "10px",
                boxShadow: "var(--shadow-lg)",
                fontSize: "14px",
              },
            }}
          />
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
);
