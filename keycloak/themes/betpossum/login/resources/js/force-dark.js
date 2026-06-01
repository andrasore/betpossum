// The app (next-themes) forces dark mode regardless of OS preference. The
// keycloak.v2 base theme instead toggles `pf-v5-theme-dark` from
// `prefers-color-scheme`. Pin it on so the login pages always render dark, and
// re-assert it if the base theme's media listener tries to remove it.
const DARK_CLASS = "pf-v5-theme-dark";
const html = document.documentElement;

function pinDark() {
  if (!html.classList.contains(DARK_CLASS)) {
    html.classList.add(DARK_CLASS);
  }
}

pinDark();
new MutationObserver(pinDark).observe(html, {
  attributes: true,
  attributeFilter: ["class"],
});
