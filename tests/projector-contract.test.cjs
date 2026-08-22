const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const adapterSource = fs.readFileSync(path.join(root, "plugin", "designer-adapter.js"), "utf8");

function startMockApi() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (request, response) => {
      if (request.method !== "POST" || request.url !== "/api/session/python/execute") {
        response.writeHead(404).end();
        return;
      }
      let body = "";
      for await (const chunk of request) body += chunk;
      const script = JSON.parse(body).script;
      if (!script.includes('Projector configuration readback')) {
        assert.match(script, /obj\.removeScreen\(screen\)/);
        assert.match(script, /obj\.addScreen\(target_screen\)/);
        assert.match(script, /Projector\.screens did not retain the bound Surface/);
        assert.match(script, /Surface\.projectors did not retain the bound Projector/);
        assert.match(script, /Surface\.projectors retained an unbound Projector/);
        assert.doesNotMatch(script, /obj\.screens\s*=/);
        assert.doesNotMatch(script, /target_screen\.projectors\s*=/);
        const payload = JSON.stringify({ status: { code: 0, message: "" }, returnValue: JSON.stringify(JSON.stringify({ readback: { transform: { position: { x: 0, y: 0, z: 0 } }, lookAt: { x: 0, y: 0, z: 1 } } })) });
        response.writeHead(200, { "Content-Type": "application/json" }).end(payload);
        return;
      }
      assert.match(script, /state\.stage\.projectors/);
      assert.match(script, /configPosition/);
      assert.match(script, /configLookAt/);
      assert.match(script, /configLookDistance/);
      assert.match(script, /configThrowRatio/);
      assert.match(script, /fieldOfView/);
      assert.match(script, /configRotation/);
      assert.match(script, /screens/);
      const probe = {
        contract: "Projector configuration readback",
        projectors: [{
          designerId: "6110464582749956973",
          path: "objects/projector/projector 1.apx",
          className: "Projector",
          configPosition: { x: -4.2, y: 2.4, z: -7.5 },
          configLookAt: { x: -0.6, y: 2.3, z: 2.7 },
          configLookDistance: 10.5,
          configThrowRatio: 1.8,
          fieldOfView: 31.2,
          projectorRoll: 90,
          screens: [{ designerId: "screen-uid", path: "objects/screen2/surface.apx" }]
        }]
      };
      const payload = JSON.stringify({ status: { code: 0, message: "" }, returnValue: JSON.stringify(JSON.stringify(probe)) });
      response.writeHead(200, { "Content-Type": "application/json" }).end(payload);
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

(async () => {
  const server = await startMockApi();
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const context = {
      console,
      fetch,
      AbortController,
      setTimeout,
      clearTimeout,
      location: { hostname: "127.0.0.1", port: String(server.address().port), origin },
      DISGUISE_API_ORIGIN: origin
    };
    context.window = context;
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(adapterSource, context, { filename: "designer-adapter.js" });
    const result = await context.disguiseSceneAdapter.projectorReadbackProbe("6110464582749956973");
    assert.deepEqual(JSON.parse(JSON.stringify(result)), {
      contract: "Projector configuration readback",
      projectors: [{
        designerId: "6110464582749956973",
        path: "objects/projector/projector 1.apx",
        className: "Projector",
        configPosition: { x: -4.2, y: 2.4, z: -7.5 },
        configLookAt: { x: -0.6, y: 2.3, z: 2.7 },
        configLookDistance: 10.5,
        configThrowRatio: 1.8,
        fieldOfView: 31.2,
        projectorRoll: 90,
        screens: [{ designerId: "screen-uid", path: "objects/screen2/surface.apx" }]
      }]
    });
    await context.disguiseSceneAdapter.updateObject("6110464582749956973", { targetSurface: { designerId: "screen-uid", path: "objects/screen2/surface.apx" } }, "objects/projector/projector 1.apx", "projector");
    await context.disguiseSceneAdapter.updateObject("6110464582749956973", { targetSurface: null }, "objects/projector/projector 1.apx", "projector");
    console.log("projector contract protocol test: ok");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
