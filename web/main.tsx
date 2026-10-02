import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initialTheme } from "./theme";

// Set the theme before anything is drawn, so there is no flash of the wrong colours.
document.documentElement.dataset.theme = initialTheme();

createRoot(document.getElementById("root")!).render(<App />);
