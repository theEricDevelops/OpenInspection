# OpenInspection – Local Development TODO

## High Priority (Setup / Onboarding UX)

- [ ] **Improve first-run setup error display**
  - The `/setup` form (`src/templates/pages/setup.tsx` + `public/js/setup.js`) currently shows `[object Object]` on Zod validation failures (password strength, verificationCode length, etc.).
  - Other auth forms use `extractErrorMessage()` from `public/js/auth.js` which correctly walks `error.issues[]`.
  - The setup page needs the same treatment (or a shared helper) so users see the real messages:
    - "Must contain at least one uppercase letter"
    - "Must contain at least one number"
    - "Must contain at least one special character"
    - etc.
  - Also consider showing the password rules inline in the form instead of only "Minimum 8 characters".

- [ ] **Make SETUP_CODE experience better for local dev**
  - When `SETUP_CODE` is set via `.env`, the generated code path is skipped, but the value is never shown in the UI or logs (only the generic "Using user-defined SETUP_CODE" message).
  - Consider logging the actual value at startup (safely) or pre-filling it in the setup form when running in `APP_MODE=standalone` with a local .env.

- [ ] Clean up duplicate `SETUP_CODE` handling / last-wins surprises in .env files (document or add a warning).

## Later / Nice to Have

- [ ] Consider making `verificationCode` required in `SetupSchema` when `SETUP_CODE` is present in the environment (currently it's `.optional()` in Zod even though the form marks the field required).