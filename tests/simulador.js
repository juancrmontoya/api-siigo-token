/**
 * Simulador local de los servicios de Google Apps Script para probar la lógica del servidor
 * sin desplegar. Uso:  node tests/simulador.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

/* ---------------- Mocks ---------------- */
const spreadsheets = {};
const mails = [];
let seq = 0;
const nid = p => p + (++seq);

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sh.data[this.r - 1 + i] || [];
      const o = [];
      for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; o.push(v === undefined ? '' : v); }
      out.push(o);
    }
    return out;
  }
  setValues(vals) {
    vals.forEach((row, i) => {
      const ri = this.r - 1 + i;
      while (this.sh.data.length <= ri) this.sh.data.push([]);
      row.forEach((v, j) => { this.sh.data[ri][this.c - 1 + j] = typeof v === 'string' && v[0] === "'" ? v.slice(1) : v; });
    });
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setFontWeight() { return this; }
  setBackground() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.data = []; }
  getLastRow() { return this.data.length; }
  getLastColumn() { return this.data.reduce((m, r) => Math.max(m, r.length), 0); }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr || 1, nc || 1); }
  getDataRange() { return new Range(this, 1, 1, this.getLastRow(), this.getLastColumn()); }
  deleteRow(r) { this.data.splice(r - 1, 1); }
  setFrozenRows() {}
}
class Spreadsheet {
  constructor(name) { this.id = nid('SS'); this.name = name; this.sheets = { 'Hoja 1': new Sheet('Hoja 1') }; spreadsheets[this.id] = this; }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { return (this.sheets[n] = new Sheet(n)); }
  getSheets() { return Object.values(this.sheets); }
  deleteSheet(s) { delete this.sheets[s.name]; }
  setSpreadsheetTimeZone() {}
}
const cacheStore = {};
const mkFile = id => ({ getId: () => id, moveTo() {}, setTrashed() {}, setSharing() {}, getParents: () => { let d = false; return { hasNext: () => !d, next: () => { d = true; return mkFolder(nid('F')); } }; } });
const mkFolder = id => ({ getId: () => id, createFolder: () => mkFolder(nid('F')), createFile: () => mkFile(nid('FILE')) });
const propsStore = {};

const ctx = {
  console,
  SpreadsheetApp: { create: n => new Spreadsheet(n), openById: id => { if (!spreadsheets[id]) throw new Error('no ss ' + id); return spreadsheets[id]; } },
  CacheService: { getScriptCache: () => ({
    get: k => (k in cacheStore ? cacheStore[k] : null), put: (k, v) => { cacheStore[k] = String(v); },
    remove: k => { delete cacheStore[k]; }, removeAll: ks => ks.forEach(k => delete cacheStore[k]),
  }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => propsStore[k] || null, setProperty: (k, v) => { propsStore[k] = v; }, setProperties: o => Object.assign(propsStore, o),
  }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
    base64Encode: b => Buffer.from(b.map(x => (x + 256) % 256)).toString('base64'),
    base64Decode: s => Array.from(Buffer.from(s, 'base64')),
    getUuid: () => crypto.randomUUID(),
    newBlob: () => ({}),
    formatDate: (d, tz, f) => {
      const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(d));
      const g = t => p.find(x => x.type === t).value;
      return f.replace('yyyy', g('year')).replace('MM', g('month')).replace('dd', g('day'));
    },
  },
  DriveApp: { createFolder: () => mkFolder(nid('F')), getFolderById: id => mkFolder(id), getFileById: id => mkFile(id), Access: {}, Permission: {} },
  MailApp: { sendEmail: o => mails.push(o), getRemainingDailyQuota: () => 100 },
  ScriptApp: {
    getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }),
    getProjectTriggers: () => [], deleteTrigger() {},
    newTrigger: () => { const c = { timeBased: () => c, everyDays: () => c, atHour: () => c, inTimezone: () => c, create: () => c }; return c; },
  },
  Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@test.com' }) },
};
vm.createContext(ctx);
const dir = path.join(__dirname, '..', 'apps-script');
fs.readdirSync(dir).filter(f => f.endsWith('.js')).forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
const run = code => vm.runInContext(code, ctx);

/* ---------------- Pruebas ---------------- */
let ok = 0;
function test(nombre, fn) {
  try { fn(); ok++; console.log('  ✓ ' + nombre); } catch (e) { console.error('  ✗ ' + nombre + '\n    ' + e.stack); process.exitCode = 1; }
}
const throws = (fn, re) => assert.throws(fn, e => re.test(e.message), 'esperaba error ' + re);

run("INSTALACION.SUPER_EMAIL = 'super@test.com'");
test('instalar sobre una hoja existente (solo MASTER_ID) crea tablas y carpeta', () => {
  const existente = ctx.SpreadsheetApp.create('Data_microapp');
  propsStore.MASTER_ID = existente.getId();
  run('instalar()');
  assert.ok(propsStore.FOLDER_ID);
  assert.equal(run("Db.all(master_(), 'Planes').length"), 3);
  assert.ok(!existente.getSheetByName('Hoja 1'));
  run('instalar()'); // idempotente
  assert.equal(run("Db.all(master_(), 'Planes').length"), 3);
});
let demo;
test('crear empresa demo con productos', () => {
  demo = run('crearEmpresaDemo()');
  assert.equal(demo.slug, 'demo');
  assert.ok(mails.some(m => /Bienvenido/.test(m.subject)));
});
test('slug duplicado es rechazado', () => throws(() => run("aprovisionarEmpresa_({nombre:'Otra',slug:'demo',emailAdmin:'a@b.co'})"), /ya está en uso/));

let token;
test('login empresa (clave errónea falla, correcta funciona)', () => {
  throws(() => run("loginEmpresa('demo','super@test.com','mala')"), /incorrectos/);
  token = run("loginEmpresa('demo','super@test.com','Demo12345')").token;
  assert.ok(token);
});
const admin = (a, d) => ctx.apiAdmin(token, a, d || {});
const pub = (a, d) => ctx.apiPublica(a, d || {});

let cat;
test('catálogo público', () => {
  cat = pub('catalogo', { slug: 'demo' });
  assert.equal(cat.productos.length, 3);
});
const prod = n => cat.productos.find(p => p.nombre.indexOf(n) === 0);

let ped;
test('crear pedido a domicilio calcula envío (excluido + personalizado)', () => {
  const items = [{ productoId: prod('Café').id, cantidad: 2 }, { productoId: prod('Aceite').id, cantidad: 1 }];
  throws(() => pub('crearPedido', { slug: 'demo', items, cliente: { nombre: 'Ana Pérez', telefono: '3001112233', entregaTipo: 'DOMICILIO', direccion: 'Cra 1 # 2-3' }, totalEsperado: 1 }), /precios cambiaron/);
  ped = pub('crearPedido', { slug: 'demo', items, cliente: { nombre: 'Ana Pérez', telefono: '3001112233', email: 'ana@test.com', entregaTipo: 'DOMICILIO', direccion: 'Cra 1 # 2-3' }, totalEsperado: 77400 });
  assert.equal(ped.subtotal, 69900);
  assert.equal(ped.envio, 7500); // 1.500 personalizado + 6.000 tarifa domicilio
  assert.equal(ped.total, 77400);
  assert.equal(ped.id, 'P-000001');
  assert.ok(mails.some(m => m.to === 'ana@test.com' && /P-000001/.test(m.subject)));
});
test('recoger en punto: envío 0; teléfono conserva formato texto', () => {
  const p = pub('crearPedido', { slug: 'demo', items: [{ productoId: prod('Arroz').id, cantidad: 3 }], cliente: { nombre: 'Luis Gómez', telefono: '0312345678', entregaTipo: 'RECOGE' } });
  assert.equal(p.envio, 0);
  assert.equal(p.id, 'P-000002');
  const tel = run("Db.find(ssEmpresa_(empresaPorSlug_('demo')),'Pedidos','id','P-000002').telefono");
  assert.strictEqual(tel, '0312345678');
});
test('envío gratis desde 150.000', () => {
  const p = pub('crearPedido', { slug: 'demo', items: [{ productoId: prod('Arroz').id, cantidad: 3 }], cliente: { nombre: 'Luis Gómez', telefono: '3015550000', entregaTipo: 'DOMICILIO', direccion: 'Calle 9 # 9-9' } });
  assert.equal(p.subtotal, 162000); assert.equal(p.envio, 0);
});
test('validaciones del formulario y honeypot', () => {
  const items = [{ productoId: prod('Arroz').id, cantidad: 1 }];
  throws(() => pub('crearPedido', { slug: 'demo', items, cliente: { nombre: 'Al', telefono: '3001112233' } }), /nombre/);
  throws(() => pub('crearPedido', { slug: 'demo', items, cliente: { nombre: 'Ana', telefono: '3001112233', entregaTipo: 'DOMICILIO' } }), /dirección/);
  throws(() => pub('crearPedido', { slug: 'demo', items, website: 'spam', cliente: {} }), /inválida/);
  throws(() => pub('crearPedido', { slug: 'demo', items: [], cliente: { nombre: 'Ana Pérez', telefono: '3001112233' } }), /vacío/);
});
test('inyección de fórmulas neutralizada', () => {
  const p = pub('crearPedido', { slug: 'demo', items: [{ productoId: prod('Arroz').id, cantidad: 1 }], cliente: { nombre: '=IMPORTXML("x")', telefono: '3209998877' } });
  // En el mock el apóstrofo se elimina como lo haría Sheets: queda como texto literal
  assert.equal(run("Db.find(ssEmpresa_(empresaPorSlug_('demo')),'Pedidos','id','" + p.id + "').nombre"), '=IMPORTXML("x")');
});
test('acumulado de pendientes por producto', () => {
  const r = admin('resumen');
  assert.equal(r.pendientes, 4);
  const arroz = r.productos.find(x => /Arroz/.test(x.nombre));
  assert.equal(arroz.cantidad, 7);
});
test('máquina de estados y venta efectiva al despachar', () => {
  throws(() => admin('cambiarEstado', { id: ped.id, estado: 'DESPACHADO' }), /No se puede pasar/);
  admin('cambiarEstado', { id: ped.id, estado: 'RECIBIDO' });
  admin('cambiarEstado', { id: ped.id, estado: 'DESPACHADO' });
  const d = admin('dashboard', {});
  assert.equal(d.kpis.ventasEfectivas, 1);
  assert.equal(d.kpis.ingresos, 77400);
  assert.equal(d.topProductos[0].cantidad, 2);
  assert.ok(mails.some(m => /Despachado/.test(m.subject)));
});
test('anular despachado exige motivo y reversa la venta', () => {
  throws(() => admin('cambiarEstado', { id: ped.id, estado: 'ANULADO' }), /motivo/);
  admin('cambiarEstado', { id: ped.id, estado: 'ANULADO', nota: 'Devolución' });
  assert.equal(admin('dashboard', {}).kpis.ingresos, 0);
  throws(() => admin('cambiarEstado', { id: ped.id, estado: 'RECIBIDO' }), /No se puede pasar/);
});
test('cambio masivo de estado', () => {
  const r = admin('cambiarEstado', { ids: ['P-000002', 'P-000003', 'NOEXISTE'], estado: 'RECIBIDO' });
  assert.equal(r.filter(x => x.ok).length, 2);
});
test('seguimiento público requiere token correcto', () => {
  throws(() => pub('consultarPedido', { slug: 'demo', id: ped.id, token: 'malo' }), /no encontrado/i);
  const r = pub('consultarPedido', { slug: 'demo', id: ped.id, token: ped.token });
  assert.equal(r.pedido.historial.length, 4);
  assert.equal(r.pedido.token, undefined);
});
test('repetir pedido devuelve ítems', () => {
  const r = pub('repetirPedido', { slug: 'demo', id: ped.id, token: ped.token });
  assert.equal(r.items.length, 2);
});
test('cliente cancela solo si está SOLICITADO', () => {
  const p = pub('crearPedido', { slug: 'demo', items: [{ productoId: prod('Arroz').id, cantidad: 1 }], cliente: { nombre: 'Marta Ruiz', telefono: '3104445566' } });
  pub('cancelarPedido', { slug: 'demo', id: p.id, token: p.token });
  throws(() => pub('cancelarPedido', { slug: 'demo', id: p.id, token: p.token }), /ya fue recibido/);
});
test('límite de productos del plan', () => {
  run("(function(){ const m=master_(); const p=Db.find(m,'Planes','id','PRO'); Db.update(m,'Planes',p._row,{maxProductos:3}); })()");
  throws(() => admin('guardarProducto', { nombre: 'Nuevo', precio: 1000 }), /permite 3 productos/);
});
test('facturación: emite, suspende por mora y reactiva al pagar', () => {
  run("(function(){ const m=master_(); const s=Db.all(m,'Suscripciones')[0]; Db.update(m,'Suscripciones',s._row,{proximoCobro:new Date(Date.now()-86400000)}); })()");
  run('procesoDiario()');
  let f = run("Db.all(master_(),'Facturas')");
  assert.equal(f.length, 1); assert.equal(f[0].estado, 'PENDIENTE');
  assert.equal(run("empresaPorSlug_('demo').estado"), 'ACTIVA');
  run("(function(){ const m=master_(); const f=Db.all(m,'Facturas')[0]; Db.update(m,'Facturas',f._row,{vence:new Date(Date.now()-2*86400000)}); })()");
  run('procesoDiario()');
  assert.equal(run("empresaPorSlug_('demo').estado"), 'SUSPENDIDA');
  throws(() => pub('crearPedido', { slug: 'demo', items: [], cliente: {} }), /no está recibiendo/);
  throws(() => admin('guardarProducto', { nombre: 'x', precio: 1 }), /suspendida/);
  const st = run("loginSuper('super@test.com','" + 'CambiaEstaClave#2026' + "')").token;
  ctx.apiSuper(st, 'marcarPagada', { id: f[0].id, medioPago: 'PSE', referencia: '123' });
  assert.equal(run("empresaPorSlug_('demo').estado"), 'ACTIVA');
  const m = ctx.apiSuper(st, 'metricas', {});
  assert.equal(m.activas, 1);
  assert.ok(m.mrr > 0);
});
test('roles: operador no puede editar productos', () => {
  admin('guardarUsuario', { email: 'op@test.com', nombre: 'Operador', rol: 'OPERADOR', clave: 'Operador123' });
  const t2 = run("loginEmpresa('demo','op@test.com','Operador123')").token;
  throws(() => ctx.apiAdmin(t2, 'guardarProducto', { nombre: 'x', precio: 1 }), /administrador/);
  assert.ok(ctx.apiAdmin(t2, 'listarPedidos', {}).total > 0);
});
test('sesión inválida', () => throws(() => ctx.apiAdmin('xxx', 'resumen', {}), /SESION_EXPIRADA/));

console.log('\n' + ok + ' pruebas OK' + (process.exitCode ? ' (hay fallos)' : ''));
