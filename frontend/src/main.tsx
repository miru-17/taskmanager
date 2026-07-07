import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "react-hot-toast";

import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>

    <Toaster
      position="top-right"
      reverseOrder={false}
      toastOptions={{
        duration: 3000,
        style: {
          background: "#0F172A",
          color: "#ffffff",
          border: "1px solid #06B6D4",
          borderRadius: "14px",
          padding: "14px",
        },
        success: {
          iconTheme: {
            primary: "#22C55E",
            secondary: "#ffffff",
          },
        },
        error: {
          iconTheme: {
            primary: "#EF4444",
            secondary: "#ffffff",
          },
        },
      }}
    />

    <App />

  </StrictMode>
);