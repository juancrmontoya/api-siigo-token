/**
 * Pedidos: creación pública, trazabilidad de estados, acumulado de pendientes.
 */

/**
 * Regla de envío (la misma se replica en el navegador para mostrar totales):
 *  - Solo aplica si la entrega es DOMICILIO.
 *  - INCLUIDO: el precio ya incluye el envío (0).
 *  - PERSONALIZADO: valor de envío por unidad definido en el producto.
 *  - EXCLUIDO: el producto no incluye envío; se cobra UNA vez la tarifa de domicilio del negocio.
 *  - Si envioGratisDesde > 0 y el subtotal lo alcanza, el envío es 0.
 */
function calcularTotales_(lineas, cfg, entregaTipo) {
  let subtotal = 0, personalizado = 0, requiereTarifa = false;
  lineas.forEach(l => {
    l.subtotal = num_(l.precio) * num_(l.cantidad);
    subtotal += l.subtotal;
    l.envioLinea = 0;
    if (entregaTipo === 'DOMICILIO') {
      if (l.envioTipo === 'PERSONALIZADO') { l.envioLinea = num_(l.envioValor) * num_(l.cantidad); personalizado += l.envioLinea; }
      if (l.envioTipo === 'EXCLUIDO') requiereTarifa = true;
    }
  });
  let envio = entregaTipo === 'DOMICILIO' ? personalizado + (requiereTarifa ? num_(cfg.tarifaDomicilio) : 0) : 0;
  if (num_(cfg.envioGratisDesde) > 0 && subtotal >= num_(cfg.envioGratisDesde)) envio = 0;
  return { subtotal: subtotal, envio: envio, total: subtotal + envio };
}

function crearPedidoPublico_(d) {
  if (d.website) throw new Error('Solicitud inválida.'); // honeypot anti-bots
  const emp = empresaPorSlug_(d.slug);
  if (!emp) throw new Error('Negocio no encontrado.');
  if (!empresaActiva_(emp)) throw new Error('Este negocio no está recibiendo pedidos en este momento.');
  const ss = ssEmpresa_(emp);
  const cfg = configEmpresa_(emp, ss);
  const plan = planDe_(emp.plan);

  const c = d.cliente || {};
  const cliente = {
    nombre: str_(c.nombre, 120),
    telefono: str_(c.telefono, 25).replace(/[^\d+]/g, ''),
    email: str_(c.email, 120).toLowerCase(),
    direccion: str_(c.direccion, 300),
    entregaTipo: c.entregaTipo === 'DOMICILIO' ? 'DOMICILIO' : 'RECOGE',
    notas: str_(c.notas, 500),
  };
  if (cliente.nombre.length < 3) throw new Error('Escribe tu nombre completo.');
  if (cliente.telefono.replace(/\D/g, '').length < 7) throw new Error('Escribe un teléfono válido.');
  if (cliente.email && !esEmail_(cliente.email)) throw new Error('El correo electrónico no es válido.');
  if (cliente.entregaTipo === 'DOMICILIO' && cfg.permitirDomicilio !== 'SI') throw new Error('Este negocio no ofrece domicilios.');
  if (cliente.entregaTipo === 'RECOGE' && cfg.permitirRecoger !== 'SI') throw new Error('Este negocio solo entrega a domicilio.');
  if (cliente.entregaTipo === 'DOMICILIO' && cliente.direccion.length < 5) throw new Error('Escribe la dirección de entrega.');

  // Anti-spam por teléfono
  const cache = CacheService.getScriptCache();
  const rlKey = 'rl_' + emp.id + '_' + cliente.telefono;
  const rl = num_(cache.get(rlKey));
  if (rl >= APP.MAX_PEDIDOS_TEL_10MIN) throw new Error('Has enviado varios pedidos seguidos. Espera unos minutos.');

  // Recalcular SIEMPRE con precios del servidor (nunca confiar en el navegador)
  const items = (d.items || []).slice(0, APP.MAX_ITEMS_PEDIDO);
  if (!items.length) throw new Error('El carrito está vacío.');
  const productos = {};
  Db.all(ss, 'Productos').forEach(p => { productos[p.id] = p; });
  const lineas = [];
  items.forEach(it => {
    const p = productos[it.productoId];
    const cant = Math.floor(num_(it.cantidad));
    if (!p || p.activo !== 'SI') throw new Error('Un producto de tu carrito ya no está disponible. Actualiza el carrito.');
    if (p.disponible === 'NO') throw new Error('"' + p.nombre + '" está agotado. Retíralo del carrito.');
    if (cant < 1 || cant > 9999) throw new Error('Cantidad inválida para "' + p.nombre + '".');
    lineas.push({
      productoId: p.id, nombre: p.nombre, presentacion: p.presentacion, marca: p.marca,
      precio: num_(p.precio), cantidad: cant, envioTipo: p.envioTipo, envioValor: num_(p.envioValor),
    });
  });
  const tot = calcularTotales_(lineas, cfg, cliente.entregaTipo);
  if (num_(cfg.pedidoMinimo) > 0 && tot.subtotal < num_(cfg.pedidoMinimo)) {
    throw new Error('El pedido mínimo es ' + money_(cfg.pedidoMinimo) + '.');
  }
  if (num_(d.totalEsperado) && Math.round(num_(d.totalEsperado)) !== Math.round(tot.total)) {
    throw new Error('Los precios cambiaron mientras comprabas. Revisa el nuevo total: ' + money_(tot.total) + '.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let pedido;
  try {
    // Límite mensual del plan
    const tz = APP.ZONA_HORARIA;
    const mes = Utilities.formatDate(ahora_(), tz, 'yyyy-MM');
    const pedidos = Db.all(ss, 'Pedidos');
    const delMes = pedidos.filter(p => p.fecha && Utilities.formatDate(new Date(p.fecha), tz, 'yyyy-MM') === mes).length;
    if (delMes >= num_(plan.maxPedidosMes)) throw new Error('El negocio alcanzó su capacidad de pedidos este mes. Contáctalo directamente.');

    const cfgRows = Db.all(ss, 'Config');
    const rowCons = cfgRows.find(r => r.clave === 'consecutivo');
    const consecutivo = num_(rowCons ? rowCons.valor : 0) + 1;
    if (rowCons) Db.update(ss, 'Config', rowCons._row, { valor: consecutivo });
    else Db.insert(ss, 'Config', { clave: 'consecutivo', valor: consecutivo });

    const fecha = ahora_();
    pedido = Object.assign({
      id: (cfg.prefijo || 'P') + '-' + ('00000' + consecutivo).slice(-6),
      token: tokenCorto_(10),
      fecha: fecha,
      estado: ESTADOS.SOLICITADO,
      subtotal: tot.subtotal, envio: tot.envio, total: tot.total,
      itemsCount: lineas.reduce((s, l) => s + l.cantidad, 0),
      actualizado: fecha, fechaDespacho: '',
    }, cliente);
    Db.insert(ss, 'Pedidos', pedido);
    Db.insertMany(ss, 'PedidoItems', lineas.map(l => Object.assign({ pedidoId: pedido.id }, l)));
    Db.insert(ss, 'Historial', { pedidoId: pedido.id, fecha: fecha, estadoAnterior: '', estadoNuevo: ESTADOS.SOLICITADO, usuario: 'cliente', nota: 'Pedido creado desde el formulario' });
  } finally {
    lock.releaseLock();
  }
  cache.put(rlKey, String(rl + 1), 600);
  CacheService.getScriptCache().remove('cfg_' + emp.id);

  const url = urlSeguimiento_(emp.slug, pedido.id, pedido.token);
  try { if (pedido.email) emailConfirmacionPedido_(emp, cfg, pedido, lineas, url); } catch (e) { console.error('Correo cliente', e); }
  try { if (cfg.notificarNuevoPedido === 'SI') emailNuevoPedidoNegocio_(emp, cfg, pedido, lineas); } catch (e) { console.error('Correo negocio', e); }

  return { id: pedido.id, token: pedido.token, url: url, total: pedido.total, subtotal: pedido.subtotal, envio: pedido.envio, fecha: pedido.fecha, items: lineas, cliente: cliente };
}

function pedidoConDetalle_(ss, id) {
  const p = Db.find(ss, 'Pedidos', 'id', id);
  if (!p) return null;
  p.items = Db.all(ss, 'PedidoItems').filter(i => i.pedidoId === id);
  p.historial = Db.all(ss, 'Historial').filter(h => h.pedidoId === id).sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
  return p;
}

/** Seguimiento público: requiere número + token (evita enumerar pedidos ajenos). */
function consultarPedidoPublico_(d) {
  const emp = empresaPorSlug_(d.slug);
  if (!emp) throw new Error('Negocio no encontrado.');
  const ss = ssEmpresa_(emp);
  const p = pedidoConDetalle_(ss, str_(d.id, 30));
  if (!p || String(p.token) !== String(d.token)) throw new Error('Pedido no encontrado. Verifica el enlace.');
  const cfg = configEmpresa_(emp, ss);
  delete p.token;
  p.historial = p.historial.map(h => ({ fecha: h.fecha, estado: h.estadoNuevo, nota: h.usuario === 'cliente' ? h.nota : (h.nota || '') }));
  return {
    pedido: p,
    negocio: { nombreNegocio: cfg.nombreNegocio || emp.nombre, whatsapp: cfg.whatsapp, logoUrl: cfg.logoUrl, colorPrimario: cfg.colorPrimario, direccionRecogida: cfg.direccionRecogida },
    url: urlSeguimiento_(emp.slug, p.id, d.token),
    urlTienda: urlTienda_(emp.slug),
  };
}

function cancelarPedidoCliente_(d) {
  const emp = empresaPorSlug_(d.slug);
  if (!emp) throw new Error('Negocio no encontrado.');
  const ss = ssEmpresa_(emp);
  const p = Db.find(ss, 'Pedidos', 'id', str_(d.id, 30));
  if (!p || String(p.token) !== String(d.token)) throw new Error('Pedido no encontrado.');
  if (p.estado !== ESTADOS.SOLICITADO) throw new Error('El pedido ya fue recibido por el negocio; comunícate con ellos para cancelarlo.');
  aplicarCambioEstado_({ emp: emp, ss: ss, cfg: configEmpresa_(emp, ss), ses: { email: 'cliente' } }, p, ESTADOS.CANCELADO, str_(d.motivo, 300) || 'Cancelado por el cliente');
  return true;
}

/** Devuelve los ítems de un pedido anterior mapeados al catálogo vigente (para "repetir pedido"). */
function itemsParaRepetir_(d) {
  const emp = empresaPorSlug_(d.slug);
  if (!emp) throw new Error('Negocio no encontrado.');
  const ss = ssEmpresa_(emp);
  const p = Db.find(ss, 'Pedidos', 'id', str_(d.id, 30));
  if (!p || String(p.token) !== String(d.token)) throw new Error('Pedido no encontrado.');
  const items = Db.all(ss, 'PedidoItems').filter(i => i.pedidoId === p.id);
  return {
    items: items.map(i => ({ productoId: i.productoId, cantidad: num_(i.cantidad) })),
    cliente: { nombre: p.nombre, telefono: p.telefono, email: p.email, direccion: p.direccion, entregaTipo: p.entregaTipo },
  };
}

/* ---------------- Panel administrativo ---------------- */

function listarPedidos_(ctx, f) {
  const tz = APP.ZONA_HORARIA;
  const texto = str_(f.texto, 80).toLowerCase();
  let rows = Db.all(ctx.ss, 'Pedidos');
  if (f.estado) rows = rows.filter(p => f.estado === 'PENDIENTES' ? ESTADOS_PENDIENTES.indexOf(p.estado) >= 0 : p.estado === f.estado);
  if (f.desde) rows = rows.filter(p => fechaStr_(p.fecha, tz) >= f.desde);
  if (f.hasta) rows = rows.filter(p => fechaStr_(p.fecha, tz) <= f.hasta);
  if (f.entregaTipo) rows = rows.filter(p => p.entregaTipo === f.entregaTipo);
  if (texto) rows = rows.filter(p => [p.id, p.nombre, p.telefono, p.email, p.direccion].join(' ').toLowerCase().indexOf(texto) >= 0);
  rows.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  const total = rows.length;
  rows = rows.slice(0, Math.min(num_(f.limite) || 300, 1000)).map(p => { delete p.token; return p; });
  return { total: total, pedidos: rows };
}

function detallePedidoAdmin_(ctx, d) {
  const p = pedidoConDetalle_(ctx.ss, d.id);
  if (!p) throw new Error('Pedido no encontrado.');
  p.urlSeguimiento = urlSeguimiento_(ctx.emp.slug, p.id, p.token);
  p.transiciones = TRANSICIONES[p.estado] || [];
  delete p.token;
  return p;
}

function cambiarEstadoAdmin_(ctx, d) {
  const ids = Array.isArray(d.ids) ? d.ids : [d.id];
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  const resultados = [];
  try {
    const pedidos = Db.all(ctx.ss, 'Pedidos');
    ids.forEach(id => {
      const p = pedidos.find(x => x.id === id);
      if (!p) { resultados.push({ id: id, ok: false, error: 'No existe' }); return; }
      try {
        aplicarCambioEstado_(ctx, p, d.estado, str_(d.nota, 300));
        resultados.push({ id: id, ok: true });
      } catch (e) { resultados.push({ id: id, ok: false, error: e.message }); }
    });
  } finally { lock.releaseLock(); }
  if (ids.length === 1 && !resultados[0].ok) throw new Error(resultados[0].error);
  return resultados;
}

function aplicarCambioEstado_(ctx, p, nuevo, nota) {
  if (!ESTADOS[nuevo]) throw new Error('Estado inválido.');
  const permitidas = TRANSICIONES[p.estado] || [];
  if (permitidas.indexOf(nuevo) === -1) {
    throw new Error('No se puede pasar de ' + ESTADO_LABEL[p.estado] + ' a ' + ESTADO_LABEL[nuevo] + '.');
  }
  if ((nuevo === 'ANULADO' || nuevo === 'CANCELADO') && !nota && ctx.ses.email !== 'cliente') {
    throw new Error('Indica el motivo para ' + (nuevo === 'ANULADO' ? 'anular' : 'cancelar') + ' el pedido.');
  }
  const fecha = ahora_();
  const anterior = p.estado;
  const cambios = { estado: nuevo, actualizado: fecha };
  if (nuevo === ESTADOS.DESPACHADO) cambios.fechaDespacho = fecha;
  Db.update(ctx.ss, 'Pedidos', p._row, cambios);
  Db.insert(ctx.ss, 'Historial', { pedidoId: p.id, fecha: fecha, estadoAnterior: anterior, estadoNuevo: nuevo, usuario: ctx.ses.email, nota: nota || '' });
  Object.assign(p, cambios);

  const items = Db.all(ctx.ss, 'PedidoItems').filter(i => i.pedidoId === p.id);
  if (nuevo === ESTADOS.DESPACHADO) registrarVenta_(ctx.ss, p, items);
  if (anterior === ESTADOS.DESPACHADO && nuevo === ESTADOS.ANULADO) reversarVenta_(ctx.ss, p.id);

  if (p.email && ctx.cfg.notificarCambiosEstado === 'SI' && ctx.ses.email !== 'cliente') {
    try { emailCambioEstado_(ctx.emp, ctx.cfg, p, items, anterior, nota, urlSeguimiento_(ctx.emp.slug, p.id, p.token)); } catch (e) { console.error(e); }
  }
}

/** Acumulado de pendientes por despachar: totales por producto (lista de alistamiento). */
function acumuladoPendientes_(ctx) {
  const pedidos = Db.all(ctx.ss, 'Pedidos').filter(p => ESTADOS_PENDIENTES.indexOf(p.estado) >= 0);
  const ids = {};
  pedidos.forEach(p => { ids[p.id] = p.estado; });
  const porProducto = {};
  Db.all(ctx.ss, 'PedidoItems').forEach(i => {
    if (!ids[i.pedidoId]) return;
    const k = i.productoId;
    if (!porProducto[k]) porProducto[k] = { productoId: k, nombre: i.nombre, presentacion: i.presentacion, marca: i.marca, cantidad: 0, pedidos: 0, valor: 0, solicitado: 0, recibido: 0, sinExistencias: 0 };
    const r = porProducto[k];
    r.cantidad += num_(i.cantidad);
    r.pedidos += 1;
    r.valor += num_(i.subtotal);
    if (ids[i.pedidoId] === 'SOLICITADO') r.solicitado += num_(i.cantidad);
    if (ids[i.pedidoId] === 'RECIBIDO') r.recibido += num_(i.cantidad);
    if (ids[i.pedidoId] === 'SIN_EXISTENCIAS') r.sinExistencias += num_(i.cantidad);
  });
  const conteo = {};
  Object.keys(ESTADOS).forEach(k => { conteo[k] = 0; });
  Db.all(ctx.ss, 'Pedidos').forEach(p => { conteo[p.estado] = (conteo[p.estado] || 0) + 1; });
  const hoy = fechaStr_(ahora_());
  return {
    conteo: conteo,
    pendientes: pedidos.length,
    valorPendiente: pedidos.reduce((s, p) => s + num_(p.total), 0),
    domiciliosPendientes: pedidos.filter(p => p.entregaTipo === 'DOMICILIO').length,
    pedidosHoy: Db.all(ctx.ss, 'Pedidos').filter(p => fechaStr_(p.fecha) === hoy).length,
    productos: Object.keys(porProducto).map(k => porProducto[k]).sort((a, b) => b.cantidad - a.cantidad),
    ultimos: pedidos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha)).slice(0, 10).map(p => { delete p.token; return p; }),
  };
}
