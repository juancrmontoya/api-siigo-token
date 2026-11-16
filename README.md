# PedidosPro: catálogo y pedidos B2B (SaaS sobre Google Apps Script)

Microaplicación multiempresa para que cada negocio cliente administre su catálogo, reciba pedidos
mediante un formulario público con carrito, haga seguimiento por estados y analice sus ventas.
Está construida con Google Apps Script (JavaScript), Google Sheets como base de datos, Drive para
imágenes y Gmail/MailApp para notificaciones.

> La revisión del alcance, las decisiones de diseño y las sugerencias están en
> [`docs/ALCANCE.md`](docs/ALCANCE.md).

## Módulos

| Módulo | Ruta | Para quién |
|---|---|---|
| Formulario/catálogo público con carrito | `?page=tienda&e=<empresa>` | Cliente final |
| Seguimiento del pedido | `?page=pedido&e=<empresa>&o=<n°>&k=<token>` | Cliente final |
| Panel administrativo | `?page=admin&e=<empresa>` | Negocio (roles ADMIN / OPERADOR) |
| Consola SaaS | `?page=super` | Tú (proveedor) |

**Panel del negocio:** pendientes por despachar con acumulado por producto (lista de alistamiento
imprimible), pedidos con filtros y cambio de estado individual o masivo, historial de estados,
productos con imagen, ventas efectivas con dashboard (filtro de fechas, KPIs y gráficas),
enlace y QR del formulario, configuración, usuarios y estado de la suscripción.

**Formulario público:** catálogo con búsqueda y categorías, carrito persistente (agregar,
modificar, eliminar, anexar), datos del cliente, recoger o domicilio, pantalla de confirmación,
número de pedido, enlace de seguimiento, copiar pedido, WhatsApp, correo y repetir pedidos anteriores.

**Consola SaaS:** empresas (alta automática con su propio Spreadsheet y carpeta de Drive),
planes y límites, suscripciones, facturación recurrente con suspensión automática por mora,
MRR y auditoría.

## Estructura

```
apps-script/          Código que se sube a Apps Script (clasp rootDir)
  appsscript.json     Manifiesto (web app, permisos)
  Config.js           Constantes: estados, transiciones, esquemas, planes
  Code.js             doGet (enrutador), API pública y del panel, instalar()
  Db.js               Acceso a Sheets como tablas + utilidades
  Tenants.js          Multiempresa y aprovisionamiento
  Auth.js             Login, hash de claves, sesiones
  Products.js         Catálogo e imágenes
  Orders.js           Pedidos, estados, acumulado de pendientes
  Sales.js            Ventas efectivas y dashboard
  Notify.js           Correos HTML
  Billing.js          Facturación recurrente (activador diario)
  Super.js            API de la consola SaaS
  *.html              Interfaces (Admin, Tienda, Seguimiento, Superht, Mensaje, Styles, Common)
tests/simulador.js    Simulador local de servicios de Google + 21 pruebas del flujo completo
docs/ALCANCE.md       Revisión de redacción, alcance y sugerencias
```

## Instalación

1. **Usa una cuenta de Google Workspace dedicada al SaaS** (no tu Gmail personal): los datos de
   todas las empresas quedan en el Drive de esa cuenta y las cuotas de correo son mayores.
2. Crea el proyecto y sube el código con [clasp](https://github.com/google/clasp):
   ```bash
   npm i -g @google/clasp
   clasp login
   clasp create --type webapp --title "PedidosPro" --rootDir apps-script
   clasp push
   ```
   (También puedes crear un proyecto en script.google.com y copiar cada archivo a mano.)
3. En `Config.js` edita `INSTALACION` (tu correo y una clave temporal) y `APP` (nombre, zona horaria).
4. En el editor ejecuta **`instalar()`** y acepta los permisos. Crea la base maestra, la carpeta
   raíz, los planes, tu usuario de la consola y el activador diario de facturación.
5. **Implementar → Nueva implementación → Aplicación web**: *Ejecutar como: Yo*, *Acceso: Cualquier usuario*.
   Copia la URL `/exec`.
6. Abre `URL?page=super`, entra con tu correo y la clave temporal y **cámbiala** (🔑 Mi clave).
7. Crea empresas desde la consola. Opcional: ejecuta `crearEmpresaDemo()` para tener datos de prueba
   (código `demo`, clave `Demo12345`).

Para publicar cambios sin cambiar la URL: *Implementar → Gestionar implementaciones → Editar → Nueva versión*.

Si incrustas el formulario en Google Sites o en tu dominio, ejecuta `fijarUrlPublica('https://...')`
para que los enlaces de seguimiento y el QR apunten a esa dirección.

## Pruebas

```bash
node tests/simulador.js
```

El simulador reemplaza Sheets, Drive, Cache, Lock, Mail y Properties en memoria y recorre el flujo
completo: instalación, alta de empresa, pedidos (envíos, validaciones, anti-spam, inyección de fórmulas),
máquina de estados, ventas efectivas y su reverso, seguimiento con token, repetir y cancelar pedido,
límites del plan, roles y facturación (emisión, suspensión por mora y reactivación al pagar).
