import { useEffect, useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "ce_theme";

const read = (): ThemeChoice => {
  try { return (localStorage.getItem(KEY) as ThemeChoice) || "system"; } catch { return "system"; }
};

export function applyTheme(t: ThemeChoice) {
  const el = document.documentElement;
  if (t === "system") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", t);
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeChoice>(read);
  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(KEY, theme); } catch { /* sin almacenamiento */ }
  }, [theme]);
  return [theme, setTheme] as const;
}

applyTheme(read());
