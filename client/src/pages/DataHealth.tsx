// Shim — the real Data Health page lives at `./data-health/DataHealth.tsx`.
// Kept here so `client/src/routes.ts` and any other importer keeps the
// same import path as when #46 was a PageStub. The page directory is
// the owning location so all the Data Health-specific helper / panel /
// stories / test files live together (#P4-14).
export { DataHealth } from "./data-health/DataHealth.js";
