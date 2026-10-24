// The journey through the scroll, in reading order (right to left). All coordinates are master-scan pixels
// (Wikimedia Commons "Alongtheriver_QingMing.jpg", 38,414 × 1,800): x = 0 is the scan's left edge, the city end; the
// scroll starts at high x. Positions were read off full-resolution crops of the scan.
//
// shot.focus: the rectangle the camera frames [x0, y0, x1, y1]; shot.points: details circled in cinnabar (centre `at`,
// radius `r`) and marked with a numbered seal and a short label that leads off in direction `dir`. side: where the
// text column sits on wide screens (the subject is framed on the other side).
export const SCROLL = {
  width: 38414, height: 1800,
  cm: [24.8, 528.7],             // the painting's size; the scan covers all of it (38,414 / 1,800 ≈ 528.7 / 24.8)
};

export const INTRO = {
  zh: '清明上河图',
  en: 'Along the River During the Qingming Festival',
  meta: ['Zhang Zeduan 张择端', 'Northern Song, early 12th century', 'Ink and colour on silk, 24.8 × 528.7 cm', 'Palace Museum, Beijing'],
  hint: 'A handscroll is read from right to left, a little at a time. Scroll to unroll it.',
};

export const CHAPTERS = [
  {
    id: 'road', num: '一', zh: '开卷 · 驮炭驴队', en: 'The road into town', side: 'left',
    body: [
      'The scroll opens on the quiet edge of the city: bare trees, mist over the fields, a plank bridge over a stream.',
      'Two men drive a string of donkeys loaded with charcoal along the path toward town, the same way the whole scroll will travel.',
    ],
    shots: [{ focus: [36180, 560, 37000, 1130], points: [
      { at: [36600, 860], r: 120, label: 'Donkeys loaded with charcoal', dir: [-1, -1] },
      { at: [36420, 1050], r: 80, label: 'A plank bridge on stilts', dir: [-1, 1] },
    ] }],
  },
  {
    id: 'willow', num: '二', zh: '清明 · 插柳', en: 'Willow for Qingming', side: 'right',
    body: [
      'A sedan chair comes down the path with willow branches and flowers tied to its roof, led by a rider and followed by porters with their loads.',
      'Putting up willow was a Qingming custom, and many readers take this party to be returning from sweeping the family graves: one of the clearest links to the festival in the title.',
    ],
    shots: [{ focus: [30700, 170, 31250, 740], points: [
      { at: [30893, 430], r: 75, label: 'Willow and flowers on the roof', dir: [1, 1] },
      { at: [30990, 285], r: 60, label: 'A rider leads the party', dir: [1, -1] },
    ] }],
  },
  {
    id: 'grain', num: '三', zh: '汴河 · 卸粮', en: 'Grain on the Bian River', side: 'left',
    body: [
      'Here the countryside gives way to the canal. In the Northern Song the Bian River was the main route carrying grain from the south to the capital, Kaifeng.',
      'Two deep-laden boats are moored at the bank, and porters carry sacks ashore to a man seated on the pile.',
    ],
    shots: [{ focus: [27250, 640, 28850, 1720], points: [
      { at: [28187, 860], r: 130, label: 'Porters with grain sacks', dir: [1, -1] },
      { at: [27640, 1320], r: 250, label: 'Moored grain boats', dir: [-1, 1] },
    ] }],
  },
  {
    id: 'bridge', num: '四', zh: '虹桥 · 船过桥', en: 'Under the Rainbow Bridge', side: 'right',
    body: [
      'The most crowded moment of the scroll, near its middle. A large boat swings toward the arched timber bridge with its mast not yet fully down, and the crew rushes to lower it.',
      'On the bridge, stalls and passers-by fill the deck, and many lean over the rail to watch.',
    ],
    shots: [
      { focus: [18700, 90, 20650, 1100], points: [
        { at: [19330, 260], r: 90, label: 'Onlookers at the rail', dir: [-1, -1] },
        { at: [20180, 300], r: 120, label: 'The mast coming down', dir: [1, -1] },
      ] },
      { focus: [19480, 110, 20520, 840], points: [
        { at: [19720, 540], r: 120, label: 'Crew poling the bow away', dir: [-1, 1] },
        { at: [20180, 300], r: 120, label: 'The mast coming down', dir: [1, -1] },
      ] },
    ],
  },
  {
    id: 'gate', num: '五', zh: '城门 · 驼队', en: 'Through the city gate', side: 'left',
    body: [
      'The road reaches the city wall. A tall gate tower stands over the gateway, and a camel caravan is passing through.',
      'No soldiers seem to be on guard. The Palace Museum scholar Yu Hui reads the open, unguarded gate as one of the picture’s quiet warnings; others see simply a city at peace.',
    ],
    shots: [{ focus: [6380, 0, 8150, 1480], points: [
      { at: [7420, 1190], r: 100, label: 'A camel caravan', dir: [1, 1] },
      { at: [7000, 330], r: 320, label: 'The gate tower', dir: [1, -1] },
    ] }],
  },
  {
    id: 'tavern', num: '六', zh: '孙羊正店', en: 'The Sun family tavern', side: 'right',
    body: [
      'Inside the walls the street is full of shoppers, porters and sedan chairs. The largest building is the Sun family’s licensed tavern, a 正店 or “main shop”, behind a gateway of poles dressed with flowers.',
      'Its lamp-box signs held candles to glow at night. Licensed taverns brewed their own wine and sold it on to smaller inns.',
    ],
    shots: [{ focus: [3560, 170, 5560, 1480], points: [
      { at: [4515, 845], r: 70, label: 'The 正店 lamp-box sign', dir: [-1, 1] },
      { at: [4880, 400], r: 250, label: 'The decorated gateway', dir: [1, -1] },
      { at: [3780, 860], r: 150, label: 'A crowd around a storyteller', dir: [-1, -1] },
    ] }],
  },
  {
    id: 'end', num: '七', zh: '卷尾 · 赵太丞家', en: 'Dr. Zhao’s shop', side: 'left',
    body: [
      'Near the end stands a doctor’s shop, 赵太丞家, “the house of Zhao, court physician”. The tall board by its door advertises 集香丸, pills “truly prescribed for harm done by wine”; two women with a child stand inside.',
      'A few steps further the painting simply stops. Several scholars have suspected that the scroll was cut short here.',
    ],
    shots: [{ focus: [1180, 470, 2420, 1250], points: [
      { at: [1605, 632], r: 130, label: '赵太丞家 — the shop sign', dir: [1, -1] },
      { at: [1400, 830], r: 75, label: 'The remedy signboard', dir: [-1, 1] },
      { at: [2118, 930], r: 140, label: 'A square well', dir: [1, 1] },
    ] }],
  },
];

export const OUTRO = {
  zh: '卷终',
  en: 'The whole scroll',
  body: [
    'Hundreds of people, with their animals, boats, carts and sedans. Counts run from about 500 to more than 800, depending on who counts and how.',
    'Image: the Palace Museum scroll, from a public-domain scan on Wikimedia Commons.',
  ],
};

export const SOURCES = [
  ['Along the River During the Qingming Festival — Wikipedia', 'https://en.wikipedia.org/wiki/Along_the_River_During_the_Qingming_Festival'],
  ['File:Alongtheriver QingMing.jpg — Wikimedia Commons (public domain scan)', 'https://commons.wikimedia.org/wiki/File:Alongtheriver_QingMing.jpg'],
  ['Palace Museum, Beijing — collection record', 'https://www.dpm.org.cn/collection/paint/228226.html'],
  ['China News Service, 20 September 2015 (size, collection history)', 'https://www.chinanews.com.cn/m/cul/2015/09-20/7533665.shtml'],
  ['People’s Daily Overseas Edition, 14 February 2014', 'https://paper.people.com.cn/rmrbhwb/html/2014-02/14/content_1390784.htm'],
  ['The Bian River — Harvard “China Local” collection', 'https://chinalocal.omeka.fas.harvard.edu/items/show/1058'],
  ['宋代清明的民俗雅韵：柳风拂冢 春郊踏歌 — Beijing Daily, 2026', 'https://news.bjd.com.cn/2026/03/31/11662244.shtml'],
  ['吴钩：小市酒旗能唤客——宋朝的广告与商标 — rujiazg.com', 'https://www.rujiazg.com/article/3505'],
  ['On 赵太丞家 and Song medicine — rujiazg.com', 'https://www.rujiazg.com/article/18407'],
  ['On Yu Hui’s reading of the unguarded gate — The Paper (澎湃新闻)', 'https://www.thepaper.cn/newsDetail_forward_23508581'],
];
