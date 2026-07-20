// Shim — the real Explore page lives at `./explore/Explore.tsx`. Kept here
// so `client/src/routes.ts` and any other importer keeps the same import
// path as when #48 was a PageStub. The page directory is the owning
// location so all the Explore-specific helper / panel / stories files
// live together (Models / Trends / CacheLab pattern).
export { Explore } from "./explore/Explore.js";
