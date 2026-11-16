/**
 * Multi-tenant: resolución de empresas, aprovisionamiento y configuración.
 * Cada empresa tiene su propio Spreadsheet y carpeta de Drive (aislamiento físico de datos).
 */

function props_() { return PropertiesService.getScriptProperties(); }

function master_() {
  const id = props_().getProperty('MASTER_ID');
  if (!id) throw new Error('La plataforma no está instalada. Ejecuta instalar() desde el editor.');
  return SpreadsheetApp.openById(id);
}

function urlBase_() {
  return props_().getProperty('URL_PUBLICA') || ScriptApp.getService().getUrl() || '';
}

function urlTienda_(slug) { return urlBase_() + '?page=tienda&e=' + encodeURIComponent(slug); }
function urlAdmin_(slug) { return urlBase_() + '?page=admin&e=' + encodeURIComponent(slug); }
function urlSeguimiento_(slug, id, token) {
  return urlBase_() + '?page=pedido&e=' + encodeURIComponent(slug) + '&o=' + encodeURIComponent(id) + '&k=' + encodeURIComponent(token);
}

function empresaPorSlug_(slug) {
  slug = str_(slug, 60).toLowerCase();
  if (!slug) return null;
  const cache = CacheService.getScriptCache();
  const key = 'emp_s_' + slug;
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const e = Db.find(master_(), 'Empresas', 'slug', slug);
  if (!e) return null;
  const o = plain_(e);
  cache.put(key, JSON.stringify(o), 300);
  return o;
}

function empresaPorId_(id) {
  const e = Db.find(master_(), 'Empresas', 'id', id);
  return e ? plain_(e) : null;
}

function limpiarCacheEmpresa_(emp) {
  const c = CacheService.getScriptCache();
  c.removeAll(['emp_s_' + emp.slug, 'cfg_' + emp.id, 'cat_' + emp.id]);
}

function ssEmpresa_(emp) { return SpreadsheetApp.openById(emp.spreadsheetId); }

function configEmpresa_(emp, ss) {
  const cache = CacheService.getScriptCache();
  const key = 'cfg_' + emp.id;
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const rows = Db.all(ss || ssEmpresa_(emp), 'Config');
  const cfg = Object.assign({}, CONFIG_DEFECTO);
  rows.forEach(r => { cfg[r.clave] = r.valor; });
  ['tarifaDomicilio', 'envioGratisDesde', 'pedidoMinimo', 'consecutivo'].forEach(k => { cfg[k] = num_(cfg[k]); });
  if (!/^#[0-9a-fA-F]{6}$/.test(String(cfg.colorPrimario))) cfg.colorPrimario = CONFIG_DEFECTO.colorPrimario;
  cache.put(key, JSON.stringify(cfg), 600);
  return cfg;
}

function guardarConfig_(emp, ss, cambios) {
  const rows = Db.all(ss, 'Config');
  Object.keys(cambios).forEach(k => {
    const r = rows.find(x => x.clave === k);
    if (r) Db.update(ss, 'Config', r._row, { valor: cambios[k] });
    else Db.insert(ss, 'Config', { clave: k, valor: cambios[k] });
  });
  limpiarCacheEmpresa_(emp);
}

function planDe_(planId) {
  const p = Db.find(master_(), 'Planes', 'id', planId);
  return p ? plain_(p) : PLANES_DEFECTO[0];
}

function empresaActiva_(emp) {
  return emp && (emp.estado === 'ACTIVA' || emp.estado === 'PRUEBA');
}

function auditar_(actor, empresaId, accion, detalle) {
  try {
    Db.insert(master_(), 'Auditoria', {
      fecha: ahora_(), actor: actor || '', empresaId: empresaId || '', accion: accion,
      detalle: typeof detalle === 'string' ? detalle : JSON.stringify(detalle || {}).slice(0, 2000),
    });
  } catch (e) { console.error('Auditoría', e); }
}

/**
 * Crea una nueva empresa: spreadsheet, carpeta de imágenes, usuario admin, suscripción en prueba.
 */
function aprovisionarEmpresa_(datos, actor) {
  const nombre = str_(datos.nombre, 120);
  const emailAdmin = str_(datos.emailAdmin, 120).toLowerCase();
  let slug = str_(datos.slug || nombre, 40).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!nombre) throw new Error('El nombre de la empresa es obligatorio.');
  if (!esEmail_(emailAdmin)) throw new Error('Correo del administrador inválido.');
  if (!slug || slug.length < 3) throw new Error('El identificador (slug) debe tener al menos 3 caracteres.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const mss = master_();
    if (Db.find(mss, 'Empresas', 'slug', slug)) throw new Error('El identificador "' + slug + '" ya está en uso.');
    const plan = planDe_(datos.plan || 'BASICO');
    const empresaId = id_('EMP');

    const raiz = DriveApp.getFolderById(props_().getProperty('FOLDER_ID'));
    const carpeta = raiz.createFolder(slug + ' - ' + nombre);
    const carpetaImg = carpeta.createFolder('imagenes');
    const ss = SpreadsheetApp.create('[' + APP.NOMBRE + '] ' + nombre);
    DriveApp.getFileById(ss.getId()).moveTo(carpeta);
    ss.setSpreadsheetTimeZone(APP.ZONA_HORARIA);
    Db.ensureSchema(ss, ESQUEMA_EMPRESA);

    const cfg = Object.assign({}, CONFIG_DEFECTO, {
      nombreNegocio: nombre, emailNotificaciones: emailAdmin, whatsapp: str_(datos.telefono, 20).replace(/\D/g, ''),
      carpetaImagenes: carpetaImg.getId(),
    });
    Db.insertMany(ss, 'Config', Object.keys(cfg).map(k => ({ clave: k, valor: cfg[k] })));

    const clave = datos.clave || ('Tmp-' + tokenCorto_(8));
    const salt = tokenCorto_(16);
    Db.insert(ss, 'Usuarios', {
      email: emailAdmin, nombre: str_(datos.nombreAdmin || 'Administrador', 80), rol: 'ADMIN',
      hash: hash_(clave, salt), salt: salt, activo: 'SI', creado: ahora_(), ultimoAcceso: '',
    });

    const hoy = ahora_();
    const finPrueba = new Date(hoy.getTime() + APP.DIAS_PRUEBA * 86400000);
    const ciclo = datos.ciclo === 'ANUAL' ? 'ANUAL' : 'MENSUAL';
    Db.insert(mss, 'Empresas', {
      id: empresaId, slug: slug, nombre: nombre, nit: str_(datos.nit, 30), emailAdmin: emailAdmin,
      telefono: str_(datos.telefono, 20), plan: plan.id, estado: 'PRUEBA', spreadsheetId: ss.getId(),
      folderId: carpeta.getId(), creado: hoy, notas: str_(datos.notas, 500),
    });
    Db.insert(mss, 'Suscripciones', {
      id: id_('SUB'), empresaId: empresaId, plan: plan.id, ciclo: ciclo,
      valor: ciclo === 'ANUAL' ? num_(plan.precioAnual) : num_(plan.precioMensual),
      estado: 'PRUEBA', fechaInicio: hoy, fechaFinPrueba: finPrueba, proximoCobro: finPrueba, actualizado: hoy,
    });
    auditar_(actor, empresaId, 'CREAR_EMPRESA', { slug: slug, plan: plan.id });
    const emp = { id: empresaId, slug: slug, nombre: nombre };
    try { emailBienvenidaEmpresa_(emp, emailAdmin, clave); } catch (e) { console.error(e); }
    return { id: empresaId, slug: slug, urlAdmin: urlAdmin_(slug), urlTienda: urlTienda_(slug), claveTemporal: clave };
  } finally {
    lock.releaseLock();
  }
}
