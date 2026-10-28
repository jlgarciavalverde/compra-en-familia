# Requisitos

[← Documentación](README.md) · [README del proyecto](../README.md)

## Usuarios

| Rol | Quién | Puede |
|---|---|---|
| Administrador | Quien crea el hogar con el `SETUP_CODE` | Todo lo de un miembro, más invitar, expulsar y generar enlaces para recuperar el acceso. |
| Miembro | Familiares invitados | Crear y editar listas, comprar, ver precios e historial, gestionar su cuenta y sus avisos. |

## Requisitos funcionales

| ID | Requisito |
|---|---|
| RF-01 | El primer registro exige el `SETUP_CODE` y crea el hogar con su administrador. |
| RF-02 | El administrador invita con un código de un solo uso que caduca a los 7 días. |
| RF-03 | Se pueden crear, renombrar, duplicar, archivar y borrar listas con nombre y emoji. |
| RF-04 | Se añaden productos en texto libre («2 kg patatas, leche»): la app separa cantidad, unidad y nombre y les asigna categoría. |
| RF-05 | Los productos se pueden asignar a una persona, marcar como comprados, editar, borrar y restaurar. |
| RF-06 | Los cambios de una persona aparecen en directo a las demás. |
| RF-07 | La app funciona sin conexión: los cambios se guardan y se envían al volver la red, sin duplicados. |
| RF-08 | El modo tienda ordena la lista por los pasillos de cada supermercado y permite apuntar precios al comprar. |
| RF-09 | Hay un comparador de precios por cadena con historial y precio por unidad. |
| RF-10 | Hay historial de compras y sugerencias de productos habituales. |
| RF-11 | Hay avisos push cuando alguien añade algo, te asigna un producto, empieza a comprar o se completa la lista, según las preferencias de cada uno. |
| RF-12 | Cada usuario puede cambiar su contraseña y ver y cerrar sus sesiones. |
| RF-13 | El acceso se recupera con un enlace de un solo uso que genera el administrador, sin correo. |
| RF-14 | Los datos del hogar se pueden exportar. |
| RF-15 | La app se instala en Android como APK y en cualquier navegador como PWA. |

## Requisitos no funcionales

| ID | Categoría | Requisito |
|---|---|---|
| RNF-01 | Seguridad | Contraseñas con scrypt. Sesiones opacas guardadas como sha256, 90 días con renovación. |
| RNF-02 | Seguridad | CSP estricta, CORS cerrado a los orígenes configurados y límite de peticiones en las rutas de autenticación. |
| RNF-03 | Seguridad | Toda consulta filtra por hogar. Las consultas son preparadas. |
| RNF-04 | Seguridad | Los avisos solo se envían a hosts de push conocidos (protección contra SSRF). |
| RNF-05 | Seguridad | Contenedor sin root, con rootfs de solo lectura, sin capacidades y sin puertos publicados. |
| RNF-06 | Disponibilidad | Copia interna cada 6 h (14 días) y copia semanal del VPS (8 copias). |
| RNF-07 | Rendimiento | Las acciones de la lista se ven al instante en local, sin esperar al servidor. |
| RNF-08 | Accesibilidad | WCAG 2.1 AA, comprobado con axe en los e2e. |
| RNF-09 | Mantenibilidad | TypeScript estricto en los tres paquetes, con tests unitarios (vitest) y e2e (Playwright). |
| RNF-10 | Recursos | Funciona con 512 MiB de RAM y 1 CPU. |

## Fuera de alcance

- Varios hogares en el mismo despliegue.
- Correo electrónico: las invitaciones y la recuperación de acceso van por código o enlace.
- Integración con las APIs de los supermercados: los precios se apuntan a mano o desde el ticket.
