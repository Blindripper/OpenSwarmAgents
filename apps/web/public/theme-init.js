(() => {
  const stored = localStorage.getItem("osaTheme");
  const prefersDark = globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  const theme = stored === "light" || stored === "dark" ? stored : prefersDark ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
