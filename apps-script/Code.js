/**
 * Punto de entrada de la Web App + API de panel administrativo y pública.
 *
 * Rutas:
 *   ?page=tienda&e=<slug>                       Catálogo / formulario público de pedidos
 *   ?page=pedido&e=<slug>&o=<id>&k=<token>      Seguimiento del pedido
 *   ?page=admin&e=<slug>                        Panel administrativo de la empresa
 *   ?page=super                                 Consola del proveedor SaaS
 */

function doGet(e) {
  const p = (e && e.parameter) || {};
  const page = String(p.page || '').toLowerCase();
  try {
    if (page === 'super') return render_('Super', {}, 'Consola ' + APP.NOMBRE);
    if (page === 'admin' || (!page && !p.e)) return render_('Admin', { slug: str_(p.e, 60) }, 'Panel administrativo');
    if (page === 'pedido') return renderSeguimiento_(p);
    return renderTienda_(p);
  } catch (err) {
    console.error(err);
    return render_('Mensaje', { titulo: 'Ocurrió un problema', mensaje: err.message }, APP.NOMBRE);
  }
}

function render_(archivo, boot, titulo, color) {
  const t = HtmlService.createTemplateFromFile(archivo);
  boot = Object.assign({ baseUrl: urlBase_(), app: APP.NOMBRE, version: APP.VERSION, estados: ESTADO_LABEL, transiciones: TRANSICIONES }, boot);
  t.boot = JSON.stringify(boot).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
  t.color = /^#[0-9a-fA-F]{6}$/.test(color || '') ? color : '#0f766e';
  return t.evaluate()
    .setTitle(titulo || APP.NOMBRE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // permite incrustar el catálogo en la web del cliente
}

function renderTienda_(p) {
  const emp = empresaPorSlug_(p.e);
  if (!emp) return render_('Mensaje', { titulo: 'Negocio no encontrado', mensaje: 'Verifica el enlace que te compartieron.' });
  if (!empresaActiva_(emp)) return render_('Mensaje', { titulo: emp.nombre, mensaje: 'Este catálogo no está disponible temporalmente.' }, emp.nombre);
  const cat = catalogoPublico_(emp);
  return render_('Tienda', {
    slug: emp.slug, catalogo: cat,
    repetir: p.o && p.k ? { id: str_(p.o, 30), token: str_(p.k, 30) } : null,
  }, cat.negocio.nombreNegocio + ' · Pedidos', cat.negocio.colorPrimario);
}

function renderSeguimiento_(p) {
  const emp = empresaPorSlug_(p.e);
  if (!emp) return render_('Mensaje', { titulo: 'Negocio no encontrado', mensaje: 'Verifica el enlace de seguimiento.' });
  const cfg = configEmpresa_(emp);
  return render_('Seguimiento', { slug: emp.slug, id: str_(p.o, 30), token: str_(p.k, 30), nombreNegocio: cfg.nombreNegocio || emp.nombre },
    'Pedido ' + str_(p.o, 30), cfg.colorPrimario);
}

function include(nombre) {
  return HtmlService.createHtmlOutputFromFile(nombre).getContent();
}

/* ======================= API pública (formulario / seguimiento) ======================= */

const PUBLIC_API = {
  catalogo(d) {
    const emp = empresaPorSlug_(d.slug);
    if (!emp || !empresaActiva_(emp)) throw new Error('Catálogo no disponible.');
    return catalogoPublico_(emp);
  },
  crearPedido(d) { return crearPedidoPublico_(d); },
  consultarPedido(d) { return consultarPedidoPublico_(d); },
  cancelarPedido(d) { return cancelarPedidoCliente_(d); },
  repetirPedido(d) { return itemsParaRepetir_(d); },
};

function apiPublica(accion, datos) {
  try {
    const fn = PUBLIC_API[accion];
    if (!fn) throw new Error('Acción no soportada.');
    return plain_(fn(datos || {}));
  } catch (e) {
    console.error('apiPublica', accion, e);
    throw new Error(e.message);
  }
}

/* ======================= API panel administrativo ======================= */

const SOLO_ADMIN = ['guardarProducto', 'eliminarProducto', 'subirImagen', 'guardarConfig', 'listarUsuarios', 'guardarUsuario'];
const PERMITIDO_SUSPENDIDA = ['estadoCuenta', 'cambiarClave', 'listarPedidos', 'detallePedido', 'dashboard', 'resumen'];

const ADMIN_API = {
  estadoCuenta(ctx) {
    const s = Db.find(master_(), 'Suscripciones', 'empresaId', ctx.emp.id) || {};
    const facturas = Db.all(master_(), 'Facturas').filter(f => f.empresaId === ctx.emp.id).sort((a, b) => new Date(b.emitida) - new Date(a.emitida)).slice(0, 12);
    return {
      empresa: { nombre: ctx.emp.nombre, slug: ctx.emp.slug, estado: ctx.emp.estado, plan: ctx.plan },
      suscripcion: s, facturas: facturas,
      usuario: { email: ctx.ses.email, nombre: ctx.ses.nombre, rol: ctx.ses.rol },
      config: ctx.cfg,
      urls: { tienda: urlTienda_(ctx.emp.slug), admin: urlAdmin_(ctx.emp.slug) },
      uso: { productos: Db.all(ctx.ss, 'Productos').length },
    };
  },
  resumen(ctx) { return acumuladoPendientes_(ctx); },
  listarPedidos(ctx, d) { return listarPedidos_(ctx, d); },
  detallePedido(ctx, d) { return detallePedidoAdmin_(ctx, d); },
  cambiarEstado(ctx, d) { return cambiarEstadoAdmin_(ctx, d); },
  listarProductos(ctx) { return listarProductos_(ctx); },
  guardarProducto(ctx, d) { return guardarProducto_(ctx, d); },
  eliminarProducto(ctx, d) { return eliminarProducto_(ctx, d); },
  subirImagen(ctx, d) { return subirImagen_(ctx, d); },
  dashboard(ctx, d) { return dashboard_(ctx, d); },

  guardarConfig(ctx, d) {
    const permitidas = ['nombreNegocio', 'whatsapp', 'emailNotificaciones', 'colorPrimario', 'logoUrl', 'mensajeBienvenida', 'permitirRecoger',
      'permitirDomicilio', 'direccionRecogida', 'tarifaDomicilio', 'envioGratisDesde', 'pedidoMinimo', 'notificarCambiosEstado', 'notificarNuevoPedido', 'terminos', 'prefijo'];
    const cambios = {};
    permitidas.forEach(k => { if (d[k] !== undefined) cambios[k] = typeof CONFIG_DEFECTO[k] === 'number' ? Math.max(0, num_(d[k])) : str_(d[k], 1500); });
    if (cambios.whatsapp !== undefined) cambios.whatsapp = cambios.whatsapp.replace(/\D/g, '');
    if (cambios.colorPrimario !== undefined && !/^#[0-9a-fA-F]{6}$/.test(cambios.colorPrimario)) throw new Error('Color inválido.');
    if (cambios.emailNotificaciones && !esEmail_(cambios.emailNotificaciones)) throw new Error('Correo de notificaciones inválido.');
    if (cambios.prefijo !== undefined) cambios.prefijo = cambios.prefijo.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'P';
    if (cambios.permitirRecoger === 'NO' && cambios.permitirDomicilio === 'NO') throw new Error('Debe existir al menos un tipo de entrega.');
    guardarConfig_(ctx.emp, ctx.ss, cambios);
    return configEmpresa_(ctx.emp, ctx.ss);
  },

  listarUsuarios(ctx) { return Db.all(ctx.ss, 'Usuarios'); },

  guardarUsuario(ctx, d) {
    const email = str_(d.email, 120).toLowerCase();
    if (!esEmail_(email)) throw new Error('Correo inválido.');
    const rol = d.rol === 'ADMIN' ? 'ADMIN' : 'OPERADOR';
    const usuarios = Db.all(ctx.ss, 'Usuarios');
    const u = usuarios.find(x => x.email === email);
    if (u) {
      if (email === ctx.ses.email && (d.activo === 'NO' || rol !== 'ADMIN')) throw new Error('No puedes desactivarte ni quitarte el rol de administrador.');
      const cambios = { nombre: str_(d.nombre, 80) || u.nombre, rol: rol, activo: d.activo === 'NO' ? 'NO' : 'SI' };
      if (d.clave) { validarClave_(d.clave); cambios.salt = tokenCorto_(16); cambios.hash = hash_(d.clave, cambios.salt); }
      Db.update(ctx.ss, 'Usuarios', u._row, cambios);
    } else {
      if (usuarios.length >= num_(ctx.plan.maxUsuarios)) throw new Error('Tu plan permite ' + ctx.plan.maxUsuarios + ' usuarios.');
      validarClave_(d.clave);
      const salt = tokenCorto_(16);
      Db.insert(ctx.ss, 'Usuarios', { email: email, nombre: str_(d.nombre, 80), rol: rol, hash: hash_(d.clave, salt), salt: salt, activo: 'SI', creado: ahora_() });
    }
    return true;
  },

  cambiarClave(ctx, d) {
    const u = Db.find(ctx.ss, 'Usuarios', 'email', ctx.ses.email);
    if (!u || hash_(d.actual, u.salt) !== u.hash) throw new Error('La clave actual no es correcta.');
    validarClave_(d.nueva);
    const salt = tokenCorto_(16);
    Db.update(ctx.ss, 'Usuarios', u._row, { salt: salt, hash: hash_(d.nueva, salt) });
    return true;
  },
};

function apiAdmin(token, accion, datos) {
  try {
    const ses = sesion_(token);
    if (ses.tipo !== 'EMPRESA') throw new Error('No autorizado.');
    const fn = ADMIN_API[accion];
    if (!fn) throw new Error('Acción no soportada.');
    const emp = empresaPorId_(ses.empresaId);
    if (!emp || emp.estado === 'CANCELADA') throw new Error('Cuenta no disponible.');
    if (!empresaActiva_(emp) && PERMITIDO_SUSPENDIDA.indexOf(accion) === -1) {
      throw new Error('Tu cuenta está suspendida por pago pendiente. Puedes consultar información, pero no modificarla.');
    }
    if (SOLO_ADMIN.indexOf(accion) >= 0 && ses.rol !== 'ADMIN') throw new Error('Solo un administrador puede realizar esta acción.');
    const ss = ssEmpresa_(emp);
    const ctx = { ses: ses, emp: emp, ss: ss, cfg: configEmpresa_(emp, ss), plan: planDe_(emp.plan) };
    return plain_(fn(ctx, datos || {}));
  } catch (e) {
    console.error('apiAdmin', accion, e);
    throw new Error(e.message);
  }
}

/* ======================= Instalación ======================= */

/**
 * Ejecutar UNA vez desde el editor de Apps Script (tras editar INSTALACION en Config.js).
 * Crea la base maestra, la carpeta raíz, los planes, el súper administrador y el activador diario.
 */
function instalar() {
  const p = props_();
  let mss;
  if (p.getProperty('MASTER_ID')) {
    mss = SpreadsheetApp.openById(p.getProperty('MASTER_ID'));
  } else {
    const carpeta = DriveApp.createFolder(APP.NOMBRE + ' - Plataforma SaaS');
    const empresas = carpeta.createFolder('Empresas');
    mss = SpreadsheetApp.create('[' + APP.NOMBRE + '] Base maestra');
    DriveApp.getFileById(mss.getId()).moveTo(carpeta);
    p.setProperties({ MASTER_ID: mss.getId(), FOLDER_ID: empresas.getId() });
  }
  mss.setSpreadsheetTimeZone(APP.ZONA_HORARIA);
  Db.ensureSchema(mss, ESQUEMA_MASTER);
  if (!Db.all(mss, 'Planes').length) Db.insertMany(mss, 'Planes', PLANES_DEFECTO);
  const email = INSTALACION.SUPER_EMAIL.toLowerCase();
  if (!Db.find(mss, 'SuperUsuarios', 'email', email)) {
    const salt = tokenCorto_(16);
    Db.insert(mss, 'SuperUsuarios', { email: email, nombre: INSTALACION.SUPER_NOMBRE, hash: hash_(INSTALACION.SUPER_CLAVE_TEMPORAL, salt), salt: salt, activo: 'SI', creado: ahora_() });
  }
  instalarActivadores();
  const msg = 'Instalación completa.\nBase maestra: ' + mss.getUrl() + '\nPublica la Web App (Implementar > Nueva implementación) y abre ?page=super';
  console.log(msg);
  return msg;
}

/** Opcional: fija la URL pública (p. ej. si incrustas en Google Sites o usas un dominio propio). */
function fijarUrlPublica(url) {
  props_().setProperty('URL_PUBLICA', url);
}

/** Crea una empresa de demostración con productos de ejemplo. */
function crearEmpresaDemo() {
  const r = aprovisionarEmpresa_({ nombre: 'Distribuidora Demo', slug: 'demo', emailAdmin: INSTALACION.SUPER_EMAIL, clave: 'Demo12345', plan: 'PRO', telefono: '573001234567' }, 'instalador');
  const emp = empresaPorId_(r.id);
  const ss = ssEmpresa_(emp);
  const ctx = { emp: emp, ss: ss, cfg: configEmpresa_(emp, ss), plan: planDe_('PRO'), ses: { email: 'instalador' } };
  [
    { nombre: 'Café molido premium', descripcion: 'Tostión media, notas a chocolate.', presentacion: 'Bolsa 500 g', marca: 'Montaña', categoria: 'Café', precio: 18500, envioTipo: 'EXCLUIDO' },
    { nombre: 'Aceite de girasol', descripcion: 'Aceite vegetal 100% girasol.', presentacion: 'Garrafa 3 L', marca: 'Sol', categoria: 'Abarrotes', precio: 32900, envioTipo: 'PERSONALIZADO', envioValor: 1500 },
    { nombre: 'Arroz blanco', descripcion: 'Grano largo, tipo 1.', presentacion: 'Paca 25 x 500 g', marca: 'Del Valle', categoria: 'Abarrotes', precio: 54000, envioTipo: 'INCLUIDO' },
  ].forEach(p => guardarProducto_(ctx, p));
  guardarConfig_(emp, ss, { tarifaDomicilio: 6000, envioGratisDesde: 150000, direccionRecogida: 'Cra 10 # 20-30, Bodega 4' });
  console.log(JSON.stringify(r, null, 2));
  return r;
}
