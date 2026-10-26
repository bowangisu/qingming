# 清明上河图 · Along the River

Zhang Zeduan's handscroll *Along the River During the Qingming Festival* (Northern Song, early 12th century,
24.8 × 528.7 cm, Palace Museum, Beijing), unrolled from right to left as you scroll. The camera stops at seven scenes
along the 5.3 metres of silk. At each one it zooms in, numbered labels point out the details, and a short text explains
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

**Walk the bridge in 3D** (`world.html`, entered from the lacquered plaque in the Rainbow Bridge scene) rebuilds that scene as a small world
you can go all the way round. It opens on the painting, flat, then lifts into 3D: the bridge and the big boat are
rebuilt as simple models dressed in their own painted timbers, and so are the other boats, the houses, halls, sheds,
stalls, tables and umbrellas along both banks, from the wine shop with its pole gateway west of the bridge to the big
passenger boat being towed upstream east of it. The painting's own people, carts, horses and donkeys stand up where
they are painted: the crowd on the bridge, the street at the bridge's foot, the trackers on the far bank. The river
and the banks are the painting laid back down on the ground it shows, and you walk a porter from elsewhere on the
scroll across the deck among them.

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
| Timeline | `src/main.js` | Scroll position, in screen heights, becomes a sequence: a closed scroll, unrolling, then *fly → hold* for every shot, and a last flight out to the whole scroll, then the roll-up (the camera follows the roll back to the start and closes in) and the closing notes, which appear one at a time. Flights use van Wijk & Nuij's smooth zoom (2003), which pulls back in proportion to the distance travelled. During a hold the camera pushes in slightly while the numbered labels appear one after another, each with a leader line that ends in a small dot on its subject. The scroll's unrolled edge only ever moves left as you read on and stays just off-screen. |
| Layout | `src/main.js`, `styles.css` | Wide screens put the painting full-bleed with the text in a column that alternates sides; the subject is framed in the space left over. Narrow screens put the painting in the top half and the text below it. On a screen too short for both paragraphs, they take turns. |
| Renderer | `src/renderer.js` | WebGL 2. Draws the painting tiles, the blue-grey mount silk, the rolled part of the scroll on its rod with jade knobs, and the shadow on the table. In the same pass it draws ripples on open water (UV displacement and shimmer, limited by a water mask), mist over the countryside at the start, and the spotlight that dims and desaturates everything outside the subject. |
| Moving layer | `life/rigs.json`, `tools/make_life.py`, `src/renderer.js`, `src/birds.js` | A *rig* is a region of the painting that moves in place: `gait` (a bounce on each step, for walkers and pack animals), `rock` (a turn about a pivot, for boats and gesturing figures) or `wind` (a sway that grows with height, for trees). Each rig's outline is cut down to the brushwork inside it, so only the figure or the branches move and the bare silk stays still. Outlines listed under `still` (the Rainbow Bridge) are cut out of every rig, so the boat can rock under the bridge without dragging it along. The masks go into one atlas, and the tile shader adds up the rigs' displacement, at most 32 in view at a time. Movements grow a little when the camera is far out, so they still read. Birds are SVG over the painting, multiplied into it like ink. |
| Tiles | `src/tiles.js` | A four-level WebP pyramid (1, ½, ¼, ⅛). The two coarse levels (about 1 MB) load at start. The fine levels load where the camera is and where it is going next, and the least recently used are released. |

### The bridge in 3D

The painting is read as an oblique view of a small world: X along the scroll, Y up, Z away from the painter, the river
at Y = 0 and the banks raised to Y = 110. A point (X, Y, Z) is painted at *u* = X + 0.7·Z, *v* = 1300 − 0.5·Z − Y
(master px). That one formula does most of the work:

- **The ground is the painting.** The river, the banks and their timber revetments have no texture of their own. Each
  fragment looks up the painting at its own painted position, so from the painter's direction the ground is the scroll
  exactly, with no cut edges anywhere, and from any other direction it is still the same continuous silk.
- **Gaps are filled from the painting.** Where the painting shows something that is rebuilt (the bridge, the boat) or
  a strip it never shows (the water behind a bank), the ground uses the painting's own blank water or silk instead,
  in the tone of the painting around it. `tools/make_world.py` writes masks for what is open water and what is land,
  and those tones.
- **Standing things fade from the side.** Houses, crowds and trees on the banks are only painted on the ground, so
  seen from far round the side they would lie flat. There they fade toward blank silk, and everything dissolves into
  mist beyond the painting's edges and a short way from the bridge.
- **The bridge** is a designed, symmetric arch between two feet on the river's edge. Its deck lands on both banks. Its
  faces are the painted bridge, stretched between the painted curves: the railing along the painted rail, the face
  between the painted deck line and the arch. The far side wears the near side, as a symmetric bridge would. The deck is
  planks on the silk's weave; the underside is the rafters painted under the arch. The painted right end, hidden
  behind the boat's mast, takes the left end's timbers.
- **The boat** stands on its painted waterline with the painted gunwale above it; a deck, a cabin with a rounded roof
  and a mast with its stays sit on top. Every vertex carries the painting pixel it shows. On the side the painter saw,
  that is the pixel it is painted at. On the far side, which he never saw, it is the matching pixel on the near side,
  mirrored. It rocks slowly.
- **The scene** covers x 16,400–22,800 of the scroll, its full height, read as the painting in two halves (so each
  texture stays within what phones hold) with masks for open water and land beside it.
- **Houses, sheds, awnings and umbrellas** (`tools/world_models.py`) are simple shapes fitted over the painted ones by
  eye: a house is a front wall's two painted corners, a depth, a wall height and a hip, gable or shed roof; a *traced*
  building is its painted roof's eave corners and ridge ends, at an eave and ridge height, with walls or corner posts
  under it (the big near-bank halls, the wine shop and its gate); an awning or a table is four painted corners on
  poles; an umbrella is a painted centre and radius. Every vertex shows the painting where
  the painter could see that face and the opposite face, mirrored, where he could not; posts show the painted post
  they stand in front of. They were placed by drawing each model's edges over the scan and adjusting by eye.
- **More boats** use the big boat's builder: a painted waterline and gunwale, a beam, an optional cabin, a slow rock.
- **The painting's own people** are cut out where they stand. For each group the spec lists head centres; each figure
  takes the brushwork inside a rough figure shape below its head (the nearer of two figures keeps what they share),
  and where the painting hides its legs (behind the railing, behind people in front) its robe is carried down to its
  feet with a hem and shoes drawn in the painting's ink. On the bridge each stands behind the front railing, as far
  back across the deck as it is painted above the rail.
- **Willows, carts, horses, donkeys, a sedan chair and the wine shop's pole gateway** are cut-outs that turn to face
  you, standing at their painted foot: carts and animals cut along their outline, willows and the gateway along their
  strokes (how much darker than the silk each pixel is, so thin lines stay whole). Willows sway; animals shift.
- **Walkers** turn to face you: the porter from the street outside Dr. Zhao's shop (x ≈ 1150–1375, y ≈ 1055–1250),
  in three pieces so his baskets swing, and seven walkers traced from other scenes. Every cut-out's colours are scaled
  so the silk round it matches the scene's silk, so no pale halo shows. Seen as painted, cut-outs stand flat across
  the scroll; as the camera frees they turn to face it.
- **Moving through it:** some of the painting's own figures walk (life/world-bridge.json, `walks`): the donkey, the
  loaded horse, the sedan chair and its bearer, two porters and the two carts head down the street, each a set
  distance before fading and coming round again, and mirror themselves so they never walk backwards on screen. The
  carts' wheels are cut out separately and turn as far as the cart rolls. The trackers lean into their towline a
  step at a time and their boat surges against it. Seen as painted, everyone stands exactly where the painter put
  them: the walking grows as the scene lifts.
- **The near miss** (*Watch the near miss*, or by itself the first time the porter reaches the crown): the big boat
  swings in toward the arch with its mast up; the crew lower it and brace two poles against the arch, the bow recoils,
  someone lets a rope down from the deck and the crowd at the railing leans out. It ends exactly as painted.
  Captions tell it; the Watch button also flies the camera through it, low on the water, under the arch and along the
  railing. Dragging takes the camera back.
- **Reflections, shadows, outlines:** everything standing is drawn a second time, mirrored in the water's plane, at
  half size; the river samples that picture, broken up by its ripples. Soft shadows sit under every figure, cart,
  stall, building and boat, and under the arch. Thin ink lines, a ribbon the vertex shader widens to a pixel or so
  on screen with a wavering weight, follow the edges of everything rebuilt (roofs, eaves, walls, gunwales, the
  bridge's rails and arch), so its invented sides read as brushwork. None of it shows while the scene is flat.
- **Sound** (off until *Sound* is pressed; all synthesized with Web Audio, nothing recorded): the river as filtered
  noise with a slow swell, crowd talk where the crowds are (murmuring voices made of a buzz and a breath through two
  formant filters, spoken in random syllables), creaking hulls, and in the near miss the mast's groan, the poles'
  thud, the rope's whistle and shouts from the deck. Every source has a place in the world and is heard from the
  camera.
- **Points of interest:** seals on the bridge, the big boat, the stalls on the deck, the wine shop, the trackers and
  a restaurant open notes. The notes quote Meng Yuanlao's memoir of Kaifeng, 东京梦华录 (1147), where it has
  something to say, describe what the painting shows where it does not, and link back to the scroll's scenes.
- **Walking:** the porter goes anywhere the ground allows near the bridge: up the deck between its railings, down
  the ramps and about both banks, within about 1,700 units of the bridge and inside the painting's edges. The river
  and the enclosed buildings and stall tables stop him (he slides along them); open sheds and teahouses he can walk
  into. The arrow keys or WASD steer him in the screen's directions whichever way the camera faces, Shift hurries
  him, the lacquer pad does the same by touch, and a tap or click on the ground walks him there (the tap is traced
  down the camera's ray to the first surface under it, deck or bank). A small map shows the river, the bridge, the
  buildings, him and which way the camera looks.
- **Camera:** it opens on the painting through a very long lens far off along the painter's own line of sight, with a
  shear that turns its picture into the scroll's oblique one. Then it lifts into an ordinary perspective camera that
  follows the porter. Drag to go round (all the way), wheel or pinch to come closer.

```bash
python3 tools/make_world.py life/world-bridge.json source/Alongtheriver_QingMing.jpg assets/world/bridge
```

The spec, `life/world-bridge.json`, holds the mapping, the river's outline in world coordinates, the painted
outline of open water, the bridge's design and its painted curves, the boat's painted waterline and gunwale, and the
people's outlines. The bake also writes `tools/world-masks-preview.png` (blue: open water, orange: land) for checking.

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
Each point has a centre `at`, a rough size `r` (the leader line starts just inside it) and a `label`. `dir` is the way the label should lead (it flips when there
isn't room). Scenes must stay in reading order, from high x to low x. Scroll lengths are set in `build()` in
`src/main.js`.
