import { useEffect, useState } from "react";

export type Theme = "light" | "dusk";

// Light peach by default. The choice is remembered, and ?theme=dusk forces it.
export function initialTheme(): Theme {
  const asked = new URLSearchParams(location.search).get("theme") ?? localStorage.getItem("theme");
  return asked === "dusk" ? "dusk" : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);
  return [theme, setTheme] as const;
}
