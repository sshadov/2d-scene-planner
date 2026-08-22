const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const offlinePath = path.join(root, "plugin", "offline.html");

assert.equal(fs.existsSync(offlinePath), true, "The offline distribution needs an explicit HTML entry point");

const offline = fs.readFileSync(offlinePath, "utf8");
const plugin = fs.readFileSync(path.join(root, "plugin", "index.html"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

const modeBootstrap = offline.indexOf('window.SCENE_PLANNER_MODE = "offline"');
const sharedApp = offline.indexOf('src="./app.js?v=0.24.0"');

assert.ok(modeBootstrap >= 0, "Offline entry must explicitly select offline mode");
assert.ok(sharedApp > modeBootstrap, "Offline mode must be selected before the shared app runtime loads");
assert.doesNotMatch(offline, /designer-adapter\.js/i, "Offline entry must not load the Designer adapter");
assert.doesNotMatch(offline, /app-offline\.js/i, "Offline entry must use the shared app runtime");
assert.match(offline, /<body class="offline-mode">/);
assert.match(offline, /<title>2D Scene Planner v0\.24\.0 Offline<\/title>/);
assert.match(offline, /id="adapter-status">Offline</);
assert.doesNotMatch(offline, /LIVE:|Delete from Device list|Transport safety check/);

assert.match(plugin, /designer-adapter\.js\?v=0\.24\.0/);
assert.match(plugin, /app\.js\?v=0\.24\.0/);
assert.match(plugin, /<title>2D Scene Planner v0\.24\.0 for Disguise Designer<\/title>/);
assert.equal(packageJson.version, "0.24.0");

console.log("offline entry contract test: ok");
