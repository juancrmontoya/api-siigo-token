/**
 * Configuración global de la plataforma SaaS.
 * Edita INSTALACION antes de ejecutar instalar() por primera vez.
 */
const APP = {
  NOMBRE: 'PedidosPro',
  VERSION: '1.0.0',
  ZONA_HORARIA: 'America/Bogota',
  MONEDA: 'COP',
  LOCALE: 'es-CO',
  SESION_HORAS: 6,          // máx. 6 h (límite de CacheService)
  DIAS_GRACIA: 5,           // días para pagar una factura antes de suspender
  DIAS_PRUEBA: 14,          // período de prueba de nuevas empresas
  MAX_INTENTOS_LOGIN: 5,
  BLOQUEO_LOGIN_MIN: 15,
  MAX_PEDIDOS_TEL_10MIN: 5, // anti-spam formulario público
  MAX_ITEMS_PEDIDO: 100,
};

const INSTALACION = {
  SUPER_EMAIL: 'tu-correo@dominio.com',
  SUPER_NOMBRE: 'Administrador SaaS',
  SUPER_CLAVE_TEMPORAL: 'CambiaEstaClave#2026',
};

const ESTADOS = {
  SOLICITADO: 'SOLICITADO',
  RECIBIDO: 'RECIBIDO',
  DESPACHADO: 'DESPACHADO',
  CANCELADO: 'CANCELADO',
  ANULADO: 'ANULADO',
  SIN_EXISTENCIAS: 'SIN_EXISTENCIAS',
};

const ESTADO_LABEL = {
  SOLICITADO: 'Solicitado',
  RECIBIDO: 'Recibido',
  DESPACHADO: 'Despachado',
  CANCELADO: 'Cancelado',
  ANULADO: 'Anulado',
  SIN_EXISTENCIAS: 'Sin existencias',
};

/** Máquina de estados: qué transiciones están permitidas. */
const TRANSICIONES = {
  SOLICITADO: ['RECIBIDO', 'SIN_EXISTENCIAS', 'CANCELADO', 'ANULADO'],
  RECIBIDO: ['DESPACHADO', 'SIN_EXISTENCIAS', 'CANCELADO', 'ANULADO'],
  SIN_EXISTENCIAS: ['RECIBIDO', 'CANCELADO', 'ANULADO'],
  DESPACHADO: ['ANULADO'], // anular un despacho reversa la venta
  CANCELADO: [],
  ANULADO: [],
};

const ESTADOS_PENDIENTES = ['SOLICITADO', 'RECIBIDO', 'SIN_EXISTENCIAS'];

const ENVIO_TIPOS = ['INCLUIDO', 'EXCLUIDO', 'PERSONALIZADO'];

const PLANES_DEFECTO = [
  { id: 'BASICO', nombre: 'Básico', precioMensual: 49000, precioAnual: 490000, maxProductos: 50, maxUsuarios: 2, maxPedidosMes: 300, activo: 'SI' },
  { id: 'PRO', nombre: 'Profesional', precioMensual: 99000, precioAnual: 990000, maxProductos: 300, maxUsuarios: 5, maxPedidosMes: 2000, activo: 'SI' },
  { id: 'EMPRESARIAL', nombre: 'Empresarial', precioMensual: 199000, precioAnual: 1990000, maxProductos: 5000, maxUsuarios: 20, maxPedidosMes: 20000, activo: 'SI' },
];

const ESQUEMA_MASTER = {
  Empresas: ['id', 'slug', 'nombre', 'nit', 'emailAdmin', 'telefono', 'plan', 'estado', 'spreadsheetId', 'folderId', 'creado', 'notas'],
  Planes: ['id', 'nombre', 'precioMensual', 'precioAnual', 'maxProductos', 'maxUsuarios', 'maxPedidosMes', 'activo'],
  Suscripciones: ['id', 'empresaId', 'plan', 'ciclo', 'valor', 'estado', 'fechaInicio', 'fechaFinPrueba', 'proximoCobro', 'actualizado'],
  Facturas: ['id', 'empresaId', 'suscripcionId', 'periodo', 'valor', 'estado', 'emitida', 'vence', 'pagada', 'medioPago', 'referencia'],
  SuperUsuarios: ['email', 'nombre', 'hash', 'salt', 'activo', 'creado'],
  Auditoria: ['fecha', 'actor', 'empresaId', 'accion', 'detalle'],
};

const ESQUEMA_EMPRESA = {
  Config: ['clave', 'valor'],
  Usuarios: ['email', 'nombre', 'rol', 'hash', 'salt', 'activo', 'creado', 'ultimoAcceso'],
  Productos: ['id', 'nombre', 'descripcion', 'presentacion', 'marca', 'categoria', 'precio', 'envioTipo', 'envioValor', 'imagenId', 'imagenUrl', 'activo', 'disponible', 'orden', 'creado', 'actualizado'],
  Pedidos: ['id', 'token', 'fecha', 'estado', 'nombre', 'telefono', 'email', 'direccion', 'entregaTipo', 'notas', 'subtotal', 'envio', 'total', 'itemsCount', 'actualizado', 'fechaDespacho'],
  PedidoItems: ['pedidoId', 'productoId', 'nombre', 'presentacion', 'marca', 'precio', 'cantidad', 'envioTipo', 'envioLinea', 'subtotal'],
  Historial: ['pedidoId', 'fecha', 'estadoAnterior', 'estadoNuevo', 'usuario', 'nota'],
  Ventas: ['pedidoId', 'fechaPedido', 'fechaDespacho', 'cliente', 'telefono', 'entregaTipo', 'subtotal', 'envio', 'total', 'vigente', 'fechaReverso'],
  VentasItems: ['pedidoId', 'fechaDespacho', 'productoId', 'nombre', 'marca', 'cantidad', 'precio', 'subtotal', 'vigente'],
};

const CONFIG_DEFECTO = {
  nombreNegocio: '',
  whatsapp: '',               // número del negocio con indicativo, ej. 573001234567
  emailNotificaciones: '',
  colorPrimario: '#0f766e',
  logoUrl: '',
  mensajeBienvenida: '¡Bienvenido! Arma tu pedido y te lo preparamos.',
  permitirRecoger: 'SI',
  permitirDomicilio: 'SI',
  direccionRecogida: '',
  tarifaDomicilio: 0,         // se cobra una vez si algún producto tiene envío EXCLUIDO
  envioGratisDesde: 0,        // 0 = desactivado
  pedidoMinimo: 0,
  notificarCambiosEstado: 'SI',
  notificarNuevoPedido: 'SI',
  terminos: '',
  prefijo: 'P',
  consecutivo: 0,
};

/** Claves de configuración que son visibles en el formulario público. */
const CONFIG_PUBLICA = ['nombreNegocio', 'whatsapp', 'colorPrimario', 'logoUrl', 'mensajeBienvenida', 'permitirRecoger', 'permitirDomicilio', 'direccionRecogida', 'tarifaDomicilio', 'envioGratisDesde', 'pedidoMinimo', 'terminos'];
