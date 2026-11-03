// The plugin's own version, for the "newer release available" notice. Plugin modules may only import from
// client/, server/ and shared/ (Paseo's build rejects package.json), so the number lives here; test/update.test.ts
// fails when it differs from package.json, which keeps `npm version` honest.
export const PLUGIN_VERSION = "1.0.2";
