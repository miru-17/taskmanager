export const THEME_KEY = "taskforge.theme";
export type Theme = "light" | "dark";

const readStored = (): Theme | null => {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
};

/** Stored choice, else the OS preference. Called before first render to avoid a flash. */
export const initialTheme = (): Theme =>
  readStored() ?? (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");

export const applyTheme = (t: Theme) => document.documentElement.setAttribute("data-theme", t);
