// The journey through the scroll, in reading order (right to left). All coordinates are master-scan pixels
// (Wikimedia Commons "Alongtheriver_QingMing.jpg", 38,414 × 1,800): x = 0 is the scan's left edge, the city end; the
// scroll starts at high x. Positions were read off full-resolution crops of the scan.
//
// shot.focus: the rectangle the camera frames [x0, y0, x1, y1]; shot.points: details marked with a numbered seal and a
// short label whose leader line points at the subject (centre `at`, rough size `r`) and leads off in direction `dir`. side: where the
// text column sits on wide screens (the subject is framed on the other side). walk: a link into the scene's
// 3D view, where there is one.
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
      { at: [36478, 838], r: 55, label: 'Donkeys loaded with charcoal', dir: [-1, -1] },
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
    walk: { href: 'world.html', label: 'Walk the bridge in 3D', zh: '步上虹桥', seal: '入画' },   // the scene rebuilt in 3D
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
      { at: [7462, 1212], r: 95, label: 'A camel caravan', dir: [1, 1] },
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
  zh: '全卷',
  en: 'The whole scroll',
  body: ['Seven scenes along 528.7 cm of silk; the seals mark where each one sits.'],
  hint: 'Keep scrolling to roll it back up.',
};

// After the whole scroll, it rolls back up and these notes close the reading.
export const CLOSING = {
  zh: '卷终',
  en: 'Rolled up again',
  notes: [
    { title: 'A day in five metres', body: 'In 528.7 centimetres the scroll walks from quiet fields, past the grain boats and the Rainbow Bridge, through the city gate and into the streets. Counts of the people in it run from about 500 to more than 800. Its subject is not an event but an ordinary day.' },
    { title: 'Spring or autumn?', body: 'The traditional reading takes 清明 as the spring festival, and the willow on the sedan chair supports it. In 1981 Kong Xianyi argued for autumn instead, pointing to the charcoal coming into town and taverns selling new wine. Others read 清明 as a ward of Kaifeng, or as praise of a well-governed age. The question is still open.' },
    { title: 'Prosperity or warning?', body: 'Most viewers see a capital at its height. Yu Hui of the Palace Museum also reads worries in it: the boat about to strike the bridge, the slack defences at the gate and, near the end, people consulting a doctor and a fortune-teller. Kaifeng fell to the Jurchen Jin in 1127, within a generation of the painting.' },
    { title: 'The scroll’s own journey', body: 'A handscroll is made to be rolled up and carried, and this one passed through imperial and private hands for eight centuries. Puyi, the last emperor, took it out of the Forbidden City; after his state in Manchuria collapsed in 1945 it lay unrecognised among the paintings he left behind. Yang Renkai identified it in 1950. Back in the Palace Museum, it is unrolled only rarely: in 2025 it went on show for the first time in ten years.' },
  ],
  coda: 'Its crowds have been animated before: the China Pavilion at the 2010 Shanghai Expo showed a 128-metre moving version. Here they move more quietly, with the painting’s own brushwork nudged a few pixels at a time.',
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
  ['Yu Hui on the painting’s hidden worries — China News Service “东西问”, 2 January 2025', 'https://www.chinanews.com.cn/dxw/2025/01-02/10346759.shtml'],
  ['On the season and the meaning of 清明, and Kong Xianyi’s autumn reading — The Paper (澎湃新闻)', 'https://www.thepaper.cn/newsDetail_forward_1317282'],
  ['On Yang Renkai identifying the scroll — 中国作家网, 2024', 'https://www.chinawriter.com.cn/n1/2024/1217/c419382-40383569.html'],
  ['Tsuji, on the Beijing scroll’s discovery (1950) and first display (1953) — Journal of Global Studies, Doshisha University', 'https://global-studies.doshisha.ac.jp/file/JGSvol.14%20(8Tsuji).pdf'],
  ['On the 2025 display, the first in ten years — China Daily, 30 September 2025', 'https://global.chinadaily.com.cn/a/202509/30/WS68db150da310f735438b3095.html'],
  ['China pavilion at Expo 2010 — Wikipedia', 'https://en.wikipedia.org/wiki/China_pavilion_at_Expo_2010'],
  ['Jingkang incident (the fall of Kaifeng, 1127) — Wikipedia', 'https://en.wikipedia.org/wiki/Jingkang_incident'],
];
