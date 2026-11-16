/**
 * Ventas efectivas (pedidos despachados) y dashboard comercial.
 */

function registrarVenta_(ss, p, items) {
  const existente = Db.find(ss, 'Ventas', 'pedidoId', p.id);
  const fecha = p.fechaDespacho || ahora_();
  if (existente) { // idempotente: si se re-despacha, se reactiva
    Db.update(ss, 'Ventas', existente._row, { vigente: 'SI', fechaDespacho: fecha, fechaReverso: '' });
    return;
  }
  Db.insert(ss, 'Ventas', {
    pedidoId: p.id, fechaPedido: p.fecha, fechaDespacho: fecha, cliente: p.nombre, telefono: p.telefono,
    entregaTipo: p.entregaTipo, subtotal: num_(p.subtotal), envio: num_(p.envio), total: num_(p.total),
    vigente: 'SI', fechaReverso: '',
  });
  Db.insertMany(ss, 'VentasItems', items.map(i => ({
    pedidoId: p.id, fechaDespacho: fecha, productoId: i.productoId, nombre: i.nombre, marca: i.marca,
    cantidad: num_(i.cantidad), precio: num_(i.precio), subtotal: num_(i.subtotal), vigente: 'SI',
  })));
}

function reversarVenta_(ss, pedidoId) {
  const v = Db.find(ss, 'Ventas', 'pedidoId', pedidoId);
  if (v) Db.update(ss, 'Ventas', v._row, { vigente: 'NO', fechaReverso: ahora_() });
  const sh = Db.sheet(ss, 'VentasItems');
  Db.all(ss, 'VentasItems').filter(i => i.pedidoId === pedidoId).forEach(i => {
    const col = Db.headers(sh).indexOf('vigente') + 1;
    sh.getRange(i._row, col).setValue('NO');
  });
}

function dashboard_(ctx, f) {
  const tz = APP.ZONA_HORARIA;
  const hoy = fechaStr_(ahora_(), tz);
  const hasta = /^\d{4}-\d{2}-\d{2}$/.test(f.hasta || '') ? f.hasta : hoy;
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(f.desde || '') ? f.desde : fechaStr_(new Date(Date.now() - 29 * 86400000), tz);
  const enRango = d => { const s = fechaStr_(d, tz); return s && s >= desde && s <= hasta; };

  const todos = Db.all(ctx.ss, 'Pedidos');
  const pedidos = todos.filter(p => enRango(p.fecha));
  const ventas = Db.all(ctx.ss, 'Ventas').filter(v => v.vigente === 'SI' && enRango(v.fechaDespacho));
  const vItems = Db.all(ctx.ss, 'VentasItems').filter(v => v.vigente === 'SI' && enRango(v.fechaDespacho));

  const porEstado = {};
  Object.keys(ESTADOS).forEach(k => { porEstado[k] = 0; });
  pedidos.forEach(p => { porEstado[p.estado] = (porEstado[p.estado] || 0) + 1; });

  const ingresos = ventas.reduce((s, v) => s + num_(v.total), 0);
  const ingresosEnvio = ventas.reduce((s, v) => s + num_(v.envio), 0);
  const base = pedidos.length - porEstado.ANULADO;
  const horas = ventas.map(v => (new Date(v.fechaDespacho) - new Date(v.fechaPedido)) / 3600000).filter(h => h >= 0);

  // Serie diaria
  const serie = [];
  const idx = {};
  let d = new Date(desde + 'T12:00:00');
  const fin = new Date(hasta + 'T12:00:00');
  let guard = 0;
  while (d <= fin && guard < 732) {
    const k = Utilities.formatDate(d, tz, 'yyyy-MM-dd');
    idx[k] = serie.length;
    serie.push({ fecha: k, ingresos: 0, ventas: 0, pedidos: 0, cancelados: 0 });
    d = new Date(d.getTime() + 86400000);
    guard++;
  }
  ventas.forEach(v => { const i = idx[fechaStr_(v.fechaDespacho, tz)]; if (i !== undefined) { serie[i].ingresos += num_(v.total); serie[i].ventas++; } });
  pedidos.forEach(p => {
    const i = idx[fechaStr_(p.fecha, tz)];
    if (i === undefined) return;
    serie[i].pedidos++;
    if (p.estado === 'CANCELADO' || p.estado === 'ANULADO') serie[i].cancelados++;
  });

  // Top productos
  const prod = {};
  vItems.forEach(i => {
    if (!prod[i.productoId]) prod[i.productoId] = { nombre: i.nombre, marca: i.marca, cantidad: 0, ingresos: 0 };
    prod[i.productoId].cantidad += num_(i.cantidad);
    prod[i.productoId].ingresos += num_(i.subtotal);
  });
  const top = Object.keys(prod).map(k => prod[k]).sort((a, b) => b.cantidad - a.cantidad).slice(0, 10);

  // Top clientes
  const cli = {};
  ventas.forEach(v => {
    const k = String(v.telefono || v.cliente);
    if (!cli[k]) cli[k] = { cliente: v.cliente, telefono: v.telefono, pedidos: 0, total: 0 };
    cli[k].pedidos++;
    cli[k].total += num_(v.total);
  });
  const topClientes = Object.keys(cli).map(k => cli[k]).sort((a, b) => b.total - a.total).slice(0, 10);

  return {
    desde: desde, hasta: hasta,
    kpis: {
      ventasEfectivas: ventas.length,
      ingresos: ingresos,
      ingresosEnvio: ingresosEnvio,
      ticketPromedio: ventas.length ? ingresos / ventas.length : 0,
      pedidosPeriodo: pedidos.length,
      pendientesPeriodo: porEstado.SOLICITADO + porEstado.RECIBIDO + porEstado.SIN_EXISTENCIAS,
      pendientesTotal: todos.filter(p => ESTADOS_PENDIENTES.indexOf(p.estado) >= 0).length,
      cancelados: porEstado.CANCELADO,
      anulados: porEstado.ANULADO,
      sinExistencias: porEstado.SIN_EXISTENCIAS,
      cumplimiento: base > 0 ? (porEstado.DESPACHADO / base) * 100 : 0,
      tasaCancelacion: pedidos.length ? ((porEstado.CANCELADO + porEstado.ANULADO) / pedidos.length) * 100 : 0,
      horasPromedioDespacho: horas.length ? horas.reduce((a, b) => a + b, 0) / horas.length : 0,
      unidadesVendidas: vItems.reduce((s, i) => s + num_(i.cantidad), 0),
    },
    porEstado: porEstado,
    entrega: {
      RECOGE: ventas.filter(v => v.entregaTipo !== 'DOMICILIO').length,
      DOMICILIO: ventas.filter(v => v.entregaTipo === 'DOMICILIO').length,
    },
    serie: serie,
    topProductos: top,
    topClientes: topClientes,
    ventas: ventas.sort((a, b) => new Date(b.fechaDespacho) - new Date(a.fechaDespacho)).slice(0, 1000),
  };
}
