// Shim — the real Models page lives at `./models/Models.tsx`. Kept here
// so `client/src/routes.ts` and any other importer (`client/src/App.tsx`,
// stories, tests) keeps the same import path as when #40 was a
// PageStub. The page directory is the owning location so all the
// Models-specific helper / panel / stories files live together.
export { Models } from "./models/Models.js";
