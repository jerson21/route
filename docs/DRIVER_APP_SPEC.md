# App de Conductores - Especificacion Tecnica

## Resumen

App movil para conductores que permite ejecutar rutas de entrega con tracking GPS en tiempo real, captura de pruebas de entrega y notificaciones a clientes.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                        APP CONDUCTOR                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │   Login      │ │   Rutas      │ │   Ejecucion de Ruta      │ │
│  │   Screen     │ │   Lista      │ │   - Mapa + GPS           │ │
│  │              │ │              │ │   - Lista paradas        │ │
│  │              │ │              │ │   - Captura firma/foto   │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ HTTPS + JWT
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     API BACKEND                                  │
│                  /api/v1/...                                     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │   Auth       │ │   Routes     │ │   Tracking               │ │
│  │   /login     │ │   /routes    │ │   /location              │ │
│  │   /refresh   │ │   /stops     │ │   /in-transit            │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     POSTGRESQL                                   │
│   Routes, Stops, TrackingPoints, Users                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Pantallas de la App

### 1. Login

**Funcionalidad:**
- Campo email
- Campo password
- Boton "Iniciar Sesion"
- Guardar token en almacenamiento seguro

**Flujo:**
```
Usuario ingresa credenciales
    ↓
POST /api/v1/auth/login
    ↓
Guardar accessToken + refreshToken
    ↓
Navegar a Lista de Rutas
```

### 2. Lista de Rutas

**Muestra:**
- Rutas asignadas para hoy
- Estado de cada ruta (Programada, En Progreso, Completada)
- Cantidad de paradas
- Hora programada

**Filtros:**
- Por fecha
- Por estado

**Flujo:**
```
GET /api/v1/routes?driverId={userId}&status=SCHEDULED,IN_PROGRESS
    ↓
Mostrar lista de rutas
    ↓
Click en ruta → Ver Detalle
```

### 3. Detalle de Ruta

**Informacion:**
- Nombre de ruta
- Bodega de origen
- Total de paradas
- Distancia total
- Duracion estimada
- Hora de retorno a bodega

**Lista de Paradas:**
- Numero de secuencia
- Direccion + Unit
- Nombre del destinatario
- Estado (Pendiente, En Transito, Completada, Fallida)
- ETA original vs actual
- Icono de ventana de tiempo si aplica

**Acciones:**
- "Cargar Camion" (si SCHEDULED)
- "Iniciar Ruta" (si cargado)
- Ver mapa completo

### 4. Mapa de Ruta

**Elementos:**
- Mapa con todas las paradas
- Linea de ruta optima
- Ubicacion actual del conductor (punto azul)
- Marcadores de paradas con numero
- Marcador de bodega (inicio/fin)

**Interacciones:**
- Click en marcador → Ver detalle de parada
- Centrar en ubicacion actual
- Ver siguiente parada

### 5. Vista de Parada Activa

**Informacion:**
- Direccion completa + Unit
- Nombre y telefono del destinatario
- Notas de entrega
- Productos/paquetes
- Codigos de barras
- Tiempo restante ETA

**Acciones:**
1. **"Voy en Camino"** - Notifica al cliente
2. **"Llegue"** - Marca llegada
3. **"Completar"** - Abre pantalla de prueba de entrega
4. **"Fallo"** - Abre motivos de falla

### 6. Prueba de Entrega

**Campos:**
- Captura de firma (canvas tactil)
- Captura de foto (camara)
- Notas adicionales

**Validaciones:**
- Si `requireSignature = true` → Firma obligatoria
- Si `requirePhoto = true` → Foto obligatoria

### 7. Fallo de Entrega

**Motivos predefinidos:**
- No habia nadie
- Direccion incorrecta
- Rechazo del cliente
- Paquete danado
- Otro (campo libre)

---

## API Endpoints para Conductor

### Autenticacion

#### POST /api/v1/auth/login
Iniciar sesion.

**Request:**
```json
{
  "email": "chofer@routeoptimizer.com",
  "password": "chofer123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "chofer@routeoptimizer.com",
      "firstName": "Carlos",
      "lastName": "Gonzalez",
      "role": "DRIVER"
    },
    "accessToken": "eyJhbG...",
    "refreshToken": "eyJhbG..."
  }
}
```

#### POST /api/v1/auth/refresh
Renovar access token.

**Request:**
```json
{
  "refreshToken": "eyJhbG..."
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbG...",
    "refreshToken": "eyJhbG..."
  }
}
```

#### GET /api/v1/auth/me
Obtener perfil actual.

**Headers:**
```
Authorization: Bearer {accessToken}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "chofer@routeoptimizer.com",
    "firstName": "Carlos",
    "lastName": "Gonzalez",
    "role": "DRIVER",
    "isActive": true
  }
}
```

---

### Rutas

#### GET /api/v1/routes
Listar rutas asignadas.

**Query Params:**
| Param | Tipo | Descripcion |
|-------|------|-------------|
| status | string | SCHEDULED,IN_PROGRESS,COMPLETED |
| date | string | YYYY-MM-DD |
| page | number | Pagina (default: 1) |
| limit | number | Por pagina (default: 20) |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "route-uuid",
      "name": "Ruta Centro AM",
      "status": "SCHEDULED",
      "scheduledDate": "2024-01-15T08:00:00Z",
      "totalDistanceKm": 45.2,
      "totalDurationMin": 180,
      "stops": [{ "id": "..." }],
      "depot": {
        "name": "Bodega Central"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5
  }
}
```

#### GET /api/v1/routes/:id
Obtener detalle completo de ruta.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "route-uuid",
    "name": "Ruta Centro AM",
    "status": "IN_PROGRESS",
    "scheduledDate": "2024-01-15T08:00:00Z",
    "startedAt": "2024-01-15T08:32:00Z",
    "loadedAt": "2024-01-15T08:15:00Z",
    "completedAt": null,
    "totalDistanceKm": 45.2,
    "totalDurationMin": 180,
    "depotReturnTime": "2024-01-15T14:00:00Z",
    "originLatitude": -33.4569,
    "originLongitude": -70.6483,
    "originAddress": "Av. Principal 100, Santiago",
    "driverLatitude": -33.4200,
    "driverLongitude": -70.6100,
    "driverLocationAt": "2024-01-15T10:15:00Z",
    "driverHeading": 180,
    "driverSpeed": 45.5,
    "assignedTo": {
      "id": "driver-uuid",
      "firstName": "Carlos",
      "lastName": "Gonzalez",
      "phone": "+56912345678"
    },
    "depot": {
      "id": "depot-uuid",
      "name": "Bodega Central",
      "address": "Av. Principal 100",
      "latitude": -33.4569,
      "longitude": -70.6483
    },
    "stops": [
      {
        "id": "stop-uuid",
        "sequenceOrder": 1,
        "status": "COMPLETED",
        "stopType": "DELIVERY",
        "recipientName": "Juan Perez",
        "recipientPhone": "+56987654321",
        "recipientEmail": "juan@email.com",
        "requireSignature": true,
        "requirePhoto": false,
        "proofEnabled": true,
        "packageCount": 2,
        "orderNotes": "Tocar timbre 2 veces",
        "travelMinutesFromPrevious": 15,
        "estimatedArrival": "2024-01-15T08:45:00Z",
        "originalEstimatedArrival": "2024-01-15T08:47:00Z",
        "arrivedAt": "2024-01-15T08:48:00Z",
        "completedAt": "2024-01-15T09:02:00Z",
        "notes": "Entregado OK",
        "signatureUrl": null,
        "photoUrl": null,
        "address": {
          "id": "address-uuid",
          "fullAddress": "Calle Ejemplo 456, Providencia",
          "unit": "Depto 501",
          "latitude": -33.4280,
          "longitude": -70.6100,
          "notes": "Edificio color rojo"
        }
      }
    ]
  }
}
```

---

### Ejecucion de Ruta

#### POST /api/v1/routes/:id/load
Marcar camion cargado.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "route-uuid",
    "loadedAt": "2024-01-15T08:15:00Z"
  }
}
```

#### POST /api/v1/routes/:id/start
Iniciar ruta.

**Efectos:**
- Cambia status a IN_PROGRESS
- Congela ETAs originales
- Envia webhook a todos los clientes

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "route-uuid",
    "status": "IN_PROGRESS",
    "startedAt": "2024-01-15T08:32:00Z"
  }
}
```

#### POST /api/v1/routes/:id/location
Actualizar ubicacion GPS.

**Request:**
```json
{
  "latitude": -33.4200,
  "longitude": -70.6100,
  "heading": 180,
  "speed": 45.5,
  "accuracy": 10
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "driverLatitude": -33.4200,
    "driverLongitude": -70.6100,
    "driverLocationAt": "2024-01-15T10:15:00Z"
  }
}
```

**Nota:** Llamar cada 30-60 segundos mientras la ruta esta en progreso.

#### POST /api/v1/routes/:id/complete
Completar ruta completa.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "route-uuid",
    "status": "COMPLETED",
    "completedAt": "2024-01-15T14:30:00Z"
  }
}
```

---

### Paradas

#### POST /api/v1/routes/:id/stops/:stopId/in-transit
Notificar que va en camino.

**Efectos:**
- Cambia status a IN_TRANSIT
- Envia webhook al cliente con ETA

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "stop-uuid",
    "status": "IN_TRANSIT"
  }
}
```

#### POST /api/v1/routes/:id/stops/:stopId/arrive
Marcar llegada.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "stop-uuid",
    "status": "ARRIVED",
    "arrivedAt": "2024-01-15T09:15:00Z"
  }
}
```

#### POST /api/v1/routes/:id/stops/:stopId/complete
Completar parada.

**Request:**
```json
{
  "status": "COMPLETED",
  "notes": "Entregado sin problemas",
  "signatureUrl": "https://storage.../signature.png",
  "photoUrl": "https://storage.../photo.jpg"
}
```

**Request (Fallida):**
```json
{
  "status": "FAILED",
  "failureReason": "No habia nadie en el domicilio"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "stop-uuid",
    "status": "COMPLETED",
    "completedAt": "2024-01-15T09:32:00Z"
  }
}
```

---

## Estados de Ruta

```
DRAFT → SCHEDULED → IN_PROGRESS → COMPLETED
                 ↘               ↗
                   CANCELLED
```

| Estado | Descripcion | Visible para Conductor |
|--------|-------------|------------------------|
| DRAFT | Borrador, sin optimizar | No |
| SCHEDULED | Programada, lista para ejecutar | Si |
| IN_PROGRESS | En ejecucion | Si |
| COMPLETED | Finalizada | Si (historial) |
| CANCELLED | Cancelada | No |

## Estados de Parada

```
PENDING → IN_TRANSIT → ARRIVED → COMPLETED
                             ↘   ↗
                              FAILED / SKIPPED
```

| Estado | Descripcion |
|--------|-------------|
| PENDING | Pendiente de visitar |
| IN_TRANSIT | Conductor en camino (cliente notificado) |
| ARRIVED | Conductor llego al punto |
| COMPLETED | Entregado exitosamente |
| FAILED | No se pudo entregar |
| SKIPPED | Se salto (reagendar) |

---

## Tracking GPS

### Frecuencia de Actualizacion

| Escenario | Frecuencia |
|-----------|------------|
| En movimiento (>10 km/h) | Cada 30 segundos |
| Detenido o lento (<10 km/h) | Cada 60 segundos |
| Bateria baja (<20%) | Cada 120 segundos |

### Datos a Enviar

```json
{
  "latitude": -33.4200,
  "longitude": -70.6100,
  "heading": 180,
  "speed": 45.5,
  "accuracy": 10
}
```

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| latitude | number | Latitud GPS |
| longitude | number | Longitud GPS |
| heading | number | Direccion en grados (0-360) |
| speed | number | Velocidad en km/h |
| accuracy | number | Precision en metros |

---

## Manejo de Errores

### Codigos HTTP

| Codigo | Significado |
|--------|-------------|
| 200 | OK |
| 400 | Bad Request - Datos invalidos |
| 401 | Unauthorized - Token invalido |
| 403 | Forbidden - Sin permisos |
| 404 | Not Found - Recurso no existe |
| 500 | Server Error |

### Formato de Error

```json
{
  "success": false,
  "error": {
    "code": "ROUTE_NOT_FOUND",
    "message": "La ruta no existe o no tienes acceso"
  }
}
```

### Renovacion de Token

Si recibes 401, intenta renovar el token:

```javascript
async function refreshToken() {
  const response = await fetch('/api/v1/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken: stored.refreshToken })
  });

  if (response.ok) {
    const { data } = await response.json();
    // Guardar nuevos tokens
    saveTokens(data.accessToken, data.refreshToken);
    return true;
  }

  // Si falla, redirigir a login
  navigateToLogin();
  return false;
}
```

---

## Modo Offline

### Estrategia

1. **Cache de Ruta Activa:**
   - Guardar detalle completo de ruta al iniciar
   - Incluir todas las paradas con direcciones

2. **Cola de Actualizaciones:**
   - Guardar actualizaciones de ubicacion
   - Guardar completaciones de paradas
   - Enviar cuando vuelva conexion

3. **Sincronizacion:**
   - Al recuperar conexion, enviar cola en orden
   - Validar respuestas
   - Mostrar errores si hay conflictos

### Estructura de Cola

```javascript
const offlineQueue = [
  {
    type: 'LOCATION_UPDATE',
    timestamp: '2024-01-15T10:15:00Z',
    data: { latitude: -33.42, longitude: -70.61, ... }
  },
  {
    type: 'STOP_COMPLETE',
    timestamp: '2024-01-15T10:32:00Z',
    data: { stopId: 'uuid', status: 'COMPLETED', ... }
  }
];
```

---

## Stack Tecnologico Recomendado

### Opcion A: React Native

```
react-native
├── @react-navigation/native       # Navegacion
├── react-native-maps              # Mapas
├── @react-native-async-storage    # Almacenamiento
├── react-native-geolocation       # GPS
├── react-native-signature-canvas  # Captura de firma
├── react-native-camera            # Camara
├── axios                          # HTTP Client
└── zustand                        # Estado
```

### Opcion B: Flutter

```
flutter
├── go_router                      # Navegacion
├── google_maps_flutter            # Mapas
├── geolocator                     # GPS
├── signature_pad                  # Captura de firma
├── camera                         # Camara
├── dio                            # HTTP Client
└── riverpod                       # Estado
```

---

## Permisos Requeridos

### Android

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
```

### iOS

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Necesitamos tu ubicacion para el tracking de entregas</string>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Necesitamos tu ubicacion en segundo plano para el tracking de entregas</string>

<key>NSCameraUsageDescription</key>
<string>Necesitamos la camara para capturar pruebas de entrega</string>

<key>UIBackgroundModes</key>
<array>
    <string>location</string>
</array>
```

---

## Endpoints Faltantes (Por Implementar)

### 1. Upload de Prueba de Entrega

```
POST /api/v1/routes/:id/stops/:stopId/upload-proof
Content-Type: multipart/form-data

signature: (file)
photo: (file)
```

### 2. Historial de Rutas

```
GET /api/v1/routes/history?from=2024-01-01&to=2024-01-31
```

### 3. Estadisticas del Conductor

```
GET /api/v1/users/me/stats?period=week
{
  "completedDeliveries": 45,
  "failedDeliveries": 3,
  "avgTimePerStop": 12.5,
  "totalDistanceKm": 320
}
```

---

## Webhooks (Salientes)

El sistema envia webhooks cuando ocurren eventos. Los clientes reciben notificaciones en tiempo real.

| Evento | Cuando |
|--------|--------|
| route.started | Conductor inicia ruta |
| stop.in_transit | Conductor va en camino a parada |
| stop.completed | Parada completada |
| eta.updated | ETA recalculado |

---

## Ejemplo de Flujo Completo

```
1. Conductor inicia app
   └── POST /auth/login

2. Ver rutas del dia
   └── GET /routes?status=SCHEDULED,IN_PROGRESS

3. Seleccionar ruta
   └── GET /routes/:id

4. Cargar camion
   └── POST /routes/:id/load

5. Iniciar ruta
   └── POST /routes/:id/start

6. Loop de tracking (cada 30s)
   └── POST /routes/:id/location

7. Para cada parada:
   a. POST /routes/:id/stops/:stopId/in-transit
   b. Navegar al destino
   c. POST /routes/:id/stops/:stopId/arrive
   d. Entregar paquete
   e. POST /routes/:id/stops/:stopId/complete

8. Al terminar ultima parada
   └── POST /routes/:id/complete
```
