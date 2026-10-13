# Open Sitka Sound — Vision

*A game in the spirit of OpenSkyFlight, set in a real place: Sitka Sound,
built from measured data instead of invented terrain.*

## The world is measured, not imagined

The seafloor comes from real soundings, fused and tide-fitted by the
pipeline in this repository and verified end to end. The land is the same
elevation field's other half — one surface, shoreline where the field
crosses the tide. Buildings, piers, and docks come from open map data.
Satellite and street imagery are used as *reference* for what things look
like; the game ships open and measured data, never scraped imagery.

## The start state is the real state

You begin in the harbor as it actually is: boats in their slips, boats at
anchor where boats anchor, a cruise ship on its anchorage. On top of that
sits a light theory of mind — fast boats run the channel, slow boats work
the bays — plausible motion, honestly labelled as such.

## The tide is the clock

The bottom is baked once, at MLLW. The water moves. A cove that is a
harbor at high water is a mudflat with a winding channel at low water,
and a boat can only leave when the tide says so. No invented puzzles:
seamanship is the game mechanic.

## Scene 1: Jamestown Bay

A dive boat anchored over the mid-bay shoal — 3.7 m of water, measured —
and a drone that goes down to look at it. Around the back of the bay:
quiet docks, float houses, kelp beds, crabs, and a small wreck on the
bottom, circumnavigable, waiting to be found properly.

## Ground truth is a practice, not a dataset

The world gets truer the way the bathymetry did: by going out in a boat.
Surface cameras and underwater cameras, dropped on the same spots the
soundings came from, turn select places — a kelp bed, a reef, the wreck —
from interpolated colour into witnessed fact. Survey days are play days;
mapping the game world and mapping the professional chart are the same
motion at two registers.

## The engine principles

**Ground truth in, accuracy up.** The world is a fit to data, not a
sculpture. Any truth you feed it — a sounding, a kayak track with a
camera, a filmed pass around a wreck — makes its patch of the world more
accurate, the same way crowd-sourced soundings tighten a chart. Exploring
and surveying are the same act.

**Grow the forest; don't count the trees.** Where detail is unmeasured,
generate it from measured statistics: the species mix, its percentages,
its densities and places. You never polygon every tree — you learn how
that species grows in that area, and grow it. Generated detail is
inference, and the format already knows how to say so: the confidence
channel that marks interpolated seafloor marks grown shoreline the same
way. Measured where measured, grown where not, labelled either way.

**The quilt.** Rendering is a window slid over tiles: fetch once, cache
the sliding area as wide as memory allows, never redraw what is already
quilted, and embed information at depths that only render when you zoom
to them — the way a chart plotter tiles a new area as you scroll into it.
Precompute the expensive figuring; let each device draw only its level.

**One world, many registers.** The same measured world wears a chart
view for planning and a game view for being in it — the way a map app
switches to road view, we switch to the boat. Nothing is re-authored;
the register changes, the world doesn't.

**True in space, compressed in time.** The geography, the depths, the
tide are as measured. The pacing is edited: long transits fold away, and
the game keeps the exciting parts — which is easy, because the real
thing is exciting enough.

## Later horizons

- Fishing tows that appear in the world with the fish as they were seen.
- Downtown-grade detail, rendered through local GPU compute.
- More bays, more sounds — the pipeline is the place-independent part.

## Status

The first playable slice is live today: a boat on the surface and a drone
underneath it, over the real Sitka Sound pack, at
https://superinstance.github.io/opensky-terrain/explore.html — the chart
view and the verified format live alongside it in this repository.
