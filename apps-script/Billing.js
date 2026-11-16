/**
 * Suscripciones y facturación recurrente del proveedor SaaS.
 * procesoDiario() se ejecuta con un activador diario (instalarActivadores()).
 *
 * Nota: este módulo genera y controla facturas/estados. El cobro real debe integrarse
 * con una pasarela (Wompi, Mercado Pago, PayU, Stripe) mediante su webhook -> doPost().
 */

function sumarCiclo_(fecha, ciclo) {
  const d = new Date(fecha);
  if (ciclo === 'ANUAL') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

function procesoDiario() {
  const mss = master_();
  const hoy = ahora_();
  const hoyStr = fechaStr_(hoy);
  const empresas = {};
  Db.all(mss, 'Empresas').forEach(e => { empresas[e.id] = e; });

  // 1) Emitir facturas de suscripciones cuyo cobro venció
  Db.all(mss, 'Suscripciones').forEach(s => {
    if (['PRUEBA', 'ACTIVA'].indexOf(s.estado) === -1) return;
    if (!s.proximoCobro || fechaStr_(s.proximoCobro) > hoyStr) return;
    const emp = empresas[s.empresaId];
    if (!emp) return;
    const f = {
      id: id_('FAC'), empresaId: s.empresaId, suscripcionId: s.id,
      periodo: Utilities.formatDate(new Date(s.proximoCobro), APP.ZONA_HORARIA, 'yyyy-MM') + (s.ciclo === 'ANUAL' ? ' (anual)' : ''),
      valor: num_(s.valor), estado: 'PENDIENTE', emitida: hoy,
      vence: new Date(hoy.getTime() + APP.DIAS_GRACIA * 86400000), pagada: '', medioPago: '', referencia: '',
    };
    Db.insert(mss, 'Facturas', f);
    Db.update(mss, 'Suscripciones', s._row, { estado: 'ACTIVA', proximoCobro: sumarCiclo_(s.proximoCobro, s.ciclo), actualizado: hoy });
    if (emp.estado === 'PRUEBA') { Db.update(mss, 'Empresas', emp._row, { estado: 'ACTIVA' }); emp.estado = 'ACTIVA'; limpiarCacheEmpresa_(emp); }
    try { emailFactura_(emp, f, 'Nueva factura ' + APP.NOMBRE, 'Se generó la factura de tu suscripción.'); } catch (e) { console.error(e); }
    auditar_('sistema', s.empresaId, 'FACTURA_EMITIDA', f.id);
  });

  // 2) Recordatorios y suspensión por mora
  Db.all(mss, 'Facturas').forEach(f => {
    if (f.estado !== 'PENDIENTE') return;
    const emp = empresas[f.empresaId];
    if (!emp) return;
    const vence = fechaStr_(f.vence);
    const enDos = fechaStr_(new Date(hoy.getTime() + 2 * 86400000));
    if (vence === enDos) {
      try { emailFactura_(emp, f, 'Recordatorio de pago', 'Tu factura vence en 2 días. Evita la suspensión del servicio.'); } catch (e) { console.error(e); }
    }
    if (vence < hoyStr) {
      Db.update(mss, 'Facturas', f._row, { estado: 'VENCIDA' });
      const s = Db.find(mss, 'Suscripciones', 'id', f.suscripcionId);
      if (s) Db.update(mss, 'Suscripciones', s._row, { estado: 'SUSPENDIDA', actualizado: hoy });
      const e = Db.find(mss, 'Empresas', 'id', f.empresaId);
      if (e && e.estado !== 'CANCELADA') {
        Db.update(mss, 'Empresas', e._row, { estado: 'SUSPENDIDA' });
        limpiarCacheEmpresa_(e);
      }
      try { emailFactura_(emp, f, 'Servicio suspendido', 'Tu cuenta fue suspendida por factura vencida. Al registrar el pago se reactiva automáticamente.'); } catch (err) { console.error(err); }
      auditar_('sistema', f.empresaId, 'SUSPENSION_MORA', f.id);
    }
  });
}

function marcarFacturaPagada_(actor, d) {
  const mss = master_();
  const f = Db.find(mss, 'Facturas', 'id', d.id);
  if (!f) throw new Error('Factura no encontrada.');
  if (f.estado === 'PAGADA') throw new Error('La factura ya está pagada.');
  Db.update(mss, 'Facturas', f._row, { estado: 'PAGADA', pagada: ahora_(), medioPago: str_(d.medioPago, 60), referencia: str_(d.referencia, 120) });
  const pendientes = Db.all(mss, 'Facturas').filter(x => x.empresaId === f.empresaId && x.estado === 'VENCIDA' && x.id !== f.id);
  if (!pendientes.length) {
    const s = Db.find(mss, 'Suscripciones', 'id', f.suscripcionId);
    if (s && s.estado === 'SUSPENDIDA') Db.update(mss, 'Suscripciones', s._row, { estado: 'ACTIVA', actualizado: ahora_() });
    const e = Db.find(mss, 'Empresas', 'id', f.empresaId);
    if (e && e.estado === 'SUSPENDIDA') { Db.update(mss, 'Empresas', e._row, { estado: 'ACTIVA' }); limpiarCacheEmpresa_(e); }
  }
  auditar_(actor, f.empresaId, 'FACTURA_PAGADA', d);
  return true;
}

function instalarActivadores() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'procesoDiario').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('procesoDiario').timeBased().everyDays(1).atHour(6).inTimezone(APP.ZONA_HORARIA).create();
  return 'Activador diario instalado';
}
