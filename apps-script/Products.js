/**
 * Catálogo de productos.
 */

function listarProductos_(ctx) {
  return Db.all(ctx.ss, 'Productos').sort((a, b) => num_(a.orden) - num_(b.orden) || String(a.nombre).localeCompare(String(b.nombre)));
}

function guardarProducto_(ctx, d) {
  const nombre = str_(d.nombre, 120);
  if (!nombre) throw new Error('El nombre del producto es obligatorio.');
  const precio = num_(d.precio);
  if (precio < 0) throw new Error('El precio no puede ser negativo.');
  const envioTipo = ENVIO_TIPOS.indexOf(d.envioTipo) >= 0 ? d.envioTipo : 'INCLUIDO';
  const envioValor = envioTipo === 'PERSONALIZADO' ? Math.max(0, num_(d.envioValor)) : 0;
  const datos = {
    nombre: nombre,
    descripcion: str_(d.descripcion, 1500),
    presentacion: str_(d.presentacion, 120),
    marca: str_(d.marca, 80),
    categoria: str_(d.categoria, 60),
    precio: precio,
    envioTipo: envioTipo,
    envioValor: envioValor,
    imagenId: str_(d.imagenId, 100),
    imagenUrl: str_(d.imagenUrl, 500),
    activo: d.activo === 'NO' ? 'NO' : 'SI',
    disponible: d.disponible === 'NO' ? 'NO' : 'SI',
    orden: num_(d.orden),
    actualizado: ahora_(),
  };
  const productos = Db.all(ctx.ss, 'Productos');
  let res;
  if (d.id) {
    const p = productos.find(x => x.id === d.id);
    if (!p) throw new Error('Producto no encontrado.');
    Db.update(ctx.ss, 'Productos', p._row, datos);
    res = Object.assign({}, p, datos);
  } else {
    if (productos.length >= num_(ctx.plan.maxProductos)) {
      throw new Error('Tu plan ' + ctx.plan.nombre + ' permite ' + ctx.plan.maxProductos + ' productos. Mejora tu plan para agregar más.');
    }
    datos.id = id_('PR');
    datos.creado = ahora_();
    if (!datos.orden) datos.orden = productos.length + 1;
    Db.insert(ctx.ss, 'Productos', datos);
    res = datos;
  }
  CacheService.getScriptCache().remove('cat_' + ctx.emp.id);
  return res;
}

function eliminarProducto_(ctx, d) {
  const p = Db.find(ctx.ss, 'Productos', 'id', d.id);
  if (!p) throw new Error('Producto no encontrado.');
  Db.remove(ctx.ss, 'Productos', p._row);
  if (p.imagenId) { try { DriveApp.getFileById(p.imagenId).setTrashed(true); } catch (e) { /* sin acción */ } }
  CacheService.getScriptCache().remove('cat_' + ctx.emp.id);
  return true;
}

/** Recibe una imagen en base64 (ya redimensionada en el navegador) y la guarda en Drive. */
function subirImagen_(ctx, d) {
  const mime = String(d.mime || '');
  if (!/^image\/(jpeg|png|webp|gif)$/.test(mime)) throw new Error('Formato de imagen no permitido.');
  const bytes = Utilities.base64Decode(String(d.base64 || ''));
  if (bytes.length > 2 * 1024 * 1024) throw new Error('La imagen supera 2 MB.');
  const folderId = ctx.cfg.carpetaImagenes || ctx.emp.folderId;
  const blob = Utilities.newBlob(bytes, mime, 'prod_' + Date.now() + '.' + mime.split('/')[1]);
  const file = DriveApp.getFolderById(folderId).createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {
    throw new Error('Tu dominio de Google Workspace no permite compartir archivos públicamente. Usa una URL de imagen externa.');
  }
  if (d.reemplazaId) { try { DriveApp.getFileById(d.reemplazaId).setTrashed(true); } catch (e) { /* sin acción */ } }
  return { imagenId: file.getId(), imagenUrl: 'https://lh3.googleusercontent.com/d/' + file.getId() + '=w800' };
}

/** Catálogo público (solo productos activos), con caché. */
function catalogoPublico_(emp) {
  const cache = CacheService.getScriptCache();
  const key = 'cat_' + emp.id;
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const ss = ssEmpresa_(emp);
  const cfg = configEmpresa_(emp, ss);
  const negocio = {};
  CONFIG_PUBLICA.forEach(k => { negocio[k] = cfg[k]; });
  negocio.nombreNegocio = negocio.nombreNegocio || emp.nombre;
  const productos = Db.all(ss, 'Productos')
    .filter(p => p.activo === 'SI')
    .sort((a, b) => num_(a.orden) - num_(b.orden))
    .map(p => ({
      id: p.id, nombre: p.nombre, descripcion: p.descripcion, presentacion: p.presentacion, marca: p.marca,
      categoria: p.categoria, precio: num_(p.precio), envioTipo: p.envioTipo, envioValor: num_(p.envioValor),
      imagenUrl: p.imagenUrl, disponible: p.disponible !== 'NO',
    }));
  const out = { negocio: negocio, productos: productos };
  try { cache.put(key, JSON.stringify(out), 600); } catch (e) { /* catálogo > 100KB: sin caché */ }
  return out;
}
