#!/usr/bin/env python3
"""Cut the master scan into a WebP tile pyramid for the viewer.

Levels 0..3 are 1, 1/2, 1/4 and 1/8 of the master. Each tile covers CORE px of its level along x and is padded by
PAD px on both sides (copied from the neighbours) so shader effects that sample a few pixels away never see a seam.
Writes assets/tiles/L{level}/{index}.webp and assets/tiles/tiles.json. Crop and resample only: no colour changes.
Usage: python3 tools/make_tiles.py source/Alongtheriver_QingMing.jpg assets/tiles
"""
import hashlib, json, sys
from pathlib import Path
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
CORE, PAD, QUALITY = 2048, 8, 82

def main(src, out):
    src, out = Path(src), Path(out)
    master = Image.open(src).convert('RGB')
    W, H = master.size
    meta = {'master': {'file': src.name, 'width': W, 'height': H,
                       'sha256': hashlib.sha256(src.read_bytes()).hexdigest()},
            'core': CORE, 'pad': PAD, 'levels': []}
    for level in range(4):
        f = 2 ** level
        img = master if level == 0 else master.resize((round(W / f), round(H / f)), Image.Resampling.LANCZOS)
        w, h = img.size
        d = out / f'L{level}'
        d.mkdir(parents=True, exist_ok=True)
        tiles = []
        for i, x0 in enumerate(range(0, w, CORE)):
            x1 = min(w, x0 + CORE)
            a, b = max(0, x0 - PAD), min(w, x1 + PAD)
            tile = img.crop((a, 0, b, h))
            path = d / f'{i}.webp'
            tile.save(path, 'WEBP', quality=QUALITY, method=6)
            # x0/x1: the tile's core in level px; ax/bx: the padded extent actually stored
            tiles.append({'file': f'L{level}/{i}.webp', 'x0': x0, 'x1': x1, 'ax': a, 'bx': b, 'bytes': path.stat().st_size})
        meta['levels'].append({'scale': 1 / f, 'width': w, 'height': h, 'tiles': tiles})
        print(f'L{level}: {w}x{h}, {len(tiles)} tiles, {sum(t["bytes"] for t in tiles) / 1e6:.1f} MB', flush=True)
    (out / 'tiles.json').write_text(json.dumps(meta, indent=1))

if __name__ == '__main__':
    main(*sys.argv[1:3])
