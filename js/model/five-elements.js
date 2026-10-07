/**
 * Bezier Life — five elements (五行)
 * js/model/five-elements.js
 *
 * Birth date + time → day master (日主) → element → one of 4 palettes.
 *
 * Day pillar: (JDN + 49) mod 60, where 0 = 甲子.
 *   Verified: 1949-10-01 = 甲子, 2000-01-01 = 戊午.
 * From 23:00 the 子 hour belongs to the next day (common convention).
 * Stem → element: 甲乙 Wood, 丙丁 Fire, 戊己 Earth, 庚辛 Metal, 壬癸 Water.
 * Palette index = yang/yin of the day stem × born by day (卯–申, 05–17h) or night:
 *   0 yang·day, 1 yang·night, 2 yin·day, 3 yin·night.
 * Limits: uses the time as entered (no true-solar-time / timezone correction);
 * month and year pillars (solar terms 節氣) are not computed.
 *
 * Palette fields (hex strings): bg, glow, light, mid, dark, accent, paper, ink.
 */
(function (BL) {
  'use strict';

  const STEMS = '甲乙丙丁戊己庚辛壬癸',
    BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
  const ELEMENTS = [
    { zh: '木', en: 'Wood' },
    { zh: '火', en: 'Fire' },
    { zh: '土', en: 'Earth' },
    { zh: '金', en: 'Metal' },
    { zh: '水', en: 'Water' },
  ];
  /** Julian Day Number of a Gregorian date. */
  function jdn(y, m, d) {
    const a = Math.floor((14 - m) / 12),
      y2 = y + 4800 - a,
      m2 = m + 12 * a - 3;
    return (
      d +
      Math.floor((153 * m2 + 2) / 5) +
      365 * y2 +
      Math.floor(y2 / 4) -
      Math.floor(y2 / 100) +
      Math.floor(y2 / 400) -
      32045
    );
  }
  /** Date "YYYY-MM-DD" + time "HH:MM" → { element, stem, dayPillar, hour, yin, night, palette }. */
  function fiveElementReading(date, time) {
    const [y, m, d] = date.split('-').map(Number),
      [hh] = time.split(':').map(Number);
    const day = jdn(y, m, d) + (hh >= 23 ? 1 : 0),
      idx = (((day + 49) % 60) + 60) % 60,
      stem = idx % 10;
    const hb = Math.floor(((hh + 1) % 24) / 2); // 子=0 (23–01) … 亥=11
    const element = Math.floor(stem / 2),
      yin = stem % 2 === 1,
      night = !(hb >= 3 && hb <= 8);
    return {
      element,
      stem: STEMS[stem],
      dayPillar: STEMS[stem] + BRANCHES[idx % 12],
      hour: BRANCHES[hb],
      yin,
      night,
      palette: (yin ? 2 : 0) + (night ? 1 : 0),
    };
  }
  /* 4 palettes per element: [yang·day, yang·night, yin·day, yin·night]; each: background, glow, stroke light/mid/dark, accent, paper, ink */
  const PALETTES = [
    [
      // 木 Wood
      {
        zh: '春芽',
        en: 'Spring shoot',
        bg: '#DCE5C6',
        glow: '#F6F2D4',
        light: '#FBFCF2',
        mid: '#8DB255',
        dark: '#2E4A1C',
        accent: '#F2C14E',
        paper: '#F4F3E6',
        ink: '#34541F',
      },
      {
        zh: '林夜',
        en: 'Night forest',
        bg: '#142420',
        glow: '#2E4A3C',
        light: '#CFE3C2',
        mid: '#4E8A6A',
        dark: '#0B1512',
        accent: '#9BD16B',
        paper: '#E9EBE1',
        ink: '#0F2A20',
      },
      {
        zh: '青瓷',
        en: 'Celadon',
        bg: '#9FC1B5',
        glow: '#E7EFE4',
        light: '#F1F5EE',
        mid: '#5F9A8A',
        dark: '#1D4040',
        accent: '#E8A86A',
        paper: '#EDF0EA',
        ink: '#1F4A46',
      },
      {
        zh: '竹暮',
        en: 'Bamboo dusk',
        bg: '#33402F',
        glow: '#56664A',
        light: '#E2E8CF',
        mid: '#8BA578',
        dark: '#161D14',
        accent: '#D9C46A',
        paper: '#ECEDE2',
        ink: '#22301E',
      },
    ],
    [
      // 火 Fire
      {
        zh: '朱砂',
        en: 'Cinnabar',
        bg: '#E9DDD3',
        glow: '#F6E7D2',
        light: '#FBEEE3',
        mid: '#D2462E',
        dark: '#5A140E',
        accent: '#F2A541',
        paper: '#F3ECE2',
        ink: '#B8321F',
      },
      {
        zh: '炭火',
        en: 'Embers',
        bg: '#1E1A1C',
        glow: '#4A2418',
        light: '#F2C9A0',
        mid: '#C2452A',
        dark: '#120D0E',
        accent: '#FF6B2C',
        paper: '#EFE6DC',
        ink: '#2A1210',
      },
      {
        zh: '牡丹',
        en: 'Peony',
        bg: '#E8C9CF',
        glow: '#F7E6E1',
        light: '#FFF1F0',
        mid: '#C23B6A',
        dark: '#4D0F2A',
        accent: '#F08A4B',
        paper: '#F6EEEC',
        ink: '#8A1C45',
      },
      {
        zh: '晚霞',
        en: 'Dusk glow',
        bg: '#4A2433',
        glow: '#8A4A3E',
        light: '#FCE3CC',
        mid: '#D9603B',
        dark: '#26101A',
        accent: '#FFD36E',
        paper: '#F5EBE3',
        ink: '#6E1E1E',
      },
    ],
    [
      // 土 Earth
      {
        zh: '黃土',
        en: 'Loess',
        bg: '#D6C3A0',
        glow: '#F1E2C2',
        light: '#F7EEDB',
        mid: '#B08A4E',
        dark: '#4A3420',
        accent: '#8C3B23',
        paper: '#EFE7D6',
        ink: '#4A3420',
      },
      {
        zh: '赭夜',
        en: 'Ochre night',
        bg: '#2B2219',
        glow: '#4E3B22',
        light: '#EBD4A6',
        mid: '#B88A3E',
        dark: '#17110B',
        accent: '#E0B04C',
        paper: '#EEE6D6',
        ink: '#2E2216',
      },
      {
        zh: '沙丘',
        en: 'Dune',
        bg: '#E7DCC6',
        glow: '#F8EFDB',
        light: '#FFF9EC',
        mid: '#C7A26A',
        dark: '#6B5132',
        accent: '#6F8FA6',
        paper: '#F5EFE3',
        ink: '#5E4429',
      },
      {
        zh: '窯',
        en: 'Kiln',
        bg: '#4A2E22',
        glow: '#7A4A30',
        light: '#F4DFC6',
        mid: '#C0714A',
        dark: '#22140D',
        accent: '#E8C27A',
        paper: '#F2E8DC',
        ink: '#5C2E1C',
      },
    ],
    [
      // 金 Metal
      {
        zh: '白金',
        en: 'Platinum',
        bg: '#ECEBE7',
        glow: '#FFFFFF',
        light: '#FFFFFF',
        mid: '#B9B6AE',
        dark: '#4A4842',
        accent: '#A88A4E',
        paper: '#F4F3EF',
        ink: '#3C3A36',
      },
      {
        zh: '鐵',
        en: 'Iron',
        bg: '#23262B',
        glow: '#3C424A',
        light: '#D7DBE0',
        mid: '#7D858F',
        dark: '#101215',
        accent: '#C9A45C',
        paper: '#E8E8E6',
        ink: '#1A1C20',
      },
      {
        zh: '銀',
        en: 'Silver',
        bg: '#C9CCD1',
        glow: '#EEF0F2',
        light: '#F7F8FA',
        mid: '#8E949C',
        dark: '#2C3036',
        accent: '#D4B26A',
        paper: '#EFEFEC',
        ink: '#2A2D32',
      },
      {
        zh: '青銅',
        en: 'Bronze',
        bg: '#3A3226',
        glow: '#5E4E34',
        light: '#F1E2BE',
        mid: '#B8964A',
        dark: '#1A150E',
        accent: '#A9B0B8',
        paper: '#F2ECDD',
        ink: '#4C3A18',
      },
    ],
    [
      // 水 Water
      {
        zh: '靛',
        en: 'Indigo',
        bg: '#A7B1C9',
        glow: '#DCE2EE',
        light: '#EFF2F8',
        mid: '#4B5F9A',
        dark: '#18203F',
        accent: '#E3B55A',
        paper: '#EEEFF2',
        ink: '#1E2A5A',
      },
      {
        zh: '深海',
        en: 'Deep sea',
        bg: '#16243A',
        glow: '#24456B',
        light: '#CFE0F0',
        mid: '#3F6E9E',
        dark: '#0A1220',
        accent: '#7FD1D9',
        paper: '#E8ECEF',
        ink: '#13233D',
      },
      {
        zh: '墨',
        en: 'Ink wash',
        bg: '#D4D6D8',
        glow: '#EEF0F0',
        light: '#F4F5F5',
        mid: '#5E6670',
        dark: '#111418',
        accent: '#3A5A8C',
        paper: '#EFEEEA',
        ink: '#15171B',
      },
      {
        zh: '夜雨',
        en: 'Night rain',
        bg: '#1E2E35',
        glow: '#36505A',
        light: '#DCE8EA',
        mid: '#567C88',
        dark: '#0E1A1F',
        accent: '#E6C79C',
        paper: '#ECEFEE',
        ink: '#1D3740',
      },
    ],
  ];
  /** Palette object for a reading. */
  function paletteFor(reading) {
    return PALETTES[reading.element][reading.palette];
  }

  BL.fiveElements = {
    STEMS,
    BRANCHES,
    ELEMENTS,
    PALETTES,
    jdn,
    fiveElementReading,
    paletteFor,
  };
})((window.BL = window.BL || {}));
