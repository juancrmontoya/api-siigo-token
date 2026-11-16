/**
 * Notificaciones por correo (MailApp). Cuota diaria: ~100 (Gmail gratuito) / ~1.500 (Workspace).
 */

function enviarCorreo_(to, asunto, html, opciones) {
  if (!esEmail_(to)) return false;
  if (MailApp.getRemainingDailyQuota() < 1) { console.warn('Cuota de correo agotada'); return false; }
  MailApp.sendEmail(Object.assign({ to: to, subject: asunto, htmlBody: html }, opciones || {}));
  return true;
}

function plantillaCorreo_(cfg, titulo, cuerpo) {
  const color = cfg.colorPrimario || '#0f766e';
  const logo = cfg.logoUrl ? '<img src="' + escHtml_(cfg.logoUrl) + '" alt="" style="max-height:48px;margin-bottom:8px">' : '';
  return '<div style="font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;padding:24px">' +
    '<div style="max-width:600px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">' +
    '<div style="background:' + color + ';color:#fff;padding:20px 24px">' + logo +
    '<div style="font-size:13px;opacity:.85">' + escHtml_(cfg.nombreNegocio) + '</div>' +
    '<div style="font-size:20px;font-weight:bold">' + escHtml_(titulo) + '</div></div>' +
    '<div style="padding:24px;color:#0f172a;font-size:14px;line-height:1.5">' + cuerpo + '</div>' +
    '<div style="padding:12px 24px;background:#f8fafc;color:#64748b;font-size:12px">Enviado por ' + escHtml_(cfg.nombreNegocio) + ' con ' + APP.NOMBRE + '</div>' +
    '</div></div>';
}

function tablaItems_(items, pedido) {
  const filas = items.map(i => '<tr><td style="padding:6px;border-bottom:1px solid #e2e8f0">' + escHtml_(i.nombre) +
    (i.presentacion ? '<br><span style="color:#64748b;font-size:12px">' + escHtml_(i.presentacion) + (i.marca ? ' · ' + escHtml_(i.marca) : '') + '</span>' : '') +
    '</td><td style="padding:6px;border-bottom:1px solid #e2e8f0;text-align:center">' + num_(i.cantidad) +
    '</td><td style="padding:6px;border-bottom:1px solid #e2e8f0;text-align:right">' + money_(i.subtotal) + '</td></tr>').join('');
  return '<table style="width:100%;border-collapse:collapse;font-size:14px">' +
    '<tr style="background:#f8fafc"><th style="padding:6px;text-align:left">Producto</th><th style="padding:6px">Cant.</th><th style="padding:6px;text-align:right">Subtotal</th></tr>' +
    filas +
    '<tr><td colspan="2" style="padding:6px;text-align:right">Subtotal</td><td style="padding:6px;text-align:right">' + money_(pedido.subtotal) + '</td></tr>' +
    '<tr><td colspan="2" style="padding:6px;text-align:right">Envío</td><td style="padding:6px;text-align:right">' + money_(pedido.envio) + '</td></tr>' +
    '<tr><td colspan="2" style="padding:6px;text-align:right;font-weight:bold">Total</td><td style="padding:6px;text-align:right;font-weight:bold">' + money_(pedido.total) + '</td></tr></table>';
}

function boton_(cfg, url, texto) {
  return '<p style="text-align:center;margin:24px 0"><a href="' + escHtml_(url) + '" style="background:' + (cfg.colorPrimario || '#0f766e') +
    ';color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">' + escHtml_(texto) + '</a></p>' +
    '<p style="font-size:12px;color:#64748b;word-break:break-all">Si el botón no funciona copia este enlace: ' + escHtml_(url) + '</p>';
}

function datosEntrega_(cfg, p) {
  return '<p><b>Cliente:</b> ' + escHtml_(p.nombre) + '<br><b>Teléfono:</b> ' + escHtml_(p.telefono) + '<br>' +
    (p.entregaTipo === 'DOMICILIO'
      ? '<b>Entrega a domicilio:</b> ' + escHtml_(p.direccion)
      : '<b>Recoge en el punto</b>' + (cfg.direccionRecogida ? ': ' + escHtml_(cfg.direccionRecogida) : '')) +
    (p.notas ? '<br><b>Notas:</b> ' + escHtml_(p.notas) : '') + '</p>';
}

function emailConfirmacionPedido_(emp, cfg, p, items, url) {
  const cuerpo = '<p>Hola <b>' + escHtml_(p.nombre) + '</b>, recibimos tu pedido <b>' + escHtml_(p.id) + '</b>. Estado actual: <b>Solicitado</b>.</p>' +
    datosEntrega_(cfg, p) + tablaItems_(items, p) + boton_(cfg, url, 'Ver estado de mi pedido');
  enviarCorreo_(p.email, 'Pedido ' + p.id + ' recibido - ' + cfg.nombreNegocio, plantillaCorreo_(cfg, 'Pedido ' + p.id, cuerpo),
    { name: cfg.nombreNegocio || APP.NOMBRE, replyTo: esEmail_(cfg.emailNotificaciones) ? cfg.emailNotificaciones : undefined });
}

function emailNuevoPedidoNegocio_(emp, cfg, p, items) {
  if (!esEmail_(cfg.emailNotificaciones)) return;
  const cuerpo = '<p>Llegó un nuevo pedido <b>' + escHtml_(p.id) + '</b> por <b>' + money_(p.total) + '</b>.</p>' +
    datosEntrega_(cfg, p) + tablaItems_(items, p) + boton_(cfg, urlAdmin_(emp.slug), 'Abrir panel administrativo');
  enviarCorreo_(cfg.emailNotificaciones, '🛒 Nuevo pedido ' + p.id + ' - ' + money_(p.total), plantillaCorreo_(cfg, 'Nuevo pedido', cuerpo),
    { name: APP.NOMBRE, replyTo: esEmail_(p.email) ? p.email : undefined });
}

function emailCambioEstado_(emp, cfg, p, items, anterior, nota, url) {
  const msg = {
    RECIBIDO: 'El negocio recibió tu pedido y lo está preparando.',
    DESPACHADO: p.entregaTipo === 'DOMICILIO' ? '¡Tu pedido va en camino!' : '¡Tu pedido está listo / fue entregado!',
    CANCELADO: 'Tu pedido fue cancelado.',
    ANULADO: 'Tu pedido fue anulado.',
    SIN_EXISTENCIAS: 'Algunos productos de tu pedido no tienen existencias. El negocio se comunicará contigo.',
  }[p.estado] || '';
  const cuerpo = '<p>Hola <b>' + escHtml_(p.nombre) + '</b>, tu pedido <b>' + escHtml_(p.id) + '</b> cambió a <b>' + ESTADO_LABEL[p.estado] + '</b>.</p>' +
    '<p>' + msg + '</p>' + (nota ? '<p><b>Nota del negocio:</b> ' + escHtml_(nota) + '</p>' : '') +
    tablaItems_(items, p) + boton_(cfg, url, 'Ver estado de mi pedido');
  enviarCorreo_(p.email, 'Pedido ' + p.id + ': ' + ESTADO_LABEL[p.estado] + ' - ' + cfg.nombreNegocio, plantillaCorreo_(cfg, ESTADO_LABEL[p.estado], cuerpo),
    { name: cfg.nombreNegocio || APP.NOMBRE });
}

function emailBienvenidaEmpresa_(emp, email, clave) {
  const cfg = { nombreNegocio: APP.NOMBRE, colorPrimario: '#0f766e' };
  const cuerpo = '<p>¡Bienvenido a ' + APP.NOMBRE + '! Tu cuenta <b>' + escHtml_(emp.nombre) + '</b> está lista con ' + APP.DIAS_PRUEBA + ' días de prueba.</p>' +
    '<p><b>Código de empresa:</b> ' + escHtml_(emp.slug) + '<br><b>Usuario:</b> ' + escHtml_(email) + '<br><b>Clave temporal:</b> ' + escHtml_(clave) + '</p>' +
    '<p>Te recomendamos cambiar la clave en tu primer ingreso.</p>' + boton_(cfg, urlAdmin_(emp.slug), 'Ingresar al panel') +
    '<p>Formulario público de pedidos: <a href="' + escHtml_(urlTienda_(emp.slug)) + '">' + escHtml_(urlTienda_(emp.slug)) + '</a></p>';
  enviarCorreo_(email, 'Bienvenido a ' + APP.NOMBRE + ' - ' + emp.nombre, plantillaCorreo_(cfg, 'Tu cuenta está lista', cuerpo), { name: APP.NOMBRE });
}

function emailFactura_(emp, f, asunto, texto) {
  const cfg = { nombreNegocio: APP.NOMBRE, colorPrimario: '#0f766e' };
  const cuerpo = '<p>' + texto + '</p><p><b>Factura:</b> ' + escHtml_(f.id) + '<br><b>Período:</b> ' + escHtml_(f.periodo) +
    '<br><b>Valor:</b> ' + money_(f.valor) + '<br><b>Vence:</b> ' + fechaStr_(f.vence) + '</p>';
  enviarCorreo_(emp.emailAdmin, asunto, plantillaCorreo_(cfg, asunto, cuerpo), { name: APP.NOMBRE });
}
