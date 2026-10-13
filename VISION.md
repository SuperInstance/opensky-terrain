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

## Thin and thick instances

The same world runs at different weights. The browser version is a
thin client: it draws the quilt of tiles it is handed and asks little
of the device — a phone, an iPad, anything can be a window. The thick
instance lives on real hardware — a laptop with a GPU in it — where the
full-resolution pack resides, the judgement model fits, the hundred
rehearsals run, and new detail gets pre-figured. The pack format is the
contract between them: the thick instance distils and publishes levels
up; the thin one never computes what the thick one already knows.

Between them sits a third weight: the **digester** — an always-on
server in the sky with no GPU but plenty of patience. It pulls large
things off the internet, renders and digests them into game-ready map
data at the quality that makes sense, and serves the browser something
far smaller than the source. It holds the hot areas warm in memory —
more than a cold pull, less than a GPU agent — the last-mile kitchen
between cold storage and the table. CPU-shaped work: fetching,
reprojecting, tiling, compressing, pre-rendering. The moment a job
needs a GPU's gradients, it belongs to the thick instance.

In development, the thick instance doubles as the **asset factory**.
Baking data is fast; beauty is slow, and slowness is acceptable when it
runs overnight: full-surface bakes of entire data files (not just one
bay's clip), full-map renders, and generated assets — AI-grown meshes
for boats, trees, buildings, a wreck; vector drawings for symbology
and interfaces — refined in the 3D tools and shipped as game-ready
geometry. The overnight queue is a feature of the workflow, not an
embarrassment: measure the small render, extrapolate honestly, queue
the big one, wake up to a world.

This is already true in miniature: the public site serves the overview
levels of Sitka Sound to anyone, while the full 25 m pack — all 579
tiles — stays on the local machine that baked it. (The flight sim's
live traffic already digests through such a server-side proxy; the
pattern is proven in the family.)

## The living layer: from depth to life

Depth, in a place like Sitka Sound, is done — the charts are good enough
that nobody sounds for depth any more; the sounder is for fish. So the
fog of war moves up one level: from where the bottom *is* to what is
*living on it*.

An observer changes the kind of knowledge. A camera dragged along the
bottom for an entire trip — not highlights, whole trips — or a drone
parked on a wreck sees what is actually there, for a while. Sightings go
onto the map with a timestamp: last known position, staling honestly,
the way all real intelligence does.

Then the map starts to guess. A judgement model reads the terrain and
the sightings together — crabs in the drainages, where the river's
course runs on beneath the sea — and marks the unchecked places it
believes in. Go and check them. A hit, and the model's confidence
grows. A miss — above all a miss on its best prediction — is a negative
result, recorded as one, and the math re-figures. Prediction, check,
testimony: the survey loop, one abstraction up. The pinnacles that
emerge this time are alive.

And every fleet sees a different ocean. Seiners, gillnetters, trollers,
longliners, crabbers, shrimpers, divers, sport boats chasing one big
fish — same water, different objectives, different games, all of them
true. The cat-and-mouse of finding them is not an invented mode. It is
what the harbour already does every morning.

## Rehearse the real: scripts, simulation, the captain's pick

A drone sortie lives on a budget — the rule of thirds: a third of the
battery out, a third back, a third in reserve. The game respects the
same physics, which makes it a rehearsal room instead of a toy.

Agents draft candidate scripts from a library of typical patterns with
small variations — not new programming each time, the wheel is not
reinvented — and fly them in simulation against everything the system
currently believes: the fused soundings, the catches, the sightings,
the model's own predictions. A hundred rehearsals in minutes. A few
survivors, ranked, each with its reasons.

Then the human does the part only the human does: *that one — that's
what I'm looking for.* Intent, picked from shown alternatives, not
specified from a blank page. Over time the system learns the shape of
the intent it serves. And the picked script can leave the game: the
real drone flies it, in the real water, to the spots that matter — the
ones he was going to anyway, or the just-in-case gold mines.

With a fleet's data pooled — every sounder, every catch record, every
camera anyone ran — the game becomes the shared room between running
gear: play the next two hours in five minutes. *Go two miles and tell
me if the school is denser up there* is a script, a simulation, and
then, if the captain likes it, a fact-finding trip. Data feeds the
simulation; the simulation aims the sortie; the sortie brings back
data. The game, the chart, and the fishing are one system at three
speeds.

## Later horizons

- Fishing tows that appear in the world with the fish as they were seen.
- Downtown-grade detail, rendered through local GPU compute.
- More bays, more sounds — the pipeline is the place-independent part.

## Status

The first playable slice is live today: a boat on the surface and a drone
underneath it, over the real Sitka Sound pack, at
https://superinstance.github.io/shoalwater/explore.html — the chart
view and the verified format live alongside it in this repository.
