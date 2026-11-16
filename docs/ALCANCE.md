# Revisión del alcance: catálogo y pedidos B2B (SaaS)

## 1. Observaciones sobre la redacción original

El documento está bien estructurado y cubre lo esencial. Estos puntos son ambiguos o prometen
más de lo que la plataforma puede dar, y conviene corregirlos antes de mostrárselo a un cliente o a
un desarrollador:

| Texto original | Problema | Propuesta |
|---|---|---|
| "B2B" | El SaaS se vende a negocios (B2B), pero el formulario lo usa el cliente final, que puede ser persona natural (B2C) o empresa. | Aclararlo: *"SaaS B2B para negocios que venden a otros negocios o a consumidores"*. Si el comprador es empresa, pedir NIT y razón social (ver §3.4). |
| Envío "incluido, excluido o valor personalizado" | "Excluido" puede significar "no hay envío" o "el envío se cobra aparte". | Se definió así: **Incluido** = el precio ya cubre el envío; **Excluido** = se cobra **una vez** la tarifa de domicilio del negocio; **Personalizado** = valor por unidad. Más "envío gratis desde $X". Solo aplica si el cliente pide domicilio. |
| Estados Cancelado / Anulado | No se dice quién usa cada uno ni cuándo. | **Cancelado:** el cliente o el negocio desisten antes del despacho. **Anulado:** error o reverso administrativo, y es el único estado al que puede pasar un pedido despachado (reversa la venta). Ambos piden motivo. |
| "Visualizar en tiempo real" | Apps Script no tiene canales en tiempo real (websockets). | Escribir *"actualización automática cada 30 a 60 segundos"*. Así quedó implementado. |
| "Notificaciones automáticas por WhatsApp" | Los enlaces `wa.me` abren WhatsApp con el mensaje listo, pero **una persona debe pulsar Enviar**. Para mensajes automáticos se necesita la API de WhatsApp Business (Meta), plantillas aprobadas y un costo por conversación. | Separar: *"compartir por WhatsApp (manual)"*, ya incluido, y *"notificaciones automáticas por WhatsApp"* como módulo opcional de pago (fase 2). |
| "Controlar la facturación recurrente" | Generar facturas no es cobrar. | Fase 1: facturas, vencimientos, recordatorios y suspensión automática, con el pago registrado a mano. Fase 2: pasarela (Wompi, Mercado Pago, PayU o Stripe) con webhook que marque la factura como pagada. |
| "Duplicar pedidos anteriores" y "copiar el pedido" | Parecen lo mismo, pero son dos funciones. | **Copiar** = copiar el texto del pedido al portapapeles. **Repetir** = cargar los productos de un pedido anterior al carrito con los precios vigentes. Ambas están implementadas. |
| "Integración nativa con Google Workspace" | Suena a integración con Gmail/Calendar/Chat del cliente. | Precisar: *"construida sobre Google Workspace: Sheets como base de datos, Drive para imágenes y Gmail para correos; los datos de cada negocio se pueden abrir en Google Sheets"*. |
| "Escalable" | Apps Script tiene límites fijos (ver §4). | *"Escalable hasta N pedidos/día por empresa, con ruta de migración definida"*. |

### Versión corregida del párrafo inicial (sugerida)

> Desarrollar una microaplicación SaaS multiempresa, construida sobre Google Workspace (Google Apps Script,
> Sheets, Drive y Gmail), para que negocios que venden a otras empresas o a consumidores gestionen su
> catálogo, reciban pedidos mediante un formulario público con carrito de compras, hagan seguimiento
> de cada pedido por estados y analicen sus ventas efectivas. Cada empresa cliente administra de forma
> independiente sus productos, pedidos, usuarios, reportes, formulario y código QR, con su información
> aislada de la de las demás organizaciones. El proveedor del SaaS cuenta con una consola para crear
> empresas, asignar planes y límites, controlar suscripciones y suspender cuentas por falta de pago.

## 2. Qué quedó implementado

| Requisito | Estado | Notas |
|---|---|---|
| Multiempresa con datos aislados | ✅ | Un Spreadsheet y una carpeta de Drive por empresa (aislamiento físico, no solo lógico). |
| Productos: nombre, descripción, presentación, marca, imagen, precio, envío | ✅ | Además: categoría, orden, visible/oculto y disponible/agotado. Las imágenes se suben a Drive, redimensionadas en el navegador. |
| Estados y trazabilidad | ✅ | Con reglas de qué cambio de estado se permite desde cada estado, historial con usuario, fecha y nota, y cambio masivo. |
| Acumulado de pendientes y cantidades por producto | ✅ | Desglosado por estado, imprimible como lista de alistamiento y exportable a CSV. |
| Despachado pasa a la tabla de ventas efectivas | ✅ | Automático; si se anula después, la venta se reversa (`vigente = NO`). |
| Dashboard con filtro de fechas | ✅ | Ingresos, ventas, ticket promedio, pendientes, cancelados y anulados, cumplimiento, tiempo de despacho, tendencia diaria, top productos, top clientes, tipo de entrega. Exporta CSV. |
| Enlace del formulario, copiar y QR | ✅ | Más descarga del QR en PNG, cartel imprimible y código para incrustar en una web (iframe). |
| Carrito: agregar, modificar, eliminar, anexar | ✅ | Se conserva si el cliente cierra la página (almacenamiento local). |
| Datos del cliente: recoger o domicilio | ✅ | Dirección obligatoria solo si es domicilio; el negocio decide qué modalidades ofrece. |
| Pantalla de confirmación antes de enviar | ✅ | Permite volver a editar el carrito o los datos. |
| Número único y enlace de seguimiento | ✅ | Consecutivo por empresa (`P-000123`, el prefijo es configurable) y token secreto en el enlace. |
| Copiar, correo, WhatsApp con enlace | ✅ | En la pantalla de éxito, en la página de seguimiento y en el panel (WhatsApp directo al cliente). |
| Repetir pedidos anteriores | ✅ | Desde "Mis pedidos" (historial en ese dispositivo) o desde el enlace de seguimiento. |
| Correo de confirmación automático | ✅ | Además: correo al negocio por cada pedido nuevo y al cliente en cada cambio de estado (configurable). |
| Consola SaaS: empresas, planes, suscripciones, activar o suspender, facturación | ✅ | Prueba gratuita, emisión mensual o anual, recordatorio, suspensión tras días de gracia y reactivación al registrar el pago. |
| Límites por plan | ✅ | Productos, usuarios y pedidos por mes. |
| Usuarios por empresa | ✅ | Roles ADMIN y OPERADOR. |

**Seguridad incluida:**

- Claves con hash y *salt*, y bloqueo tras 5 intentos fallidos.
- Precios y totales recalculados en el servidor: el navegador no puede alterar los precios.
- Protección contra inyección de fórmulas en Sheets.
- Anti-spam en el formulario (campo trampa y límite de pedidos por teléfono).
- Enlaces de seguimiento con un token que no se puede adivinar.
- Auditoría de las acciones de la consola.

## 3. Lo que no está en tu alcance y te sugiero considerar

### Prioridad alta (afecta la venta del producto)

1. **Inventario numérico.** "Sin existencias" hoy es reactivo: el negocio lo marca después de recibir el
   pedido. Con un campo de stock que se descuente al despachar y que marque el producto como agotado al
   llegar a 0, se evitan pedidos imposibles de cumplir.
2. **Precios B2B.** Listas de precios por tipo de cliente, descuentos por volumen, cantidad mínima y
   múltiplos de empaque (por ejemplo, solo cajas de 12). Es lo que distingue un catálogo B2B de una
   tienda B2C.
3. **Datos tributarios del comprador.** NIT o cédula, razón social y forma de pago (contado, crédito
   a 30 días, transferencia). Son necesarios para vender a crédito y para facturar.
4. **Ley 1581 de 2012 (habeas data).** El formulario recoge datos personales. Debe tener una casilla de
   autorización y enlazar la política de tratamiento de datos de cada negocio. El campo "Condiciones" de
   la configuración ya obliga a aceptarlas; falta redactar una política modelo.
5. **Despacho parcial y edición del pedido por el negocio.** Si solo falta un producto, hoy el pedido
   completo queda en "Sin existencias". Conviene que el negocio pueda ajustar cantidades o quitar
   productos (con historial) y despachar el resto.

### Prioridad media

6. **Pagos en línea en el formulario.** Pago anticipado con Wompi o Mercado Pago, y el estado
   "Pagado" separado de "Despachado".
7. **Zonas y horarios de domicilio.** Tarifas por barrio o ciudad, horario de atención y mensaje
   automático fuera de horario.
8. **Notificaciones automáticas por WhatsApp.** API de WhatsApp Business como complemento de pago (ver §1).
9. **Registro autónomo de empresas.** Una página donde el negocio se registre, elija plan y pague, sin
    que tú tengas que crearlo a mano. Es clave para escalar las ventas.
10. **Variantes de producto y varias imágenes.** Tallas, sabores o colores con su propio precio.
11. **Clientes registrados.** Un inicio de sesión ligero (código por correo o WhatsApp) para ver su
    historial desde cualquier dispositivo. Hoy "Mis pedidos" vive en el navegador.
12. **Guía de despacho o comanda imprimible por pedido**, y asignación de domiciliario.

### Prioridad baja

13. Respaldo automático semanal de cada empresa (copia del Spreadsheet).
14. Indicadores SaaS adicionales: cancelación de clientes (*churn*), ingreso promedio por empresa y
    clientes en riesgo (empresas sin pedidos en 15 días).
15. Dominio propio o marca blanca (ver §4).

## 4. Límites técnicos de Google Apps Script (tenlos en cuenta al vender)

| Límite | Valor aproximado | Impacto |
|---|---|---|
| Correos por día | 100 (Gmail gratuito) / 1.500 (Workspace) | Se comparte entre **todas** las empresas. Usa Workspace y, al crecer, un servicio de correo transaccional (SendGrid, Brevo). |
| Ejecuciones simultáneas | ~30 por usuario | Picos de muchos pedidos al mismo tiempo pueden hacer esperar a algunos clientes. |
| Tiempo por ejecución | 6 min | No afecta el uso normal; sí los reportes con años de datos. |
| Tamaño de Google Sheets | 10 millones de celdas por archivo | Unos 300.000 pedidos por empresa; el rendimiento baja antes de llegar ahí. |
| Velocidad | 1–3 s por operación | Aceptable para pymes; no para cientos de pedidos por minuto. |
| URL y aviso de Google | `script.google.com/...` y, en cuentas que no son Workspace, el aviso "creado por otro usuario" | Incrusta el formulario en Google Sites o en tu dominio y usa `fijarUrlPublica()`. |

**Recomendación:** Apps Script es ideal para validar el producto y atender de decenas a algunos cientos
de empresas pequeñas. Define un umbral (por ejemplo, más de 500 pedidos diarios por empresa o más de 300
empresas) para migrar la capa de datos a Firestore o Cloud SQL. La interfaz y la lógica se pueden
reutilizar casi completas, porque el acceso a datos está aislado en `Db.js`.

Todos los datos quedan en el Drive de la cuenta que despliega la aplicación. Usa una cuenta de
Workspace de tu empresa SaaS, nunca una cuenta personal, e incluye esto en tus términos de servicio
con los negocios.
