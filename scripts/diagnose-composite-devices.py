#!/usr/bin/env python3
"""Safely validate composite Designer devices in scenegen2.

The live mode is intentionally explicit: it uses the local Designer API,
creates only dsg-smoke-* resources, and always cleans them in a finally block.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request

SMOKE_PREFIX = "dsg-smoke-"
STABLE_CLEANUP_SECONDS = 1.5
API_ORIGIN = os.environ.get("DISGUISE_API_ORIGIN", "http://127.0.0.1").rstrip("/")
KINDS = ["dmxLight", "camera", "projector"]
NAMES = ["dsg-smoke-dmx-light", "dsg-smoke-camera", "dsg-smoke-projector"]
ROOT = Path(__file__).resolve().parents[1]
ADAPTER_PATH = ROOT / "scene-planner-prototype" / "designer-adapter.js"
PAYLOADS = {
    "dmxLight": {
        "type": "dmxLight",
        "name": "dsg-smoke-dmx-light",
        "pluginId": "dsg-smoke-dmx-light",
        "transform": {"position": {"x": 0, "y": 5, "z": 0}, "rotation": {"x": 0, "y": 0, "z": 0}},
    },
    "camera": {
        "type": "camera",
        "name": "dsg-smoke-camera",
        "pluginId": "dsg-smoke-camera",
        "transform": {"position": {"x": 1, "y": 1.5, "z": 2}, "rotation": {"x": 0, "y": 0, "z": 0}},
    },
    "projector": {
        "type": "projector",
        "name": "dsg-smoke-projector",
        "pluginId": "dsg-smoke-projector",
        "transform": {"position": {"x": 1, "y": 3, "z": 2}, "rotation": {"x": 0, "y": 0, "z": 0}},
        "lookAt": {"x": 0, "y": 1, "z": 0},
        "optics": {"throwRatio": 1.5},
    },
}
MANUAL_PATHS = [
    "objects/ledscreen/1.apx",
    "objects/dmxscreen/2.apx",
    "objects/fixturegroup/3.apx",
    "objects/camera/cam1.apx",
    "objects/camera/cam1 (perspective).apx",
    "objects/perspectiveprojectionobject/cam1 (perspective).apx",
    "objects/projector/projector 1.apx",
    "objects/projectorconfig/projector 1_config0.apx",
    "objects/screen2/surface 1.apx",
]
RESOURCE_PREFIXES = [
    "objects/ledscreen/",
    "objects/dmxscreen/",
    "objects/fixturegroup/",
    "objects/camera/",
    "objects/perspectiveprojectionobject/",
    "objects/projector/",
    "objects/projectorconfig/",
    "objects/screen2/",
    "objects/directprojection/",
]

NODE_GENERATOR = r"""
const fs = require("fs");
const vm = require("vm");
const source = fs.readFileSync(process.env.DSG_ADAPTER_PATH, "utf8");
const context = {
  console,
  location: { hostname: "127.0.0.1", port: "", search: "", origin: "http://127.0.0.1" },
  setTimeout,
  clearTimeout
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: "designer-adapter.js" });
const debug = context.disguiseSceneAdapter.debugScripts;
const input = JSON.parse(process.env.DSG_DIAGNOSTIC_INPUT);
const script = input.mode === "create"
  ? debug.createScript(input.payload)
  : debug.deleteManagedScript(input.records);
process.stdout.write(script);
"""


def dry_run():
    return {
        "prefix": SMOKE_PREFIX,
        "kinds": KINDS,
        "names": NAMES,
        "createSource": "debugScripts.createScript",
        "deleteSource": "debugScripts.deleteManagedScript",
        "cleanupInFinally": True,
        "verifyNoResidue": True,
        "verifyManualBaseline": True,
        "stableCleanupSeconds": STABLE_CLEANUP_SECONDS,
    }


def execute(script):
    body = json.dumps({"script": script}).encode("utf-8")
    request = urllib.request.Request(
        API_ORIGIN + "/api/session/python/execute",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Designer API HTTP {error.code}: {detail}") from error
    status = payload.get("status", {})
    if status.get("code", 0) != 0:
        raise RuntimeError(status.get("message") or "Designer rejected Python script")
    value = payload.get("returnValue")
    while isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            break
    return value


def generated_script(mode, payload=None, records=None):
    environment = os.environ.copy()
    environment["DSG_ADAPTER_PATH"] = str(ADAPTER_PATH)
    environment["DSG_DIAGNOSTIC_INPUT"] = json.dumps(
        {"mode": mode, "payload": payload, "records": records}
    )
    result = subprocess.run(
        ["node", "-e", NODE_GENERATOR],
        cwd=ROOT,
        env=environment,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("Adapter script generation failed: " + result.stderr.strip())
    return result.stdout


def probe_script():
    return f'''import json
from d3 import Path, Resource
prefix = {SMOKE_PREFIX!r}
def is_smoke_path(path):
    name = str(path).replace("\\\\", "/").rsplit("/", 1)[-1].lower()
    return name.startswith(prefix)
manual_paths = json.loads({json.dumps(MANUAL_PATHS)!r})
resource_prefixes = json.loads({json.dumps(RESOURCE_PREFIXES)!r})
stage = state.stage
manual = {{}}
for path in manual_paths:
    try:
        obj = resourceManager.load(Path(path), Resource)
        manual[path] = {{"uid": str(getattr(obj, "uid", "")), "class": type(obj).__name__}}
    except Exception as error:
        manual[path] = {{"missing": True, "error": str(error)}}
stage_smoke = []
for collection_name in ["ledScreens", "dmxScreens", "dmxLights", "surfaces", "cameras", "projectors"]:
    for obj in getattr(stage, collection_name, []):
        path = str(getattr(obj, "path", ""))
        if is_smoke_path(path):
            item = {{
                "collection": collection_name,
                "path": path,
                "uid": str(getattr(obj, "uid", "")),
                "class": type(obj).__name__,
                "bad": bool(obj.isBad),
                "incomplete": bool(obj.isIncomplete),
                "error": bool(obj.isInError),
            }}
            config = getattr(obj, "config", None)
            if config is not None:
                item["config"] = {{
                    "path": str(getattr(config, "path", "")),
                    "class": type(config).__name__,
                    "bad": bool(config.isBad),
                    "incomplete": bool(config.isIncomplete),
                    "error": bool(config.isInError),
                }}
            children = []
            for child in getattr(obj, "children", []):
                projection = getattr(child, "projection", None)
                children.append({{
                    "path": str(getattr(child, "path", "")),
                    "class": type(child).__name__,
                    "projectionPath": str(getattr(projection, "path", "")),
                    "projectionClass": type(projection).__name__ if projection is not None else None,
                    "projectionBad": bool(projection.isBad) if projection is not None else None,
                    "projectionIncomplete": bool(projection.isIncomplete) if projection is not None else None,
                    "projectionError": bool(projection.isInError) if projection is not None else None,
                    "bad": bool(child.isBad),
                    "incomplete": bool(child.isIncomplete),
                    "error": bool(child.isInError),
                }})
            item["children"] = children
            stage_smoke.append(item)
stage_children_smoke = []
for obj in getattr(stage, "children", []):
    path = str(getattr(obj, "path", ""))
    if is_smoke_path(path):
        stage_children_smoke.append({{"path": path, "uid": str(getattr(obj, "uid", "")), "class": type(obj).__name__}})
resource_paths = []
for resource_prefix in resource_prefixes:
    for candidate_path in resourceManager.package.findAllBeginsWith(resource_prefix):
        path = str(candidate_path)
        if is_smoke_path(path): resource_paths.append(path)
return json.dumps({{"manual": manual, "stageSmoke": stage_smoke, "stageChildrenSmoke": stage_children_smoke, "resourcePaths": sorted(set(resource_paths))}})'''


def probe():
    return execute(probe_script())


def manual_baseline():
    snapshot = probe()
    missing = [path for path, item in snapshot["manual"].items() if item.get("missing")]
    if missing:
        raise RuntimeError("Manual baseline is incomplete: " + ", ".join(missing))
    return snapshot["manual"]


def verify_manual_baseline(baseline, snapshot):
    if snapshot["manual"] != baseline:
        raise RuntimeError(
            "Manual Designer resources changed: "
            + json.dumps({"before": baseline, "after": snapshot["manual"]}, sort_keys=True)
        )


def verify_no_smoke_resources(snapshot):
    if snapshot["stageSmoke"] or snapshot["stageChildrenSmoke"] or snapshot["resourcePaths"]:
        raise RuntimeError("dsg-smoke residue found: " + json.dumps(snapshot, sort_keys=True))


def verify_created(kind, record, snapshot):
    matches = [item for item in snapshot["stageSmoke"] if item["path"] == record["path"]]
    if len(matches) != 1:
        raise RuntimeError(f"{kind}: expected one typed Stage object, found {len(matches)}")
    item = matches[0]
    if item["uid"] != str(record["designerId"]):
        raise RuntimeError(f"{kind}: Stage UID differs from create readback")
    if item["bad"] or item["incomplete"] or item["error"]:
        raise RuntimeError(f"{kind}: unhealthy main resource: {item}")
    if kind == "dmxLight" and (item["class"] != "FixtureGroup" or item["collection"] != "dmxLights"):
        raise RuntimeError(f"dmxLight: wrong class/collection: {item}")
    if kind == "camera":
        projection_children = [child for child in item["children"] if child["class"] == "PerspectiveProjectionObject"]
        if len(projection_children) != 1:
            raise RuntimeError(f"camera: expected one PerspectiveProjectionObject: {item}")
        child = projection_children[0]
        if child["projectionClass"] != "PerspectiveProjection" or not child["projectionPath"]:
            raise RuntimeError(f"camera: invalid projection reference: {child}")
        if child["bad"] or child["incomplete"] or child["error"]:
            raise RuntimeError(f"camera: unhealthy projection object: {child}")
        if child["projectionBad"] or child["projectionIncomplete"] or child["projectionError"]:
            raise RuntimeError(f"camera: unhealthy projection: {child}")
    if kind == "projector":
        config = item.get("config")
        if not config or config["class"] != "ProjectorConfig" or not config["path"]:
            raise RuntimeError(f"projector: missing ProjectorConfig: {item}")
        if config["bad"] or config["incomplete"] or config["error"]:
            raise RuntimeError(f"projector: unhealthy config: {config}")
    return item


def emergency_cleanup_script():
    return f'''import json
from d3 import Path, Resource
prefix = {SMOKE_PREFIX!r}
def is_smoke_path(path):
    name = str(path).replace("\\\\", "/").rsplit("/", 1)[-1].lower()
    return name.startswith(prefix)
resource_prefixes = json.loads({json.dumps(RESOURCE_PREFIXES)!r})
stage = state.stage
detached = []
for collection_name in ["ledScreens", "dmxScreens", "dmxLights", "surfaces", "cameras", "projectors"]:
    for candidate in getattr(stage, collection_name, []):
        path = str(getattr(candidate, "path", ""))
        if is_smoke_path(path):
            try: candidate.remove()
            except Exception: pass
            detached.append(candidate)
stage.save()
for candidate in detached:
    try: candidate.saveOnDelete()
    except Exception: pass
removed = []
for resource_prefix in resource_prefixes:
    for candidate_path in list(resourceManager.package.findAllBeginsWith(resource_prefix)):
        path = str(candidate_path)
        if is_smoke_path(path):
            resourceManager.remove(path)
            removed.append(path)
return json.dumps({{"removed": sorted(set(removed))}})'''


def cleanup(record):
    if record is not None:
        execute(generated_script("delete", records=[{"id": record["designerId"], "path": record["path"], "owned": True, "ownedPaths": record.get("ownedPaths", [record["path"]]), "removeResource": True}]))
    deadline = time.monotonic() + STABLE_CLEANUP_SECONDS
    while time.monotonic() < deadline:
        residue = probe()
        if residue["stageSmoke"] or residue["stageChildrenSmoke"] or residue["resourcePaths"]:
            execute(emergency_cleanup_script())
        time.sleep(0.25)
    verify_no_smoke_resources(probe())


def wait_for_stable_health(kind, record, timeout=3.0):
    deadline = time.monotonic() + timeout
    consecutive = 0
    last = None
    while time.monotonic() < deadline:
        last = probe()
        verify_created(kind, record, last)
        consecutive += 1
        if consecutive >= 3:
            return last
        time.sleep(0.2)
    raise RuntimeError(f"{kind}: did not remain healthy: {last}")


def run_kind(kind):
    baseline = manual_baseline()
    verify_no_smoke_resources(probe())
    record = None
    created = None
    try:
        record = execute(generated_script("create", payload=PAYLOADS[kind]))
        created = wait_for_stable_health(kind, record)
        return {"kind": kind, "created": created["stageSmoke"][0], "record": record}
    finally:
        cleanup(record)
        final = probe()
        verify_no_smoke_resources(final)
        verify_manual_baseline(baseline, final)


def main():
    global API_ORIGIN
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--kind", choices=KINDS + ["all"], default="all")
    parser.add_argument("--api-origin", default=API_ORIGIN)
    args = parser.parse_args()
    if args.dry_run:
        print(json.dumps(dry_run()))
        return 0
    API_ORIGIN = args.api_origin.rstrip("/")
    selected = KINDS if args.kind == "all" else [args.kind]
    results = []
    for kind in selected:
        result = run_kind(kind)
        results.append(result)
        print(json.dumps({"event": "passed", **result}, sort_keys=True), flush=True)
    print(json.dumps({"event": "complete", "kinds": selected}), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
