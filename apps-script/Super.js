/**
 * Consola del proveedor SaaS: empresas, planes, suscripciones, facturación.
 */

const SUPER_API = {
  metricas() {
    const mss = master_();
    const empresas = Db.all(mss, 'Empresas');
    const subs = Db.all(mss, 'Suscripciones');
    const facturas = Db.all(mss, 'Facturas');
    const mrr = subs.filter(s => s.estado === 'ACTIVA').reduce((t, s) => t + (s.ciclo === 'ANUAL' ? num_(s.valor) / 12 : num_(s.valor)), 0);
    const mes = Utilities.formatDate(ahora_(), APP.ZONA_HORARIA, 'yyyy-MM');
    return {
      empresas: empresas.length,
      activas: empresas.filter(e => e.estado === 'ACTIVA').length,
      prueba: empresas.filter(e => e.estado === 'PRUEBA').length,
      suspendidas: empresas.filter(e => e.estado === 'SUSPENDIDA').length,
      mrr: mrr,
      porCobrar: facturas.filter(f => f.estado === 'PENDIENTE' || f.estado === 'VENCIDA').reduce((t, f) => t + num_(f.valor), 0),
      recaudadoMes: facturas.filter(f => f.estado === 'PAGADA' && f.pagada && Utilities.formatDate(new Date(f.pagada), APP.ZONA_HORARIA, 'yyyy-MM') === mes).reduce((t, f) => t + num_(f.valor), 0),
      vencidas: facturas.filter(f => f.estado === 'VENCIDA').length,
    };
  },

  listarEmpresas() {
    const mss = master_();
    const subs = Db.all(mss, 'Suscripciones');
    return Db.all(mss, 'Empresas').map(e => {
      const s = subs.find(x => x.empresaId === e.id) || {};
      return Object.assign(e, { suscripcion: s, urlAdmin: urlAdmin_(e.slug), urlTienda: urlTienda_(e.slug) });
    }).sort((a, b) => new Date(b.creado) - new Date(a.creado));
  },

  crearEmpresa(ses, d) { return aprovisionarEmpresa_(d, ses.email); },

  actualizarEmpresa(ses, d) {
    const mss = master_();
    const e = Db.find(mss, 'Empresas', 'id', d.id);
    if (!e) throw new Error('Empresa no encontrada.');
    const cambios = {
      nombre: str_(d.nombre, 120) || e.nombre, nit: str_(d.nit, 30), telefono: str_(d.telefono, 20),
      emailAdmin: esEmail_(d.emailAdmin) ? str_(d.emailAdmin, 120).toLowerCase() : e.emailAdmin, notas: str_(d.notas, 500),
    };
    if (d.plan && d.plan !== e.plan) {
      const plan = planDe_(d.plan);
      cambios.plan = plan.id;
      const s = Db.find(mss, 'Suscripciones', 'empresaId', e.id);
      if (s) {
        const ciclo = d.ciclo || s.ciclo;
        Db.update(mss, 'Suscripciones', s._row, { plan: plan.id, ciclo: ciclo, valor: ciclo === 'ANUAL' ? num_(plan.precioAnual) : num_(plan.precioMensual), actualizado: ahora_() });
      }
    }
    if (d.valorPersonalizado) {
      const s = Db.find(mss, 'Suscripciones', 'empresaId', e.id);
      if (s) Db.update(mss, 'Suscripciones', s._row, { valor: num_(d.valorPersonalizado), actualizado: ahora_() });
    }
    Db.update(mss, 'Empresas', e._row, cambios);
    limpiarCacheEmpresa_(e);
    auditar_(ses.email, e.id, 'ACTUALIZAR_EMPRESA', d);
    return true;
  },

  cambiarEstadoEmpresa(ses, d) {
    const validos = ['ACTIVA', 'SUSPENDIDA', 'CANCELADA', 'PRUEBA'];
    if (validos.indexOf(d.estado) === -1) throw new Error('Estado inválido.');
    const mss = master_();
    const e = Db.find(mss, 'Empresas', 'id', d.id);
    if (!e) throw new Error('Empresa no encontrada.');
    Db.update(mss, 'Empresas', e._row, { estado: d.estado });
    const s = Db.find(mss, 'Suscripciones', 'empresaId', e.id);
    if (s) Db.update(mss, 'Suscripciones', s._row, { estado: d.estado === 'CANCELADA' ? 'CANCELADA' : d.estado === 'SUSPENDIDA' ? 'SUSPENDIDA' : d.estado, actualizado: ahora_() });
    limpiarCacheEmpresa_(e);
    auditar_(ses.email, e.id, 'ESTADO_EMPRESA', d.estado + ' ' + str_(d.motivo, 200));
    return true;
  },

  resetClaveAdmin(ses, d) {
    const e = empresaPorId_(d.id);
    if (!e) throw new Error('Empresa no encontrada.');
    const ss = ssEmpresa_(e);
    const u = Db.find(ss, 'Usuarios', 'email', e.emailAdmin);
    const clave = 'Tmp-' + tokenCorto_(8);
    const salt = tokenCorto_(16);
    if (u) Db.update(ss, 'Usuarios', u._row, { hash: hash_(clave, salt), salt: salt, activo: 'SI' });
    else Db.insert(ss, 'Usuarios', { email: e.emailAdmin, nombre: 'Administrador', rol: 'ADMIN', hash: hash_(clave, salt), salt: salt, activo: 'SI', creado: ahora_() });
    try { emailBienvenidaEmpresa_(e, e.emailAdmin, clave); } catch (err) { console.error(err); }
    auditar_(ses.email, e.id, 'RESET_CLAVE_ADMIN', e.emailAdmin);
    return { claveTemporal: clave };
  },

  listarPlanes() { return Db.all(master_(), 'Planes'); },

  guardarPlan(ses, d) {
    const mss = master_();
    const id = str_(d.id, 30).toUpperCase().replace(/[^A-Z0-9_]/g, '');
    if (!id) throw new Error('El código del plan es obligatorio.');
    const datos = {
      id: id, nombre: str_(d.nombre, 60), precioMensual: num_(d.precioMensual), precioAnual: num_(d.precioAnual),
      maxProductos: num_(d.maxProductos), maxUsuarios: num_(d.maxUsuarios), maxPedidosMes: num_(d.maxPedidosMes), activo: d.activo === 'NO' ? 'NO' : 'SI',
    };
    const p = Db.find(mss, 'Planes', 'id', id);
    if (p) Db.update(mss, 'Planes', p._row, datos); else Db.insert(mss, 'Planes', datos);
    auditar_(ses.email, '', 'GUARDAR_PLAN', datos);
    return datos;
  },

  listarFacturas(ses, d) {
    const mss = master_();
    const emp = {};
    Db.all(mss, 'Empresas').forEach(e => { emp[e.id] = e.nombre; });
    let f = Db.all(mss, 'Facturas');
    if (d && d.estado) f = f.filter(x => x.estado === d.estado);
    return f.map(x => Object.assign(x, { empresa: emp[x.empresaId] || x.empresaId })).sort((a, b) => new Date(b.emitida) - new Date(a.emitida));
  },

  marcarPagada(ses, d) { return marcarFacturaPagada_(ses.email, d); },

  facturaManual(ses, d) {
    const mss = master_();
    const s = Db.find(mss, 'Suscripciones', 'empresaId', d.empresaId);
    if (!s) throw new Error('La empresa no tiene suscripción.');
    const hoy = ahora_();
    const f = {
      id: id_('FAC'), empresaId: d.empresaId, suscripcionId: s.id, periodo: str_(d.periodo, 40) || Utilities.formatDate(hoy, APP.ZONA_HORARIA, 'yyyy-MM'),
      valor: num_(d.valor) || num_(s.valor), estado: 'PENDIENTE', emitida: hoy, vence: new Date(hoy.getTime() + APP.DIAS_GRACIA * 86400000),
    };
    Db.insert(mss, 'Facturas', f);
    auditar_(ses.email, d.empresaId, 'FACTURA_MANUAL', f);
    return f;
  },

  cambiarClave(ses, d) {
    const mss = master_();
    const u = Db.find(mss, 'SuperUsuarios', 'email', ses.email);
    if (!u || hash_(d.actual, u.salt) !== u.hash) throw new Error('La clave actual no es correcta.');
    validarClave_(d.nueva);
    const salt = tokenCorto_(16);
    Db.update(mss, 'SuperUsuarios', u._row, { salt: salt, hash: hash_(d.nueva, salt) });
    auditar_(ses.email, '', 'CAMBIO_CLAVE_SUPER', '');
    return true;
  },

  ejecutarProcesoDiario() { procesoDiario(); return true; },

  auditoria() { return Db.all(master_(), 'Auditoria').slice(-300).reverse(); },
};

function apiSuper(token, accion, datos) {
  try {
    const ses = sesion_(token);
    if (ses.tipo !== 'SUPER') throw new Error('No autorizado.');
    const fn = SUPER_API[accion];
    if (!fn) throw new Error('Acción no soportada.');
    return plain_(fn(ses, datos || {}));
  } catch (e) {
    console.error('apiSuper', accion, e);
    throw new Error(e.message);
  }
}
