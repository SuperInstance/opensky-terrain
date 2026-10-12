import json
import sys
import argparse
from pathlib import Path
from argparse import ArgumentParser
import tempfile
import copy


def validate_manifest(manifest, pack_dir, check_tile=False):
    errors = []

    # regionPackVersion: string, must be present.
    if 'regionPackVersion' not in manifest:
        errors.append("regionPackVersion: missing")
    elif not isinstance(manifest['regionPackVersion'], str):
        errors.append("regionPackVersion: not a string")

    # region: {id, name} present.
    region = manifest.get('region', {})
    if 'id' not in region:
        errors.append("region.id: missing")
    elif not isinstance(region['id'], str):
        errors.append("region.id: not a string")
    if 'name' not in region:
        errors.append("region.name: missing")
    elif not isinstance(region['name'], str):
        errors.append("region.name: not a string")

    # boundingBox: {crs: "EPSG:4326", west, south, east, north}
    bbox = manifest.get('boundingBox', {})
    if bbox.get('crs') != "EPSG:4326":
        errors.append("boundingBox.crs: must be 'EPSG:4326'")
    try:
        west = float(bbox.get('west', 0))
        south = float(bbox.get('south', 0))
        east = float(bbox.get('east', 0))
        north = float(bbox.get('north', 0))
    except (ValueError, TypeError):
        errors.append("boundingBox coordinates: invalid types")
        west, south, east, north = (0, 0, 0, 0)
    if west >= east:
        errors.append("boundingBox: west must be less than east")
    if south >= north:
        errors.append("boundingBox: south must be less than north")
    if not (-180 <= west <= 180):
        errors.append("boundingBox: west must be in [-180, 180]")
    if not (-180 <= east <= 180):
        errors.append("boundingBox: east must be in [-180, 180]")
    if not (-90 <= south <= 90):
        errors.append("boundingBox: south must be in [-90, 90]")
    if not (-90 <= north <= 90):
        errors.append("boundingBox: north must be in [-90, 90]")

    # coordinateSystems: storage.crs == "EPSG:4326"; runtime.frame == "ENU"; runtime.origin {lat, lon} present AND origin must lie INSIDE boundingBox; runtime.units == "meters".
    coord_systems = manifest.get('coordinateSystems', {})
    storage = coord_systems.get('storage', {})
    if storage.get('crs') != "EPSG:4326":
        errors.append("coordinateSystems.storage.crs: must be 'EPSG:4326'")
    runtime = coord_systems.get('runtime', {})
    if runtime.get('frame') != "ENU":
        errors.append("coordinateSystems.runtime.frame: must be 'ENU'")
    origin = runtime.get('origin', {})
    if 'lat' not in origin or 'lon' not in origin:
        errors.append("coordinateSystems.runtime.origin: must have 'lat' and 'lon'")
    else:
        try:
            origin_lat = float(origin['lat'])
            origin_lon = float(origin['lon'])
        except (ValueError, TypeError):
            errors.append("coordinateSystems.runtime.origin: invalid types for 'lat' and 'lon'")
            origin_lat, origin_lon = (0, 0)
        if not (bbox.get('west', 0) <= origin_lon <= bbox.get('east', 0)):
            errors.append("coordinateSystems.runtime.origin.lon: must lie within boundingBox")
        if not (bbox.get('south', 0) <= origin_lat <= bbox.get('north', 0)):
            errors.append("coordinateSystems.runtime.origin.lat: must lie within boundingBox")
    if runtime.get('units') != "meters":
        errors.append("coordinateSystems.runtime.units: must be 'meters'")

    # verticalDatum: {name: "MLLW", units: "meters", station: "9451600"}
    vertical_datum = manifest.get('verticalDatum', {})
    if vertical_datum.get('name') != "MLLW":
        errors.append("verticalDatum.name: must be 'MLLW'")
    if vertical_datum.get('units') != "meters":
        errors.append("verticalDatum.units: must be 'meters'")
    if vertical_datum.get('station') != "9451600":
        errors.append("verticalDatum.station: must be '9451600' (not '9452210' or others)")

    # layers.terrain: {format: "quantized-mesh-1.0", url template containing "{z}/{x}/{y}"}
    layers = manifest.get('layers', {})
    terrain = layers.get('terrain', {})
    if terrain.get('format') != "quantized-mesh-1.0":
        errors.append("layers.terrain.format: must be 'quantized-mesh-1.0'")
    url = terrain.get('url', "")
    if "{z}/{x}/{y}" not in url:
        errors.append("layers.terrain.url: must contain '{z}/{x}/{y}'")

    # extensionsSupported list; if it contains "bathymetry-confidence" then confidence.tiers must exist in the manifest.
    extensions = layers.get('extensionsSupported', [])
    if "bathymetry-confidence" in extensions:
        confidence = manifest.get('confidence', {})
        if 'tiers' not in confidence:
            errors.append("layers.extensionsSupported contains 'bathymetry-confidence' but confidence.tiers is missing")

    # contourIntervalLodMap OR contourIntervals: the fathom ladder available must include exactly the set {10,5,2,1}
    contour_interval_lod_map = manifest.get('contourIntervalLodMap', {})
    contour_intervals = manifest.get('contourIntervals', [])
    if not contour_interval_lod_map and not contour_intervals:
        errors.append("either contourIntervalLodMap or contourIntervals must be present")
    else:
        if contour_interval_lod_map:
            # LodMap keys are the fathom intervals (JSON keys are strings);
            # its VALUES are max geometric errors in meters (spec §5.2).
            ladder = {int(k) for k in contour_interval_lod_map.keys()}
        else:
            ladder = set(contour_intervals)
        required_ladder = {10, 5, 2, 1}
        if ladder != required_ladder:
            errors.append("contourIntervalLodMap/contourIntervals: must include exactly {10,5,2,1}")

        # defaultByCameraMode values must all be members of the ladder
        default_by_camera_mode = manifest.get('defaultByCameraMode', {})
        for key, value in default_by_camera_mode.items():
            if value not in ladder:
                errors.append(f"defaultByCameraMode.{key}: value must be in {required_ladder}")

    # verticalExaggeration: must exist; its presence anywhere in "physics" config must FAIL
    if 'verticalExaggeration' not in manifest:
        errors.append("verticalExaggeration: must be present")
    if 'physics' in manifest:
        physics = manifest['physics']
        if 'exaggeration' in physics:
            errors.append("verticalExaggeration: must not be present in 'physics' config")

    # sourceProvenance: non-empty list; each entry has origin and confidence or licensing.
    source_provenance = manifest.get('sourceProvenance', [])
    if not isinstance(source_provenance, list) or len(source_provenance) == 0:
        errors.append("sourceProvenance: must be a non-empty list")
    else:
        for entry in source_provenance:
            if 'origin' not in entry:
                errors.append("sourceProvenance: each entry must have 'origin'")
            if 'confidence' not in entry and 'licensing' not in entry:
                errors.append("sourceProvenance: each entry must have 'confidence' or 'licensing'")

    # license: {code, data} present; data license must NOT be CC-BY-SA (any variant spelling)
    license_ = manifest.get('license', {})
    if 'code' not in license_:
        errors.append("license.code: must be present")
    if 'data' not in license_:
        errors.append("license.data: must be present")
    data_license = license_.get('data', "")
    if data_license.lower() == "cc-by-sa" or data_license.lower() == "cc-by-sa 4.0":
        errors.append("license.data: must not be 'CC-BY-SA' (any variant spelling)")

    # privacy: if present must be "public" or "private".
    if 'privacy' in manifest:
        privacy = manifest['privacy']
        if privacy not in ["public", "private"]:
            errors.append("privacy: must be 'public' or 'private'")

    # versioning: {packVersion, contentHash} present; contentHash must start with "sha256:"
    versioning = manifest.get('versioning', {})
    if 'packVersion' not in versioning:
        errors.append("versioning.packVersion: must be present")
    if 'contentHash' not in versioning:
        errors.append("versioning.contentHash: must be present")
    else:
        content_hash = versioning['contentHash']
        if not content_hash.startswith("sha256:"):
            errors.append("versioning.contentHash: must start with 'sha256:'")
        else:
            suffix = content_hash[len("sha256:"):]
            if len(suffix) < 32 or not all(c in "0123456789abcdef" for c in suffix.lower()):
                errors.append("versioning.contentHash: must be a real sha256 hex digest, not a placeholder")

    # Tile spot check: given --tiles flag, verify at least the root tile file referenced by layers.terrain.url exists on disk under the pack dir (substitute z=0,x=0,y=0).
    if check_tile:
        url = terrain.get('url', "")
        url = url.replace("{z}", "0").replace("{x}", "0").replace("{y}", "0")
        tile_path = pack_dir / url
        if not tile_path.exists():
            errors.append(f"Tile file {tile_path} does not exist")

    return errors


def demo():
    with tempfile.TemporaryDirectory() as tmpdirname:
        tmpdir = Path(tmpdirname)
        good_manifest = {
            "regionPackVersion": "1.0",
            "region": {
                "id": "sitka",
                "name": "Sitka Sound"
            },
            "boundingBox": {
                "crs": "EPSG:4326",
                "west": -136.0,
                "south": 55,
                "east": -130,
                "north": 60
            },
            "coordinateSystems": {
                "storage": {
                    "crs": "EPSG:4326"
                },
                "runtime": {
                    "frame": "ENU",
                    "origin": {
                        "lat": 57.05,
                        "lon": -135.33
                    },
                    "units": "meters"
                }
            },
            "verticalDatum": {
                "name": "MLLW",
                "units": "meters",
                "station": "9451600"
            },
            "layers": {
                "terrain": {
                    "format": "quantized-mesh-1.0",
                    "url": "tiles/{z}/{x}/{y}.terrain"
                },
                "extensionsSupported": []
            },
            "contourIntervals": [10, 5, 2, 1],
            "verticalExaggeration": 1.0,
            "sourceProvenance": [
                {
                    "origin": "example.com",
                    "confidence": "high"
                }
            ],
            "license": {
                "code": "MIT",
                "data": "MIT"
            },
            "privacy": "public",
            "versioning": {
                "packVersion": "1.0",
                "contentHash": "sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
            }
        }
        good_manifest_path = tmpdir / "manifest.json"
        with open(good_manifest_path, 'w') as f:
            json.dump(good_manifest, f)

        # Create mutants
        mutants = []
        # 1. wrong station id
        mutant1 = copy.deepcopy(good_manifest)
        mutant1['verticalDatum']['station'] = "9452210"
        mutants.append(mutant1)
        # 2. origin outside bbox
        mutant2 = copy.deepcopy(good_manifest)
        mutant2['coordinateSystems']['runtime']['origin']['lon'] = -140
        mutants.append(mutant2)
        # 3. CC-BY-SA data license
        mutant3 = copy.deepcopy(good_manifest)
        mutant3['license']['data'] = "CC-BY-SA"
        mutants.append(mutant3)
        # 4. missing 1fm ladder rung
        mutant4 = copy.deepcopy(good_manifest)
        mutant4['contourIntervals'] = [10, 5, 2]
        mutants.append(mutant4)
        # 5. placeholder content hash
        mutant5 = copy.deepcopy(good_manifest)
        mutant5['versioning']['contentHash'] = "sha256:..."
        mutants.append(mutant5)
        # 6. exaggeration leaked into physics
        mutant6 = copy.deepcopy(good_manifest)
        mutant6['physics'] = {"exaggeration": 1.0}
        mutants.append(mutant6)

        # Write mutants
        for i, mutant in enumerate(mutants, 1):
            mutant_path = tmpdir / f"manifest_mutant{i}.json"
            with open(mutant_path, 'w') as f:
                json.dump(mutant, f)

        # Write tile file for the good manifest
        tile_dir = tmpdir / "tiles"
        tile_dir.mkdir()
        tile_file = tile_dir / "0" / "0" / "0.terrain"
        tile_file.parent.mkdir(parents=True)
        with open(tile_file, 'w') as f:
            f.write("tile content")

        # Run validator on good manifest
        args = argparse.Namespace(pack_dir=tmpdir, tiles=True)
        errors = validate_manifest(good_manifest, args.pack_dir, args.tiles)
        if errors:
            print("Good manifest failed validation")
            for error in errors:
                print(f"  - {error}")
            sys.exit(1)

        # Run validator on mutants
        summary = []
        for i in range(1, 7):
            mutant_path = tmpdir / f"manifest_mutant{i}.json"
            with open(mutant_path, 'r') as f:
                mutant = json.load(f)
            errors = validate_manifest(mutant, tmpdir, check_tile=True)
            summary.append((f"mutant{i}", len(errors) > 0))

        # Print summary table
        print("Summary of mutants:")
        print("-------------------")
        for mutant, failed in summary:
            print(f"{mutant}: {'PASS' if failed else 'FAIL'}")
        print("-------------------")
        if all([failed for _, failed in summary]):
            sys.exit(0)
        else:
            sys.exit(1)


def main():
    parser = ArgumentParser(description="Region Pack conformance validator")
    parser.add_argument("pack_dir", type=str, nargs="?", help="Path to the Region Pack directory")
    parser.add_argument("--tiles", action="store_true", help="Verify existence of root tile file")
    parser.add_argument("--demo", action="store_true", help="Run demo")
    args = parser.parse_args()

    if args.demo:
        demo()
    else:
        with open(args.pack_dir + "/manifest.json", 'r') as f:
            manifest = json.load(f)
        errors = validate_manifest(manifest, Path(args.pack_dir), args.tiles)
        if errors:
            print("Validation failed:")
            for error in errors:
                print(f"  - {error}")
            sys.exit(1)
        else:
            print("Validation passed")
            sys.exit(0)


if __name__ == "__main__":
    main()
