# 2D Scene Planner

A fast 2D scene generator for **Disguise Designer**.

2D Scene Planner is a third-party plugin for quickly building simple stage layouts directly inside Designer.

It is intended for fast scene preparation when a full 3D workflow would be unnecessary or too slow.

> Beta - use on a copy of important projects while testing.

## Download

**[Download latest 2D Scene Planner](https://github.com/sshadov/2d-scene-planner/releases/latest/download/2D-Scene-Planner.zip)**

[All releases](https://github.com/sshadov/2d-scene-planner/releases)

## Features

- Fast 2D top-view scene planning
- Create and position:
  - LED Screens
  - DMX Screens
  - Projection Surfaces
  - Projectors
  - DMX Lights
  - Cameras
- Move, rotate and align objects
- Live synchronization with Disguise Designer
- Projector -> Projection Surface binding
- Horizontal / vertical Surface handling

## Built-in calculations

- Projector throw ratio calculation
- Projected pixel size calculation
- LED screen resolution calculation from pixel density / pixel pitch
- LED pixel density / pixel size validation

## Installation

Download the ZIP and extract the included `2D Scene Planner` folder into:

```text
<d3 Projects>\Common\Plugins\
```

Final structure:

```text
<d3 Projects>\Common\Plugins\2D Scene Planner\d3plugin.json
```

The plugin will then be available in Designer's Plugin Launcher. It may alternatively be placed in a project's local `Plugins` folder.

## Basic usage

1. Open 2D Scene Planner from Designer's Plugin Launcher.
2. Set the scene dimensions.
3. Add objects to the 2D plan.
4. Drag, rotate and align them.
5. Bind Projectors to Projection Surfaces where required.
6. Use the calculated projection and LED parameters.

## Status

This project is currently in beta. Feedback and bug reports are welcome.

## Compatibility

Developed for Disguise Designer. Specific tested Designer versions can be documented as testing continues.

## Disclaimer

This is an independent third-party project and is not affiliated with or endorsed by Disguise.

## License

Copyright © 2026 Sasha Shadov.

All rights reserved.
