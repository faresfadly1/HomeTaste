window.HOMETASTE_API_BASE = window.location.hostname.endsWith("github.io")
  ? "https://hometaste-api-production.up.railway.app"
  : "";

// TEMP DEV ONLY — disable before production.
// Set to "true" to skip the login page and auto-enter as the seeded owner.
// The backend must also run with HOMETASTE_BYPASS_LOGIN=1. Set back to "false"
// (or remove this line) to restore the normal login page.
window.HOMETASTE_BYPASS_LOGIN = "false";
