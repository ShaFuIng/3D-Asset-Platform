# 2026-07-31 Model Viewer Inspection

## Scope

Improve the Three.js GLB preview on `feat/model-viewer-inspection` without changing the backend or `prototype-reference`.

## Changes

- Replaced the single fixed directional light with ambient plus front, back, left, right, and bottom fill lights.
- Explicitly disabled renderer and mesh shadows.
- Added a ground grid and axes helper.
- Added Original, Clay, Normal, and Wireframe material modes.
- Added mesh, vertex, and triangle statistics.
- Added grid, auto-rotate, and camera reset controls.
- Positioned the loaded model on the ground grid before framing the camera.
- Added GPL-3.0 licensing and ComfyUI Frontend attribution.

## Validation

- `tsc --noEmit` passed using React 19.1, TypeScript 5.8.3, Three.js 0.185.1, and matching type packages.
- Browser rendering with a generated GLB still requires local verification.
