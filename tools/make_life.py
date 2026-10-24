#!/usr/bin/env python3
"""Build the moving layer from life/rigs.json.

A rig is a soft-edged region of the painting that the shader moves in place: a figure bobbing as it walks, a boat
rocking about its waterline, a tree swaying in the wind. Each rig's shape (a box, an ellipse or a polygon, in master
px) is cut down to the brushwork inside it, so bare silk stays still and only the figure moves:
  mask "fill"  (figures, default for gait and rock): the ink lines, with the shapes they enclose filled in
  mask "ink"   (branches, default for wind): the ink lines only
  mask "shape" (a whole boat): the shape as drawn
The mask is feathered, drawn at half resolution and packed into one greyscale atlas. Flocks (birds drawn for this page)
are copied through unchanged.
Writes assets/life-atlas.png and assets/life.json.
Usage: python3 tools/make_life.py life/rigs.json source/Alongtheriver_QingMing.jpg assets
"""
import json, math, sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

Image.MAX_IMAGE_PIXELS = None
INK = 14                       # how much darker than the silk around it a pixel must be to count as brushwork

SCALE = .5                     # atlas px per master px
TYPES = {'gait': 0, 'rock': 1, 'wind': 2}
ATLAS_W = 2048

def shape_points(r):
    if 'poly' in r: return [tuple(p) for p in r['poly']]
    if 'box' in r:
        x0, y0, x1, y1 = r['box']; return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    cx, cy, rx, ry = r['ellipse']
    return [(cx + rx * math.cos(a / 32 * math.tau), cy + ry * math.sin(a / 32 * math.tau)) for a in range(32)]

def fill_holes(m):
    """Fill the regions an outline encloses: whatever the outside can't reach is inside."""
    pad = Image.new('L', (m.width + 2, m.height + 2), 0); pad.paste(m, (1, 1))
    ImageDraw.floodfill(pad, (0, 0), 128)
    return pad.crop((1, 1, m.width + 1, m.height + 1)).point(lambda v: 0 if v == 128 else 255)

def brushwork(master, box, kind):
    grey = master.crop(box).convert('L')
    # the silk's own tone, from a median wide enough to step over the brush lines (taken at half size for speed)
    half = grey.resize((max(1, grey.width // 2), max(1, grey.height // 2)), Image.BOX)
    silk = half.filter(ImageFilter.MedianFilter(13)).resize(grey.size, Image.BILINEAR).filter(ImageFilter.GaussianBlur(6))
    ink = ImageChops.subtract(silk, grey.filter(ImageFilter.GaussianBlur(1.2)))   # the blur keeps the weave out
    if kind == 'fill':
        ink = ink.point(lambda v: 255 if v > INK else 0)
        ink = fill_holes(ink.filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.MinFilter(11)))
    else:
        ink = ink.point(lambda v: 255 if v > INK + 2 else 0)
    return ink.filter(ImageFilter.MaxFilter(5))

def main(src, master_path, out):
    spec = json.loads(Path(src).read_text())
    master = Image.open(master_path)
    masks = []
    for r in spec['rigs']:
        pts, f = shape_points(r), r.get('feather', 8)
        x0 = math.floor(min(p[0] for p in pts) - f - 2); x1 = math.ceil(max(p[0] for p in pts) + f + 2)
        y0 = math.floor(min(p[1] for p in pts) - f - 2); y1 = math.ceil(max(p[1] for p in pts) + f + 2)
        full = Image.new('L', (x1 - x0, y1 - y0), 0)
        ImageDraw.Draw(full).polygon([(x - x0, y - y0) for x, y in pts], fill=255)
        kind = r.get('mask', 'ink' if r['type'] == 'wind' else 'fill')
        if kind != 'shape':
            full = ImageChops.multiply(full, brushwork(master, (x0, y0, x1, y1), kind))
        w, h = max(2, round((x1 - x0) * SCALE)), max(2, round((y1 - y0) * SCALE))
        m = full.resize((w, h), Image.BOX).filter(ImageFilter.GaussianBlur(f * SCALE * .5))
        masks.append((r, (x0, y0, x1, y1), m))
    # shelf packing, tallest first
    order = sorted(range(len(masks)), key=lambda i: -masks[i][2].height)
    x = y = shelf = 0; place = {}
    for i in order:
        m = masks[i][2]
        if x + m.width + 2 > ATLAS_W: x, y, shelf = 0, y + shelf + 2, 0
        place[i] = (x, y); x += m.width + 2; shelf = max(shelf, m.height)
    H = 1 << max(4, math.ceil(math.log2(y + shelf + 2)))
    atlas = Image.new('L', (ATLAS_W, H), 0)
    rigs = []
    for i, (r, box, m) in enumerate(masks):
        ax, ay = place[i]; atlas.paste(m, (ax, ay))
        rigs.append({
            'id': r['id'], 'scene': r.get('scene'), 'box': box,
            'uv': [(ax + .5) / ATLAS_W, (ay + .5) / H, (ax + m.width - .5) / ATLAS_W, (ay + m.height - .5) / H],
            # a: type, hz, phase, amount (degrees for rock, px for wind); b: pivot x, pivot y, surge px, bounce/heave px
            'a': [TYPES[r['type']], r.get('hz', 1), r.get('phase', 0), r.get('amp', 0)],
            'b': [*(r.get('pivot') or [(box[0] + box[2]) / 2, box[3]]), *(r.get('move') or [0, 0])],
        })
    out = Path(out)
    atlas.save(out / 'life-atlas.png', optimize=True)
    (out / 'life.json').write_text(json.dumps({'atlas': 'life-atlas.png', 'rigs': rigs, 'flocks': spec.get('flocks', [])}, ensure_ascii=False, separators=(',', ':')))
    print(f'{len(rigs)} rigs, atlas {ATLAS_W}x{H}, {len(spec.get("flocks", []))} flocks')

if __name__ == '__main__':
    main(*sys.argv[1:4])
