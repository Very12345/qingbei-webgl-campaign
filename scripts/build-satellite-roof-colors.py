import colorsys
import json
import math
from pathlib import Path
from statistics import median

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / "work" / "references" / "satellite"
map_source = (ROOT / "src" / "osm-map-data-real.ts").read_text("utf-8")
region = json.loads(map_source.split("export const osmRegions = ", 1)[1].rsplit(" as const;", 1)[0])["main"]
south, west, north, east = region["bbox"]


def point_in_polygon(x, z, points):
    inside = False
    j = len(points) - 1
    for i, point in enumerate(points):
        previous = points[j]
        if ((point[1] > z) != (previous[1] > z)) and x < (
            (previous[0] - point[0]) * (z - point[1]) / (previous[1] - point[1]) + point[0]
        ):
            inside = not inside
        j = i
    return inside


campuses = {
    "pku": next(value for value in region["campuses"] if value["name"] == "北京大学"),
    "thu": next(value for value in region["campuses"] if value["name"] == "清华大学"),
}


def source(name):
    image = Image.open(REFERENCE / f"{name}-esri.jpg").convert("RGB")
    extent = json.loads((REFERENCE / f"{name}-esri.json").read_text("utf-8"))["extent"]
    return image, extent


sources = {name: source(name) for name in ("pku", "thu")}


def world_to_lon_lat(point):
    x, z = point
    return (
        (west + east) / 2 + x / region["width"] * (east - west),
        (south + north) / 2 - z / region["depth"] * (north - south),
    )


def pixel(point, image, extent):
    lon, lat = world_to_lon_lat(point)
    return (
        (lon - extent["xmin"]) / (extent["xmax"] - extent["xmin"]) * image.width,
        (extent["ymax"] - lat) / (extent["ymax"] - extent["ymin"]) * image.height,
    )


def roof_color(building, campus):
    image, extent = sources[campus]
    polygon = [pixel(point, image, extent) for point in building["points"]]
    min_x = max(0, int(min(point[0] for point in polygon)))
    max_x = min(image.width - 1, int(max(point[0] for point in polygon)) + 1)
    min_y = max(0, int(min(point[1] for point in polygon)))
    max_y = min(image.height - 1, int(max(point[1] for point in polygon)) + 1)
    if max_x <= min_x or max_y <= min_y:
        return None
    mask = Image.new("L", (max_x - min_x + 1, max_y - min_y + 1), 0)
    draw = ImageDraw.Draw(mask)
    draw.polygon([(x - min_x, y - min_y) for x, y in polygon], fill=255)
    if mask.width >= 7 and mask.height >= 7:
        mask = mask.filter(ImageFilter.MinFilter(5))
    crop = image.crop((min_x, min_y, max_x + 1, max_y + 1))
    values = [rgb for rgb, selected in zip(crop.getdata(), mask.getdata()) if selected and 32 < max(rgb) < 248]
    if len(values) < 4:
        return None
    red, green, blue = (median(value[channel] for value in values) / 255 for channel in range(3))
    hue, saturation, brightness = colorsys.rgb_to_hsv(red, green, blue)
    saturation = min(0.62, saturation * 1.08)
    brightness = min(0.76, max(0.30, brightness * 0.92))
    red, green, blue = colorsys.hsv_to_rgb(hue, saturation, brightness)
    return f"#{round(red * 255):02x}{round(green * 255):02x}{round(blue * 255):02x}", len(values)


result = {}
for building in region["buildings"]:
    center_x = sum(point[0] for point in building["points"]) / len(building["points"])
    center_z = sum(point[1] for point in building["points"]) / len(building["points"])
    campus = next((name for name, area in campuses.items() if point_in_polygon(center_x, center_z, area["points"])), None)
    if campus is None:
        continue
    sampled = roof_color(building, campus)
    if sampled is None:
        continue
    color, pixels = sampled
    result[f'{building["osmType"]}/{building["osmId"]}'] = {"color": color, "pixels": pixels, "source": f"esri-{campus}"}

target = ROOT / "src" / "game" / "real-campus-satellite-colors.ts"
target.write_text(
    "// Generated from local reference-only Esri World Imagery exports; source pixels are not redistributed.\n"
    f"export const SATELLITE_ROOF_COLORS = {json.dumps(result, ensure_ascii=False, separators=(',', ':'))} as const;\n",
    "utf-8",
)
print(json.dumps({"sampledCampusRoofs": len(result), "target": str(target)}, ensure_ascii=False))


def bounded(polygons):
    return [
        (
            min(point[0] for point in item["points"]),
            max(point[0] for point in item["points"]),
            min(point[1] for point in item["points"]),
            max(point[1] for point in item["points"]),
            item["points"],
        )
        for item in polygons
    ]


obstacles = bounded(region["buildings"] + region["waters"] + region.get("hardscapes", []))


def blocked(x, z):
    return any(min_x <= x <= max_x and min_z <= z <= max_z and point_in_polygon(x, z, points) for min_x, max_x, min_z, max_z, points in obstacles)


road_cell = 0.5
road_index = {}
for road in region["roads"]:
    radius = road["width"] / 2 + 0.025
    for first, second in zip(road["points"], road["points"][1:]):
        segment = (first[0], first[1], second[0], second[1], radius)
        for gx in range(math.floor((min(first[0], second[0]) - radius) / road_cell), math.floor((max(first[0], second[0]) + radius) / road_cell) + 1):
            for gz in range(math.floor((min(first[1], second[1]) - radius) / road_cell), math.floor((max(first[1], second[1]) + radius) / road_cell) + 1):
                road_index.setdefault((gx, gz), []).append(segment)


def on_road(x, z):
    for x1, z1, x2, z2, radius in road_index.get((math.floor(x / road_cell), math.floor(z / road_cell)), []):
        dx, dz = x2 - x1, z2 - z1
        length = dx * dx + dz * dz
        t = max(0, min(1, ((x - x1) * dx + (z - z1) * dz) / length)) if length else 0
        if math.hypot(x - (x1 + dx * t), z - (z1 + dz * t)) <= radius:
            return True
    return False


def looks_like_canopy(x, z, campus):
    image, extent = sources[campus]
    px, py = pixel((x, z), image, extent)
    ix, iy = round(px), round(py)
    if ix < 3 or iy < 3 or ix >= image.width - 3 or iy >= image.height - 3:
        return False
    values = [image.getpixel((sx, sy)) for sx in range(ix - 3, ix + 4) for sy in range(iy - 3, iy + 4)]
    channels = [sum(value[channel] for value in values) / len(values) for channel in range(3)]
    luminance = [0.299 * value[0] + 0.587 * value[1] + 0.114 * value[2] for value in values]
    mean = sum(luminance) / len(luminance)
    deviation = math.sqrt(sum((value - mean) ** 2 for value in luminance) / len(luminance))
    red, green, blue = channels
    return mean < 132 and deviation > 12 and green > blue * 0.86 and red < green * 1.30


trees_by_campus = {}
spacing = 0.28
for campus, area in campuses.items():
    min_x = min(point[0] for point in area["points"])
    max_x = max(point[0] for point in area["points"])
    min_z = min(point[1] for point in area["points"])
    max_z = max(point[1] for point in area["points"])
    points = []
    x = math.ceil(min_x / spacing) * spacing
    while x <= max_x:
        z = math.ceil(min_z / spacing) * spacing
        while z <= max_z:
            if point_in_polygon(x, z, area["points"]) and not blocked(x, z) and not on_road(x, z) and looks_like_canopy(x, z, campus):
                points.append([round(x, 3), round(z, 3)])
            z += spacing
        x += spacing
    trees_by_campus[campus] = points

tree_target = ROOT / "src" / "game" / "real-campus-satellite-trees.ts"
tree_target.write_text(
    "// Fixed canopy sample points derived from local reference-only Esri World Imagery exports; source pixels are not redistributed.\n"
    f"export const SATELLITE_TREE_POINTS = {json.dumps(trees_by_campus, ensure_ascii=False, separators=(',', ':'))} as const;\n",
    "utf-8",
)
print(json.dumps({"satelliteTreePoints": {key: len(value) for key, value in trees_by_campus.items()}, "target": str(tree_target)}, ensure_ascii=False))
