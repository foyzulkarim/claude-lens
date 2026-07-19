// Shim — the real Projects page lives at `./projects/Projects.tsx`. Kept here
// so `client/src/routes.ts` and any other importer (`client/src/App.tsx`,
// stories, tests) keeps the same import path as when #39 was a PageStub.
// The page directory is the owning location so all the Projects-specific
// helper / panel / stories files live together (#P4-7).
export { Projects } from "./projects/Projects.js";
