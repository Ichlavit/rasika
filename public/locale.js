(() => {
  const root = document.documentElement;
  const locale = root.dataset.locale === "en" ? "en" : "es";
  const alternateUrl = root.dataset.alternateUrl || (locale === "en" ? "/" : "/en/");
  const preferenceKey = "rasika_locale";
  const promptSeenKey = "rasika_locale_prompt_seen";
  const getStored = (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const setStored = (key, value) => {
    try { localStorage.setItem(key, value); } catch { /* Storage may be unavailable. */ }
  };

  if (locale === "en") {
    setStored(preferenceKey, "en");
  }

  document.addEventListener(
    "click",
    (event) => {
      const link = event.target?.closest?.("[data-locale-switch]");
      if (!link) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const nextLocale = link.dataset.localeSwitch === "en" ? "en" : "es";
      setStored(preferenceKey, nextLocale);
      window.location.assign(link.href);
    },
    true,
  );

  if (locale !== "es" || getStored(preferenceKey) || getStored(promptSeenKey)) return;
  try {
    if (document.referrer && new URL(document.referrer).origin === location.origin) return;
  } catch {
    // Treat an invalid referrer as an external first visit.
  }
  const browserPrefersEnglish = (navigator.languages || [navigator.language || ""])
    .some((language) => String(language).toLowerCase().startsWith("en"));
  if (!browserPrefersEnglish) return;
  setStored(promptSeenKey, "1");

  const prompt = document.createElement("aside");
  prompt.className = "rasika-language-prompt";
  prompt.setAttribute("aria-label", "Language preference");
  prompt.innerHTML = `
    <p>View this site in English?</p>
    <div>
      <a href="${alternateUrl}" data-locale-switch="en">View in English</a>
      <button type="button">Stay in Spanish</button>
    </div>
  `;
  prompt.querySelector("button")?.addEventListener("click", () => {
    setStored(preferenceKey, "es");
    prompt.remove();
  });
  document.body.append(prompt);
})();
