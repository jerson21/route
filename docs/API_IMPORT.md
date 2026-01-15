# API de Importación de Rutas

## Endpoint

```
POST /api/v1/routes/import
```

## Autenticación

Requiere JWT token con rol `ADMIN` u `OPERATOR`.

```
Authorization: Bearer <tu_token>
```

---

## Request Body

```json
{
  "route": {
    "name": "Ruta 123 - 2024-01-15 (Despachador)",
    "scheduledDate": "2024-01-15",
    "description": "Descripción opcional",
    "externalId": "123",
    "depotId": "uuid-del-depot"
  },
  "stops": [
    {
      "address": {
        "fullAddress": "Av. Providencia 1234, Providencia, Santiago",
        "unit": "Depto 501",
        "latitude": -33.4256,
        "longitude": -70.6097
      },
      "customer": {
        "name": "Juan Pérez",
        "phone": "912345678",
        "externalId": "12345678-9"
      },
      "order": {
        "orderId": "ORD-12345",
        "products": ["Producto 1", "Producto 2"],
        "notes": "Tocar timbre 2 veces",
        "sellerName": "RespaldosChile - DOMICILIO",
        "packageCount": 3
      },
      "timeWindowStart": "09:00",
      "timeWindowEnd": "12:00",
      "priority": 0,
      "estimatedMinutes": 15
    }
  ],
  "options": {
    "autoOptimize": false,
    "assignToDriverId": null
  }
}
```

---

## Campos

### route (requerido)

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `name` | string | ✅ | Nombre de la ruta |
| `scheduledDate` | string | ❌ | Fecha programada (YYYY-MM-DD) |
| `description` | string | ❌ | Descripción de la ruta |
| `externalId` | string | ❌ | ID externo para mapeo (tu ID de ruta) |
| `depotId` | string | ❌ | UUID del depot de salida |

### stops[] (requerido, mínimo 1)

#### address (requerido)

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `fullAddress` | string | ✅ | Dirección completa (se geocodifica automáticamente si no se envían coordenadas) |
| `unit` | string | ❌ | Depto, Of., Casa, Local, etc. |
| `latitude` | number | ❌ | Latitud (si se envía junto con longitude, se omite el geocoding) |
| `longitude` | number | ❌ | Longitud (si se envía junto con latitude, se omite el geocoding) |

#### customer (opcional)

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `name` | string | ❌ | Nombre del cliente |
| `phone` | string | ❌ | Teléfono del cliente |
| `externalId` | string | ❌ | RUT, código de cliente, etc. |

#### order (requerido)

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `orderId` | string | ✅ | **ID único para mapear de vuelta** (num_orden, AGENCIA-XXX) |
| `products` | string[] | ❌ | Lista de productos/descripción |
| `notes` | string | ❌ | Notas de entrega |
| `sellerName` | string | ❌ | Nombre del vendedor/tipo |
| `packageCount` | number | ❌ | Cantidad de paquetes (default: 1) |

#### Campos opcionales de parada

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `timeWindowStart` | string | Hora inicio ventana (HH:mm) |
| `timeWindowEnd` | string | Hora fin ventana (HH:mm) |
| `priority` | number | Prioridad (0 = normal, mayor = más prioritario) |
| `estimatedMinutes` | number | Minutos estimados en parada (default: 15) |

### options (opcional)

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `autoOptimize` | boolean | Auto-optimizar ruta después de crear |
| `assignToDriverId` | string | UUID del conductor a asignar |

---

## Response

### Éxito (201 Created)

```json
{
  "success": true,
  "data": {
    "routeId": "550e8400-e29b-41d4-a716-446655440000",
    "routeName": "Ruta 123 - 2024-01-15",
    "externalId": "123",
    "status": "DRAFT",
    "stops": [
      {
        "orderId": "ORD-12345",
        "stopId": "660e8400-e29b-41d4-a716-446655440001",
        "addressId": "770e8400-e29b-41d4-a716-446655440002",
        "geocodeSuccess": true
      },
      {
        "orderId": "AGENCIA-CHIX-001",
        "stopId": "660e8400-e29b-41d4-a716-446655440003",
        "addressId": "770e8400-e29b-41d4-a716-446655440004",
        "geocodeSuccess": true
      }
    ],
    "summary": {
      "total": 2,
      "created": 2,
      "failed": 0,
      "geocodeFailed": 0
    }
  }
}
```

### Error (400 Bad Request)

```json
{
  "success": false,
  "error": "stops.0.order.orderId: Required"
}
```

---

## Ejemplo PHP Completo

```php
<?php
// Configuración
$apiUrl = 'https://tu-dominio.com/api/v1';
$token = 'tu_jwt_token';

// Construir datos de importación
$importData = [
    'route' => [
        'name' => sprintf('Ruta %s - %s (%s)', $routeId, $fecha, $despachador),
        'scheduledDate' => $fecha, // YYYY-MM-DD
        'externalId' => (string)$routeId
    ],
    'stops' => []
];

// Agregar domicilios
foreach ($domiciliosAgrupados as $numOrden => $grupo) {
    $parada = $grupo['parada'];

    // Construir dirección completa
    $direccion = trim($parada['pedido_direccion']);
    if ($parada['pedido_numero']) {
        $direccion .= ' ' . $parada['pedido_numero'];
    }
    if ($parada['pedido_comuna']) {
        $direccion .= ', ' . $parada['pedido_comuna'];
    }
    if ($parada['pedido_region']) {
        $direccion .= ', ' . $parada['pedido_region'];
    }

    // Obtener productos
    $productosArray = [];
    foreach ($productos as $prod) {
        $productosArray[] = sprintf(
            "%s %s %s %s %s (Cant: %d)",
            $prod['id'],
            $prod['modelo'] ?: '',
            $prod['tamano'] ?: '',
            $prod['tipotela'] ?: '',
            $prod['color'] ?: '',
            $prod['cantidad'] ?: 1
        );
    }

    $importData['stops'][] = [
        'address' => [
            'fullAddress' => $direccion,
            'unit' => $parada['pedido_dpto'] ?: null
        ],
        'customer' => [
            'name' => $parada['cliente_nombre'] ?: 'Sin nombre',
            'phone' => $parada['cliente_telefono'] ?: null,
            'externalId' => $parada['pedido_rut'] ?: null
        ],
        'order' => [
            'orderId' => (string)$numOrden,
            'products' => $productosArray,
            'sellerName' => 'RespaldosChile - DOMICILIO',
            'packageCount' => count($productos)
        ]
    ];
}

// Agregar agencias
foreach ($agenciasProcesadas as $parada) {
    $direccionAgencia = trim($parada['agencia_direccion'] ?: '');
    if ($parada['agencia_comuna']) {
        $direccionAgencia .= ', ' . $parada['agencia_comuna'];
    }
    if ($parada['agencia_region']) {
        $direccionAgencia .= ', ' . $parada['agencia_region'];
    }

    $importData['stops'][] = [
        'address' => [
            'fullAddress' => $direccionAgencia ?: 'Agencia ' . $parada['agencia_nombre']
        ],
        'customer' => [
            'name' => $parada['agencia_nombre'],
            'phone' => $parada['agencia_telefono'] ?: null,
            'externalId' => $parada['agencia_codigo_full']
        ],
        'order' => [
            'orderId' => 'AGENCIA-' . $parada['agencia_codigo_full'],
            'products' => $productosAgencia,
            'sellerName' => 'RespaldosChile - AGENCIA',
            'packageCount' => count($productosAgencia)
        ]
    ];
}

// Enviar a Route Optimizer
$curl = curl_init();
curl_setopt_array($curl, [
    CURLOPT_URL => $apiUrl . '/routes/import',
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_ENCODING => '',
    CURLOPT_MAXREDIRS => 10,
    CURLOPT_TIMEOUT => 120, // 2 minutos por geocoding
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
    CURLOPT_CUSTOMREQUEST => 'POST',
    CURLOPT_POSTFIELDS => json_encode($importData),
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . $token
    ],
    CURLOPT_SSL_VERIFYPEER => false,
]);

$response = curl_exec($curl);
$httpCode = curl_getinfo($curl, CURLINFO_HTTP_CODE);

if ($response === false) {
    throw new Exception('Error de conexión: ' . curl_error($curl));
}

curl_close($curl);

$result = json_decode($response, true);

if ($httpCode !== 201 || !$result['success']) {
    throw new Exception('Error en importación: ' . ($result['error'] ?? $response));
}

// Guardar mapeo en tu base de datos
$routeOptimizerId = $result['data']['routeId'];

// Actualizar tu tabla de rutas
$updateRutaStmt = $conexion->prepare("
    UPDATE rutas SET id_route_optimizer = ? WHERE id = ?
");
$updateRutaStmt->execute([$routeOptimizerId, $routeId]);

// Actualizar cada parada con su stopId
foreach ($result['data']['stops'] as $stopMapping) {
    $orderId = $stopMapping['orderId'];
    $stopId = $stopMapping['stopId'];

    if (strpos($orderId, 'AGENCIA-') === 0) {
        // Es una agencia
        $agenciaCodigo = str_replace('AGENCIA-', '', $orderId);
        $updateStmt = $conexion->prepare("
            UPDATE pedido_detalle
            SET id_route_optimizer = ?
            WHERE agencia_envio = ? AND ruta_asignada = ?
        ");
        $updateStmt->execute([$stopId, $agenciaCodigo, $routeId]);
    } else {
        // Es un domicilio (num_orden)
        $updateStmt = $conexion->prepare("
            UPDATE pedido_detalle
            SET id_route_optimizer = ?
            WHERE num_orden = ? AND ruta_asignada = ?
        ");
        $updateStmt->execute([$stopId, $orderId, $routeId]);
    }
}

// Respuesta exitosa
echo json_encode([
    'success' => true,
    'routeOptimizerId' => $routeOptimizerId,
    'stopsCreated' => $result['data']['summary']['created'],
    'geocodeFailed' => $result['data']['summary']['geocodeFailed']
]);
```

---

## Notas Importantes

1. **Geocoding**: Las direcciones se geocodifican automáticamente. Si falla el geocoding, la parada se crea igual pero `geocodeSuccess` será `false`.

2. **Coordenadas opcionales**: Si ya tienes latitud y longitud en tu BD, envíalas en el campo `address` para evitar el geocoding. Esto acelera significativamente la importación y evita consumir cuota de Google Maps API.

3. **Direcciones duplicadas**: Si una dirección ya existe en el sistema (por `fullAddress`), se reutiliza (no se duplica).

4. **orderId es clave**: El campo `orderId` es tu identificador único. Úsalo para mapear los `stopId` de vuelta a tu sistema.

5. **Timeout**: El endpoint puede tardar si hay muchas paradas (100ms por parada para geocoding). Si envías coordenadas, es casi instantáneo. Usa timeout de 2+ minutos para estar seguro.

6. **Estado inicial**: La ruta se crea en estado `DRAFT`. Luego puedes:
   - Optimizarla: `POST /routes/{routeId}/optimize`
   - Asignar conductor: `POST /routes/{routeId}/assign`
   - Enviar al conductor: `POST /routes/{routeId}/send`

---

## Obtener Orden Optimizado

Después de optimizar la ruta, puedes obtener el orden final para sincronizar con tu base de datos:

```
GET /api/v1/routes/{routeId}/optimized-order
Authorization: Bearer <tu_token>
```

### Response

```json
{
  "success": true,
  "data": {
    "routeId": "550e8400-e29b-41d4-a716-446655440000",
    "routeName": "Ruta 123 - 2024-01-15",
    "status": "DRAFT",
    "totalStops": 5,
    "stops": [
      {
        "position": 1,
        "orderId": "ORD-12345",
        "stopId": "660e8400-e29b-41d4-a716-446655440001",
        "sequenceOrder": 1,
        "status": "PENDING",
        "address": "Av. Providencia 1234, Santiago",
        "customerName": "Juan Pérez",
        "eta": "2024-01-15T09:30:00Z"
      },
      {
        "position": 2,
        "orderId": "ORD-67890",
        "stopId": "660e8400-e29b-41d4-a716-446655440002",
        "sequenceOrder": 2,
        "status": "PENDING",
        "address": "Las Condes 567, Santiago",
        "customerName": "María López",
        "eta": "2024-01-15T10:15:00Z"
      }
    ]
  }
}
```

### Ejemplo PHP para Sincronizar Orden

```php
<?php
// Después de importar y optimizar, obtener el nuevo orden
$curl = curl_init();
curl_setopt_array($curl, [
    CURLOPT_URL => $apiUrl . '/routes/' . $routeOptimizerId . '/optimized-order',
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . $token
    ],
]);

$response = curl_exec($curl);
curl_close($curl);

$result = json_decode($response, true);

if ($result['success']) {
    foreach ($result['data']['stops'] as $stop) {
        $orderId = $stop['orderId'];
        $position = $stop['position'];

        // Actualizar tu base de datos con el nuevo orden
        if (strpos($orderId, 'AGENCIA-') === 0) {
            // Es una agencia
            $agenciaCodigo = str_replace('AGENCIA-', '', $orderId);
            $updateStmt = $conexion->prepare("
                UPDATE pedido_detalle
                SET orden_ruta = ?
                WHERE agencia_envio = ? AND ruta_asignada = ?
            ");
            $updateStmt->execute([$position, $agenciaCodigo, $routeId]);
        } else {
            // Es un domicilio (num_orden)
            $updateStmt = $conexion->prepare("
                UPDATE pedido_detalle
                SET orden_ruta = ?
                WHERE num_orden = ? AND ruta_asignada = ?
            ");
            $updateStmt->execute([$position, $orderId, $routeId]);
        }
    }
}
```
