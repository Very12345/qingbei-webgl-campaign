import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / "src" / "osm-map-data-real.ts").read_text("utf-8")
region = json.loads(source.split("export const osmRegions = ", 1)[1].rsplit(" as const;", 1)[0])["main"]
SIZE = 4096
OUTPUT_SIZE = 2048
min_x, max_x = region["offsetX"] - region["width"] / 2, region["offsetX"] + region["width"] / 2
min_z, max_z = -region["depth"] / 2, region["depth"] / 2
pedestrian_kinds = {"footway", "path", "pedestrian", "steps", "cycleway", "corridor", "platform"}


def pixel(point):
    return (
        round((point[0] - min_x) / region["width"] * (SIZE - 1)),
        round((max_z - point[1]) / region["depth"] * (SIZE - 1)),
    )


def pixel_width(world_width):
    return max(1, round(world_width / region["width"] * SIZE))


mask = Image.new("RGB", (SIZE, SIZE), (0, 0, 0))
draw = ImageDraw.Draw(mask)
for area in region.get("hardscapes", []):
    color = (255, 0, 0) if area["kind"] == "parking" else (0, 255, 0)
    draw.polygon([pixel(point) for point in area["points"]], fill=color)

draws = []
endpoints = []
segments = []
for road_index, road in enumerate(region["roads"]):
    if len(road["points"]) < 2 or road.get("bridge"):
        continue
    pedestrian = road["kind"] in pedestrian_kinds
    width = max(road["width"], 0.04 if pedestrian else 0.08)
    color = (0, 255, 0) if pedestrian else (0, 0, 255) if road["kind"] == "track" else (255, 0, 0)
    priority = 0 if pedestrian or road["kind"] == "track" else 2
    if not pedestrian and (road.get("sidewalk") not in (None, "", "no") or road["kind"] in {"primary", "secondary", "tertiary", "residential", "living_street"}):
        draws.append((1, road["points"], width + 0.055, (0, 255, 0)))
    draws.append((priority, road["points"], width, color))
    endpoints.extend([
        {"x": road["points"][0][0], "z": road["points"][0][1], "width": width, "pedestrian": pedestrian, "road": road_index, "color": color, "priority": priority},
        {"x": road["points"][-1][0], "z": road["points"][-1][1], "width": width, "pedestrian": pedestrian, "road": road_index, "color": color, "priority": priority},
    ])
    for first, second in zip(road["points"], road["points"][1:]):
        segments.append({"x1": first[0], "z1": first[1], "x2": second[0], "z2": second[1], "width": width, "pedestrian": pedestrian, "road": road_index, "color": color, "priority": priority})

cell = 0.35
endpoint_index = {}
segment_index = {}
for endpoint in endpoints:
    endpoint_index.setdefault((math.floor(endpoint["x"] / cell), math.floor(endpoint["z"] / cell)), []).append(endpoint)
for segment in segments:
    for gx in range(math.floor((min(segment["x1"], segment["x2"]) - 0.14) / cell), math.floor((max(segment["x1"], segment["x2"]) + 0.14) / cell) + 1):
        for gz in range(math.floor((min(segment["z1"], segment["z2"]) - 0.14) / cell), math.floor((max(segment["z1"], segment["z2"]) + 0.14) / cell) + 1):
            segment_index.setdefault((gx, gz), []).append(segment)

connected = set()
connector_keys = set()
for endpoint_id, endpoint in enumerate(endpoints):
    gx, gz = math.floor(endpoint["x"] / cell), math.floor(endpoint["z"] / cell)
    closest, closest_distance = None, 0.32
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            for candidate in endpoint_index.get((gx + dx, gz + dz), []):
                if candidate["road"] == endpoint["road"] or candidate["pedestrian"] != endpoint["pedestrian"]:
                    continue
                distance = math.hypot(endpoint["x"] - candidate["x"], endpoint["z"] - candidate["z"])
                if 0.004 < distance < closest_distance:
                    closest, closest_distance = candidate, distance
    if closest:
        first = (round(endpoint["x"], 3), round(endpoint["z"], 3))
        second = (round(closest["x"], 3), round(closest["z"], 3))
        key = tuple(sorted((first, second)))
        if key not in connector_keys:
            connector_keys.add(key)
            draws.append((endpoint["priority"], [[endpoint["x"], endpoint["z"]], [closest["x"], closest["z"]]], min(endpoint["width"], closest["width"]), endpoint["color"]))
        connected.add(endpoint_id)

for endpoint_id, endpoint in enumerate(endpoints):
    if endpoint_id in connected:
        continue
    gx, gz = math.floor(endpoint["x"] / cell), math.floor(endpoint["z"] / cell)
    best = None
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            for segment in segment_index.get((gx + dx, gz + dz), []):
                if segment["road"] == endpoint["road"] or segment["pedestrian"] != endpoint["pedestrian"]:
                    continue
                sx, sz = segment["x2"] - segment["x1"], segment["z2"] - segment["z1"]
                length = sx * sx + sz * sz
                t = max(0, min(1, ((endpoint["x"] - segment["x1"]) * sx + (endpoint["z"] - segment["z1"]) * sz) / length)) if length else 0
                x, z = segment["x1"] + sx * t, segment["z1"] + sz * t
                distance = math.hypot(endpoint["x"] - x, endpoint["z"] - z)
                if 0.004 < distance < 0.14 and (best is None or distance < best[0]):
                    best = (distance, x, z, segment)
    if best:
        _, x, z, segment = best
        draws.append((endpoint["priority"], [[endpoint["x"], endpoint["z"]], [x, z]], min(endpoint["width"], segment["width"]), endpoint["color"]))

for _, points, width, color in sorted(draws, key=lambda value: value[0]):
    pixels = [pixel(point) for point in points]
    line_width = pixel_width(width)
    draw.line(pixels, fill=color, width=line_width, joint="curve")
    radius = line_width // 2
    if radius:
        for x, y in (pixels[0], pixels[-1]):
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)

target = ROOT / "public" / "materials" / "campus-surface-mask.png"
# Rasterize at double resolution, then downsample once. This preserves narrow
# footways without forcing every client to keep a 4096px mask in GPU memory.
output_mask = mask.resize((OUTPUT_SIZE, OUTPUT_SIZE), Image.Resampling.LANCZOS)
output_mask.save(target, "PNG", optimize=True)
def point_in_polygon(x, z, points):
    inside = False
    previous = points[-1]
    for current in points:
        if (current[1] > z) != (previous[1] > z) and x < (previous[0] - current[0]) * (z - current[1]) / (previous[1] - current[1] + 1e-12) + current[0]:
            inside = not inside
        previous = current
    return inside


campus_polygons = [campus["points"] for campus in region.get("campuses", []) if campus["name"] in {"北京大学", "清华大学"}]
lamp_mask = Image.new("L", (SIZE, SIZE), 0)
lamp_draw = ImageDraw.Draw(lamp_mask)
lamp_seen = set()
lamp_count = 0


def add_lamp(x, z):
    global lamp_count
    key = (round(x * 4), round(z * 4))
    if key in lamp_seen or lamp_count >= 650:
        return
    lamp_seen.add(key)
    lamp_count += 1
    px, py = pixel([x, z])
    radius = pixel_width(0.22)
    lamp_draw.ellipse((px - radius, py - radius, px + radius, py + radius), fill=255)


for x, z in region.get("lamps", []):
    add_lamp(x, z)
for road in region["roads"]:
    if road["kind"] in {"steps", "corridor", "track", "motorway", "motorway_link", "trunk", "trunk_link"} or road.get("lit") == "no":
        continue
    if not any(any(point_in_polygon(point[0], point[1], campus) for campus in campus_polygons) for point in road["points"]):
        continue
    spacing = 0.72
    distance_until_next = spacing * 0.5
    for first, second in zip(road["points"], road["points"][1:]):
        dx, dz = second[0] - first[0], second[1] - first[1]
        length = math.hypot(dx, dz)
        if length < 0.01:
            continue
        travelled = 0
        while travelled + distance_until_next <= length:
            travelled += distance_until_next
            amount = travelled / length
            add_lamp(first[0] + dx * amount, first[1] + dz * amount)
            distance_until_next = spacing
        distance_until_next -= length - travelled
night_light = lamp_mask.resize((OUTPUT_SIZE, OUTPUT_SIZE), Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(4))
light_target = ROOT / "public" / "materials" / "campus-night-light-mask.png"
night_light.save(light_target, "PNG", optimize=True)
print(json.dumps({"size": OUTPUT_SIZE, "rasterSize": SIZE, "roads": len(region["roads"]), "connectors": len(connector_keys), "lamps": lamp_count, "bytes": target.stat().st_size, "target": str(target), "nightLightBytes": light_target.stat().st_size}, ensure_ascii=False))
