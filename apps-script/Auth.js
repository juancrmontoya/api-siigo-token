/**
 * Autenticación propia (correo + clave con hash SHA-256 iterado y salt),
 * sesiones en CacheService. Funciona para usuarios con o sin cuenta Google.
 */

function hash_(clave, salt) {
  let h = String(salt) + String(clave);
  for (let i = 0; i < 200; i++) {
    h = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt));
  }
  return h;
}

function validarClave_(clave) {
  if (!clave || String(clave).length < 8) throw new Error('La clave debe tener al menos 8 caracteres.');
  if (!/[A-Za-z]/.test(clave) || !/\d/.test(clave)) throw new Error('La clave debe combinar letras y números.');
}

function nuevaSesion_(data) {
  const token = Utilities.getUuid().replace(/-/g, '') + tokenCorto_(12);
  CacheService.getScriptCache().put('s_' + token, JSON.stringify(data), Math.min(APP.SESION_HORAS * 3600, 21600));
  return token;
}

function sesion_(token) {
  if (!token) throw new Error('SESION_EXPIRADA');
  const raw = CacheService.getScriptCache().get('s_' + token);
  if (!raw) throw new Error('SESION_EXPIRADA');
  return JSON.parse(raw);
}

function controlIntentos_(key) {
  const c = CacheService.getScriptCache();
  const n = num_(c.get('li_' + key));
  if (n >= APP.MAX_INTENTOS_LOGIN) throw new Error('Demasiados intentos fallidos. Intenta en ' + APP.BLOQUEO_LOGIN_MIN + ' minutos.');
  return {
    fallo() { c.put('li_' + key, String(n + 1), APP.BLOQUEO_LOGIN_MIN * 60); },
    ok() { c.remove('li_' + key); },
  };
}

/** Login del panel de una empresa. */
function loginEmpresa(slug, email, clave) {
  email = str_(email, 120).toLowerCase();
  const emp = empresaPorSlug_(slug);
  if (!emp) throw new Error('Empresa no encontrada. Verifica el código de tu empresa.');
  if (emp.estado === 'CANCELADA') throw new Error('Esta cuenta fue cancelada. Contacta a soporte.');
  const ctl = controlIntentos_(emp.id + ':' + email);
  const ss = ssEmpresa_(emp);
  const u = Db.find(ss, 'Usuarios', 'email', email);
  if (!u || u.activo !== 'SI' || hash_(clave, u.salt) !== u.hash) {
    ctl.fallo();
    throw new Error('Correo o clave incorrectos.');
  }
  ctl.ok();
  Db.update(ss, 'Usuarios', u._row, { ultimoAcceso: ahora_() });
  const token = nuevaSesion_({ tipo: 'EMPRESA', empresaId: emp.id, slug: emp.slug, email: email, nombre: u.nombre, rol: u.rol });
  return { token: token, usuario: { email: email, nombre: u.nombre, rol: u.rol }, empresa: { slug: emp.slug, nombre: emp.nombre } };
}

/** Login de la consola del proveedor SaaS. */
function loginSuper(email, clave) {
  email = str_(email, 120).toLowerCase();
  const ctl = controlIntentos_('super:' + email);
  const u = Db.find(master_(), 'SuperUsuarios', 'email', email);
  if (!u || u.activo !== 'SI' || hash_(clave, u.salt) !== u.hash) {
    ctl.fallo();
    throw new Error('Correo o clave incorrectos.');
  }
  ctl.ok();
  auditar_(email, '', 'LOGIN_SUPER', '');
  const token = nuevaSesion_({ tipo: 'SUPER', email: email, nombre: u.nombre });
  return { token: token, usuario: { email: email, nombre: u.nombre } };
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove('s_' + token);
  return true;
}
