# 清明上河图 · Along the River

Zhang Zeduan's handscroll *Along the River During the Qingming Festival* (Northern Song, early 12th century,
24.8 × 528.7 cm, Palace Museum, Beijing), unrolled from right to left as you scroll. The camera stops at seven scenes
along the 5.3 metres of silk. At each one it zooms in and circles the details in cinnabar, and a short text explains
what you are looking at. Between scenes it pulls back to show where you are on the scroll, then flies on to the next.
After the last scene it pulls out to the whole scroll, and as you keep scrolling the scroll rolls back up from its far
end and closes as it began, beside four closing notes: what the scroll shows, the debate over its title, whether it
celebrates or warns, and its own journey to the Palace Museum.

The picture is the real painting, a 38,414 × 1,800 pixel public-domain scan, not generated artwork. The ripples on
the water, the drifting mist and the shading around each subject are drawn live over it. In every scene the painting
also moves: donkeys, camels and porters bob as they walk, sedan chairs sway on their bearers' poles, the boats rock
while the Rainbow Bridge stays put, the crew lean on their poles, onlookers and shopkeepers gesture, and the willows
move in the wind. That movement is the painting's own
brushwork shifted a few pixels at a time, not redrawn. The crows and swallows are the one addition, drawn for this
page.

## Run it

```bash
python3 -m http.server 8000      # from this folder
# → http://localhost:8000/
```

Any static server works. The page needs WebGL 2 (current Chrome, Edge, Firefox and Safari all have it). A link to a
scene opens on it: `#road`, `#willow`, `#grain`, `#bridge`, `#gate`, `#tavern`, `#end`.

Controls: scroll or swipe to read; <kbd>←</kbd> goes to the next scene and <kbd>→</kbd> to the previous one (reading
runs leftward); the seals above the strip map jump to a scene. With *reduce motion* set in the system, flights become
cross-fades, the slow push-in stops and the water and mist hold still.

## How it works

| piece | file | what it does |
|---|---|---|
| Story | `src/story.js` | The seven scenes in reading order: the rectangle the camera frames, the details to circle (centre, radius, label, which way the label leads), the text. Coordinates are master-scan pixels, read off full-resolution crops. |
| Timeline | `src/main.js` | Scroll position, in screen heights, becomes a sequence: a closed scroll, unrolling, then *fly → hold* for every shot, and a last flight out to the whole scroll, then the roll-up (the camera follows the roll back to the start and closes in) and the closing notes, which appear one at a time. Flights use van Wijk & Nuij's smooth zoom (2003), which pulls back in proportion to the distance travelled. During a hold the camera pushes in slightly while the loops, leader lines and labels draw one after another. The scroll's unrolled edge only ever moves left as you read on and stays just off-screen. |
| Layout | `src/main.js`, `styles.css` | Wide screens put the painting full-bleed with the text in a column that alternates sides; the subject is framed in the space left over. Narrow screens put the painting in the top half and the text below it. On a screen too short for both paragraphs, they take turns. |
| Renderer | `src/renderer.js` | WebGL 2. Draws the painting tiles, the blue-grey mount silk, the rolled part of the scroll on its rod with jade knobs, and the shadow on the table. In the same pass it draws ripples on open water (UV displacement and shimmer, limited by a water mask), mist over the countryside at the start, and the spotlight that dims and desaturates everything outside the subject. |
| Moving layer | `life/rigs.json`, `tools/make_life.py`, `src/renderer.js`, `src/birds.js` | A *rig* is a region of the painting that moves in place: `gait` (a bounce on each step, for walkers and pack animals), `rock` (a turn about a pivot, for boats and gesturing figures) or `wind` (a sway that grows with height, for trees). Each rig's outline is cut down to the brushwork inside it, so only the figure or the branches move and the bare silk stays still. Outlines listed under `still` (the Rainbow Bridge) are cut out of every rig, so the boat can rock under the bridge without dragging it along. The masks go into one atlas, and the tile shader adds up the rigs' displacement, at most 32 in view at a time. Movements grow a little when the camera is far out, so they still read. Birds are SVG over the painting, multiplied into it like ink. |
| Tiles | `src/tiles.js` | A four-level WebP pyramid (1, ½, ¼, ⅛). The two coarse levels (about 1 MB) load at start. The fine levels load where the camera is and where it is going next, and the least recently used are released. |

### Asset build

```bash
sha256sum source/Alongtheriver_QingMing.jpg   # must be ad9ccd83…6ed02950 (below)
python3 tools/make_tiles.py source/Alongtheriver_QingMing.jpg assets/tiles
python3 tools/make_masks.py assets/tiles assets # water mask, minimap; tools/water-mask-preview.png to check
python3 tools/make_life.py life/rigs.json source/Alongtheriver_QingMing.jpg assets   # rig masks and life.json
```

The scripts use Pillow. `make_tiles.py` only crops and resamples (no colour changes). Each tile is padded by 8 px
from its neighbours so the ripple shader never samples across a seam. `make_masks.py` finds open water inside two
hand-drawn outlines (the canal, the stream at the start). It keeps the smooth, low-detail parts, so boats, the bridge
and the banks stay still.

The master is not committed (`source/` is git-ignored; 19 MB). The tiles in `assets/tiles` are enough to run the page.

## The image

- **File:** `Alongtheriver_QingMing.jpg`, Wikimedia Commons, 38,414 × 1,800 px, 19,320,386 bytes,
  SHA-256 `ad9ccd836874141c985c8db89589d7f6960719eda8281966646eb41a6ed02950`.
- **Status:** a faithful reproduction of a two-dimensional public-domain work. Wikimedia Commons marks it public domain
  (PD-Art).
- **How this copy was obtained:** Wikimedia's servers were not reachable from the build machine. The identical file
  came from the GitHub repository `blueif16/qingming` (`reference/scroll/qingming_commons_38414x1800.jpg`). Its
  checksum matches the one recorded for the Commons file in `XinL123/Into-the-Painting` (`SOURCE.md`). Only the image
  was used from them; neither repository has a license, and no code or text from either is in this project.

## Text sources

The scene texts were written for this page from the sources listed in the page's *Sources* dialog
(`SOURCES` in `src/story.js`): the Palace Museum's record, Chinese press coverage of the scroll's history,
and Song-dynasty studies of Qingming customs, tavern signs, Dr. Zhao's shop and Yu Hui's reading of the
unguarded gate. Interpretations are given as readings, not facts. Distances "along the scroll" are measured from its
right end, at 72.6 px per cm of the scan.

## Adding movement

Rigs live in `life/rigs.json`, in master pixels. Give each one an outline (`box`, `ellipse` or `poly`), a `type`, a
rhythm (`hz`, `phase`) and an amount: `move: [surge, bounce]` for gait, `amp` in degrees with a `pivot` for rock
(plus `move: [drift, heave]`), `amp` in pixels with the pivot's y as the base line for wind. Then rerun
`make_life.py`. A whole boat should use `"mask": "shape"` so it moves as one piece; figures and trees default to
masks cut from their brushwork. Anything that must not move, such as a bridge in front of a moving boat, goes under
`still` as a polygon. Keep movements to a few pixels: more than that and the silk around a figure starts to
stretch.

## Changing the scenes

Edit `CHAPTERS` in `src/story.js`. A shot's `focus` is the rectangle to frame, `[x0, y0, x1, y1]` in master pixels.
Each point has a centre `at`, a radius `r` and a `label`. `dir` is the way the label should lead (it flips when there
isn't room). Scenes must stay in reading order, from high x to low x. Scroll lengths are set in `build()` in
`src/main.js`.
