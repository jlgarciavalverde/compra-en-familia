# Flujos principales

## Alta del hogar e invitaciones

```mermaid
sequenceDiagram
  actor A as Administrador
  actor M as Familiar
  participant W as PWA
  participant API
  participant DB as SQLite

  A->>W: Abre la app por primera vez
  W->>API: GET /api/setup-status
  API-->>W: sin inicializar
  A->>W: Nombre, correo, contraseña y SETUP_CODE
  W->>API: POST /api/auth/register
  API->>DB: crea households + users(role=admin)
  API-->>W: token de sesión
  A->>W: Invitar
  W->>API: POST /api/household/invites
  API-->>W: código (un solo uso, 7 días)
  A-->>M: Le pasa el código o el enlace
  M->>W: Abre /unirse/:code
  W->>API: GET /api/invites/:code
  M->>W: Se registra
  W->>API: POST /api/auth/register {inviteCode}
  API->>DB: users(role=member) y marca el código como usado
```

## Cambio sin conexión (outbox)

Cada cambio se aplica al momento sobre la caché local y se envía después con una clave de idempotencia. Si la red falla, se queda en la cola y se reintenta cada 15 s o en cuanto vuelve la conexión.

```mermaid
sequenceDiagram
  actor U as Usuario
  participant UI as Lista (React)
  participant O as Outbox
  participant Q as TanStack Query
  participant API
  participant DB as SQLite
  participant WS as WebSocket

  U->>UI: Tacha «leche»
  UI->>O: encola updateItem {id, at}
  O->>Q: aplica el cambio en la caché (la UI se actualiza ya)
  alt hay red
    O->>API: PATCH /api/items/:id + Idempotency-Key
    API->>DB: ¿clave en applied_mutations?
    alt clave nueva
      API->>DB: actualiza list_items y guarda la clave
      API->>WS: emite el cambio al hogar
    else ya aplicada
      API-->>O: misma respuesta, sin repetir el cambio
    end
    API-->>O: 200
    O->>O: quita la operación de la cola
  else sin red
    O->>O: la guarda (persistida) y marca offline
    Note over O: reintento cada 15 s y al evento online
  end
  WS-->>Q: el resto de dispositivos recargan la lista y ven el cambio
```

## Compra en tienda y precios

```mermaid
flowchart TD
  A[Elegir lista] --> B[Modo tienda: elegir supermercado]
  B --> C[Lista ordenada por pasillos de ese súper]
  C --> D{¿Producto cogido?}
  D -- sí --> E[Tachar]
  E --> F{¿Apuntar precio?}
  F -- sí --> G[PUT /api/prices/manual<br/>store_products + price_history]
  F -- no --> C
  D -- no --> C
  G --> C
  C --> H[Terminar compra]
  H --> I[purchases: historial y sugerencias]
  H --> J[Aviso push «lista completa»]
```

## Avisos push

```mermaid
sequenceDiagram
  participant API
  participant N as Notifier
  participant DB as SQLite
  participant P as Servicio de push
  participant SW as Service worker

  API->>N: evento (añadido, asignado, empieza a comprar, lista completa)
  N->>DB: destinatarios y preferencias (notification_prefs)
  N->>N: agrupa eventos seguidos (ventana corta)
  N->>P: Web Push firmado con VAPID (solo hosts permitidos)
  P->>SW: push
  alt la app está a la vista
    SW->>SW: no muestra el aviso
  else
    SW->>SW: showNotification
  end
```
