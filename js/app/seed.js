/**
 * Bezier Life — visitor inputs → seed
 * js/app/seed.js
 *
 * BACKEND NOTE — the seed is reproducible anywhere:
 *   seedString = `${name}|${YYYYMMDD}|${HHMM}`   (name: trimmed, single spaces, Unicode NFC)
 *   master     = SHA-256(seedString) as lowercase hex
 *   code       = 'BL-' + master.slice(0, 10)       (shareable; does not reveal the birthday)
 * Node:   crypto.createHash('sha256').update(seedString, 'utf8').digest('hex')
 * Python: hashlib.sha256(seed_string.encode('utf-8')).hexdigest()
 * A backend only needs to store `master` (plus format/style/φ) to recreate a piece:
 * pass it to BL.piece.buildPiece(master, reading). Keep the five-element reading
 * (or the date/time) too, since the palette comes from the birth moment.
 *
 * randomMoment() is the ONLY non-deterministic code in the app ("A life A moment").
 * It just produces inputs; the piece is then built from them like any typed input.
 */
(function (BL) {
  'use strict';
  const { sha256Hex } = BL.random;
  const { fiveElementReading } = BL.fiveElements;

  /** Normalize a name so the same person always gets the same seed. */
  const normName = (s) => s.trim().replace(/\s+/g, ' ').normalize('NFC');

  /**
   * Check visitor inputs. Returns an error message or null.
   * @param {{name:string, date:string, time:string}} i  date 'YYYY-MM-DD', time 'HH:MM'
   */
  function validate(i) {
    if (!normName(i.name || '')) return 'Add a name to generate.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i.date || '')) return 'Add a birth date.';
    if (!/^\d{2}:\d{2}$/.test(i.time || '')) return 'Add a birth time.';
    return null;
  }

  /** The exact string that is hashed. */
  const seedString = (i) => [normName(i.name), i.date.replace(/-/g, ''), i.time.replace(':', '')].join('|');

  /**
   * Inputs → { inputs, seedString, master, code, reading }.
   * @returns {Promise<object>}
   */
  async function createSeed(i) {
    const inputs = { name: normName(i.name), date: i.date, time: i.time };
    const str = seedString(inputs);
    const master = await sha256Hex(str);
    return {
      inputs,
      seedString: str,
      master,
      code: 'BL-' + master.slice(0, 10),
      reading: fiveElementReading(i.date, i.time),
    };
  }

  // ---- "A life A moment" -------------------------------------------------------------
  const NAMES = [
    '林怡君',
    '陳志明',
    '王雅婷',
    '張家豪',
    '李淑芬',
    '黃建宏',
    '吳佳穎',
    '劉冠廷',
    '蔡宜蓁',
    '許承恩',
    'Ada Lindqvist',
    'Mateo Rivera',
    'Ingrid Holm',
    'Kofi Mensah',
    'Yuki Tanaka',
    'Elena Petrova',
    'Noor Haddad',
    'Rafael Costa',
    'Amara Obi',
    'Theo Laurent',
  ];
  const crand = () => {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] / 4294967296;
  };
  const pad = (n) => String(n).padStart(2, '0');

  /** A random name, a date between 1930 and today, and a time of day. */
  function randomMoment() {
    const t0 = Date.UTC(1930, 0, 1),
      t1 = Date.now();
    return {
      name: NAMES[Math.floor(crand() * NAMES.length)],
      date: new Date(t0 + crand() * (t1 - t0)).toISOString().slice(0, 10),
      time: pad(Math.floor(crand() * 24)) + ':' + pad(Math.floor(crand() * 60)),
    };
  }

  BL.seed = { normName, validate, seedString, createSeed, randomMoment, NAMES };
})((window.BL = window.BL || {}));
