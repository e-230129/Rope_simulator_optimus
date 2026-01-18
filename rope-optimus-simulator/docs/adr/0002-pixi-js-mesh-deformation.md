# ADR-0002: Pixi.js Mesh Deformation Introduction

## Status
Accepted

## Context
Want to move the Optimus hand fingers in Photo Mode using static images.
WebGL-based mesh deformation technology is needed.

## Decision
Adopt Pixi.js (v8.x).
Reasons:
- Easy React integration
- Simple mesh deformation with SimplePlane
- Lightweight (smaller than three.js)

## Consequences
- Bundle size increases by approximately 200KB
- Fallback needed for browsers without WebGL support
