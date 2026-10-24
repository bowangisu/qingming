#!/usr/bin/env python3
"""Water mask and minimap for the viewer, derived from the L3 level of the pyramid (1/8 of the master).

Water = inside a hand-drawn outline of where the river can be (master px, read off the scan) AND smooth silk
(low local texture), so boats, banks, buildings and drawn figures fall out by themselves. Saved as an 8-bit PNG
the size of L3; the shader scales it to the master. Also writes a small minimap strip of the whole scroll.
Usage: python3 tools/make_masks.py assets/tiles assets
"""
import json, sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageChops

# outlines of possible water, master px (x, y); the canal (left part narrower, under the bridge) and the opening stream
OUTLINES = [
    [(14600, 60), (15200, 50), (16200, 140), (17000, 290), (18000, 370), (18900, 410), (19500, 280), (20500, 320),
     (21500, 300), (22500, 400), (24000, 400), (25500, 430), (26500, 450), (27500, 600), (28300, 900), (28900, 1300),
     (29200, 1760), (23500, 1760), (22300, 1560), (21800, 1210), (21300, 1100), (20500, 1085), (19500, 1085),
     (18900, 1055), (18500, 700), (17500, 640), (16500, 625), (15600, 605), (14900, 525), (14600, 300)],
    [(33000, 1250), (34500, 1150), (35800, 1080), (37350, 1100), (37350, 1720), (33000, 1720)],
]

def main(tiles, out):
    tiles, out = Path(tiles), Path(out)
    meta = json.loads((tiles / 'tiles.json').read_text())
    def level(n):
        L = meta['levels'][n]
        im = Image.new('RGB', (L['width'], L['height']))
        for t in L['tiles']:
            im.paste(Image.open(tiles / t['file']), (t['ax'], 0))
        return im
    img = level(3)
    W, H = img.size
    s = W / meta['master']['width']
    # local texture, measured on L2 (1/4): |grey - blur(grey)| averaged. Sampled values: open water 2-4,
    # boats, banks and figures 6-9 — so full water at <= 4, none at >= 6
    g2 = level(2).convert('L')
    detail = ImageChops.difference(g2, g2.filter(ImageFilter.GaussianBlur(1.5))).filter(ImageFilter.GaussianBlur(6))
    smooth = detail.point(lambda v: 255 if v <= 4 else (0 if v >= 6 else 128)).resize((W, H), Image.Resampling.BILINEAR)
    region = Image.new('L', (W, H), 0)
    d = ImageDraw.Draw(region)
    for o in OUTLINES:
        d.polygon([(x * s, y * s) for x, y in o], fill=255)
    region = region.filter(ImageFilter.GaussianBlur(3))
    mask = ImageChops.multiply(region, smooth).filter(ImageFilter.MedianFilter(5)).filter(ImageFilter.GaussianBlur(1.5))
    mask.save(out / 'water-mask.png', optimize=True)
    preview = Image.blend(img, Image.merge('RGB', (mask, mask.point(lambda v: v // 3), Image.new('L', (W, H), 0))), .45)
    preview.save(out.parent / 'tools' / 'water-mask-preview.png')
    mini = img.resize((2400, round(2400 * H / W)), Image.Resampling.LANCZOS)
    mini.save(out / 'minimap.webp', 'WEBP', quality=80, method=6)
    print('mask', mask.size, 'coverage %.1f%%' % (100 * sum(mask.get_flattened_data()) / 255 / (W * H)), 'minimap', mini.size)

if __name__ == '__main__':
    main(*sys.argv[1:3])
