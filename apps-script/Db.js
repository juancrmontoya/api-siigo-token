/**
 * Capa de acceso a datos sobre Google Sheets (cada hoja = una tabla, fila 1 = encabezados).
 */
const Db = {
  sheet(ss, name) {
    const sh = ss.getSheetByName(name);
    if (!sh) throw new Error('Tabla no encontrada: ' + name);
    return sh;
  },

  headers(sh) {
    return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  },

  all(ss, name) {
    const sh = this.sheet(ss, name);
    const values = sh.getDataRange().getValues();
    const h = values.shift() || [];
    const out = [];
    values.forEach((r, i) => {
      if (r.join('') === '') return;
      const o = { _row: i + 2 };
      h.forEach((k, j) => { o[k] = r[j]; });
      out.push(o);
    });
    return out;
  },

  find(ss, name, key, val) {
    return this.all(ss, name).find(r => String(r[key]) === String(val)) || null;
  },

  insert(ss, name, obj) {
    this.insertMany(ss, name, [obj]);
  },

  insertMany(ss, name, objs) {
    if (!objs || !objs.length) return;
    const sh = this.sheet(ss, name);
    const h = this.headers(sh);
    const rows = objs.map(o => h.map(k => safeCell_(o[k])));
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, h.length).setValues(rows);
  },

  update(ss, name, row, obj) {
    const sh = this.sheet(ss, name);
    const h = this.headers(sh);
    const rng = sh.getRange(row, 1, 1, h.length);
    const cur = rng.getValues()[0];
    h.forEach((k, j) => { if (obj[k] !== undefined) cur[j] = safeCell_(obj[k]); });
    rng.setValues([cur]);
  },

  remove(ss, name, row) {
    this.sheet(ss, name).deleteRow(row);
  },

  /** Crea hojas y encabezados faltantes (idempotente). */
  ensureSchema(ss, schema) {
    Object.keys(schema).forEach(name => {
      let sh = ss.getSheetByName(name);
      if (!sh) sh = ss.insertSheet(name);
      const cols = schema[name];
      const current = sh.getLastColumn() ? this.headers(sh) : [];
      const missing = cols.filter(c => current.indexOf(c) === -1);
      if (!current.length || current.join('') === '') {
        sh.getRange(1, 1, 1, cols.length).setValues([cols]);
      } else if (missing.length) {
        sh.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
      }
      sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#e2e8f0');
      sh.setFrozenRows(1);
    });
    ['Hoja 1', 'Sheet1', 'Hoja1'].forEach(n => {
      const s = ss.getSheetByName(n);
      if (s && ss.getSheets().length > 1) ss.deleteSheet(s);
    });
  },
};

/**
 * Evita inyección de fórmulas (=, +, -, @) y que Sheets convierta
 * teléfonos/NIT a números (pérdida de ceros o del signo +).
 */
function safeCell_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' && (/^[=+\-@]/.test(v) || /^0\d+$/.test(v) || /^\d{7,}$/.test(v))) return "'" + v;
  return v;
}

/** Convierte a objetos serializables por google.script.run (sin Date ni campos internos). */
function plain_(o) {
  if (o instanceof Date) return isNaN(o) ? '' : o.toISOString();
  if (Array.isArray(o)) return o.map(plain_);
  if (o && typeof o === 'object') {
    const r = {};
    Object.keys(o).forEach(k => {
      if (k === '_row' || k === 'hash' || k === 'salt') return;
      r[k] = plain_(o[k]);
    });
    return r;
  }
  return o;
}

function ahora_() { return new Date(); }

function fechaStr_(d, tz) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return '';
  return Utilities.formatDate(dt, tz || APP.ZONA_HORARIA, 'yyyy-MM-dd');
}

function num_(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function str_(v, max) {
  return String(v === undefined || v === null ? '' : v).trim().slice(0, max || 500);
}

function esEmail_(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || ''));
}

function id_(prefijo) {
  return (prefijo || '') + Utilities.getUuid().replace(/-/g, '').slice(0, 12).toUpperCase();
}

function tokenCorto_(n) {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Math.random());
  let s = '';
  for (let i = 0; i < (n || 10); i++) s += chars[(bytes[i] + 256) % chars.length];
  return s;
}

function money_(v) {
  return '$' + Math.round(num_(v)).toLocaleString('es-CO').replace(/,/g, '.');
}

function escHtml_(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
