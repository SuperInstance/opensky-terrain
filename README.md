# Shoalwater

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

## Overview

Shoalwater provides bathymetric Region Packs for 3D terrain platforms, focusing on Sitka Sound, Alaska. It establishes a data standard and a verified reference toolchain that transforms crowdsourced boat soundings (CSB) into game-ready bathymetric terrain tiles with accurate, fathom-true contours.

## Purpose

- **Data Standard**: Defines a standardized format for bathymetric data.
- **Reference Toolchain**: Includes a verified pipeline that processes CSB into quantized-mesh tiles with per-vertex extensions for bottom-type and confidence.
- **Accuracy**: Ensures honest, fathom-true contours verified against known ground truth.

## The Tide-Station Trap

A widely-copied research pack called NOAA station 9452210 "Sitka" — that station is Juneau. Sitka is 9451600; Port Alexander is 9451054 (all verified against NOAA/NCEI CO-OPS tables). The error was a catalyst for building a toolchain that verifies instead of copying.

## Verified Results

| Metric                          | Value          |
|---------------------------------|----------------|
| Tide coefficient recovery      | 0.9984 (vs 1.0) |
| Test shoal disagreement        | 0.996 -> 0.203 fathoms |
| Compression vs XYZ             | 21.7x          |
| Synthetic Region Pack size     | 1.35 MB        |
| LOD levels                      | 4              |
| Tide table coverage invariant  | Full timestamp range required |

## Key Features

- **CSB Joint Least-Squares Corrector**: Recovers tide coefficients with high accuracy.
- **Data Archiving**: Stores corrected soundings as COPC/LAZ with high compression.
- **Tile Baking**: Converts data to quantized-mesh-1.0 format with local ENU coordinates and per-vertex extensions.
- **LOD Selector**: Implements the contour-interval contract for efficient rendering.
- **Tide Handling**: Bakes static MLLW seafloor; runtime manages tide effects.

## Root Cause Analysis

Four independent tide-correction implementations initially plateaued at ~0.40 fathoms of disagreement. The root cause was the tide table ending before the sounding tracks, causing the interpolator to silently clamp ~300 soundings. The solution is an invariant: tide tables must cover the full timestamp range; never clamp — exclude and flag.

## Format Decisions

- **Quantized-Mesh Over Terrarium PNG**: Allows for per-vertex data carriage, true triangulation, and LOD error binding.
- **Local ENU Frame**: Chosen over Web Mercator due to its suitability at 57 degrees N.
- **Coordinate System**: Uses meters internally and fathoms for display.
- **Tide Management**: Bakes static MLLW seafloor; runtime manages tide effects.

## Status

- **Specification**: v0.1 draft with verified reference implementations.
- **Data Audit**: Pending access to the local data machine.
- **Open Decisions**: 
  - Pack extent vs curved sea surface.
  - Licensing split (recommended Apache-2.0 for code, CC-BY-4.0 for data).

## Repository Layout

- **spec/** : The standard documentation.
- **src/regionpack/** : Python reference toolchain.
- **runtime/** : TypeScript decoder and LOD selector.
- **examples/** : A minimal example pack whose reference tile is the conformance fixture for cross-language decode checks.
- **spike/** : A three-tile loader spike: the upstream `three-tile` TileLoader serving Region Pack tiles (verified headless against three-tile 0.12.2 — geometry, height range, and both extension attributes land exactly).
- **checks/** : One-command verification suite.
- **audit-kit/** : Original four-variant audit kit and NOAA tide prep tool.

## Audience

This repository is aimed at engineers and the dad-and-kid workshop behind OpenSkyFlight. The tone is scientific and plain, with an emphasis on providing receipts over claims.

## Quickstart

Run the verification suite with:

