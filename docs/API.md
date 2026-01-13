# Route Optimizer API Documentation

Base URL: `http://localhost:3001/api/v1`

## Authentication

All endpoints (except login/register) require JWT authentication.

### Headers
```
Authorization: Bearer {accessToken}
Content-Type: application/json
```

### Token Lifecycle
- **Access Token**: Short-lived, used for API calls
- **Refresh Token**: Long-lived (7 days), used to get new access tokens

---

## Endpoints

### Auth

#### POST /auth/login
Login with email and password.

**Request:**
```json
{
  "email": "admin@routeoptimizer.com",
  "password": "admin123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "email": "admin@routeoptimizer.com",
      "firstName": "Admin",
      "lastName": "User",
      "role": "ADMIN",
      "phone": "+56912345678",
      "isActive": true
    },
    "accessToken": "eyJhbG...",
    "refreshToken": "eyJhbG..."
  }
}
```

#### POST /auth/register
Create new user account.

**Request:**
```json
{
  "email": "nuevo@empresa.com",
  "password": "password123",
  "firstName": "Juan",
  "lastName": "Perez",
  "role": "DRIVER"
}
```

#### POST /auth/refresh
Refresh access token.

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

#### GET /auth/me
Get current user profile.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "user@example.com",
    "firstName": "User",
    "lastName": "Name",
    "role": "OPERATOR",
    "phone": "+56912345678",
    "isActive": true
  }
}
```

#### POST /auth/logout
Logout and revoke refresh tokens.

---

### Routes

#### GET /routes
List routes with filters.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| status | string | DRAFT, SCHEDULED, IN_PROGRESS, COMPLETED, CANCELLED |
| driverId | uuid | Filter by assigned driver |
| date | string | YYYY-MM-DD format |
| page | number | Page number (default: 1) |
| limit | number | Items per page (default: 20) |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "route-uuid",
      "name": "Ruta Centro AM",
      "description": "Entregas centro historico",
      "status": "SCHEDULED",
      "scheduledDate": "2024-01-15T08:00:00Z",
      "totalDistanceKm": 45.2,
      "totalDurationMin": 180,
      "assignedTo": {
        "id": "driver-uuid",
        "firstName": "Carlos",
        "lastName": "Gonzalez"
      },
      "depot": {
        "id": "depot-uuid",
        "name": "Bodega Central"
      },
      "_count": {
        "stops": 12
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "pages": 3
  }
}
```

#### POST /routes
Create new route.

**Request:**
```json
{
  "name": "Ruta Centro AM",
  "description": "Entregas zona centro",
  "scheduledDate": "2024-01-15T08:00:00Z",
  "depotId": "depot-uuid"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "new-route-uuid",
    "name": "Ruta Centro AM",
    "status": "DRAFT",
    "depot": {
      "id": "depot-uuid",
      "name": "Bodega Central",
      "address": "Av. Principal 100",
      "latitude": -33.4569,
      "longitude": -70.6483
    }
  }
}
```

#### GET /routes/:id
Get route details with stops.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "route-uuid",
    "name": "Ruta Centro AM",
    "status": "IN_PROGRESS",
    "scheduledDate": "2024-01-15T08:00:00Z",
    "departureTime": "08:30",
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
    "optimizedAt": "2024-01-15T07:30:00Z",
    "createdBy": {
      "id": "user-uuid",
      "firstName": "Admin",
      "lastName": "User"
    },
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
      "longitude": -70.6483,
      "defaultDepartureTime": "08:00",
      "defaultServiceMinutes": 15
    },
    "stops": [
      {
        "id": "stop-uuid",
        "sequenceOrder": 1,
        "status": "COMPLETED",
        "stopType": "DELIVERY",
        "estimatedMinutes": 15,
        "priority": 0,
        "timeWindowStart": "2024-01-15T09:00:00Z",
        "timeWindowEnd": "2024-01-15T10:00:00Z",
        "recipientName": "Juan Perez",
        "recipientPhone": "+56987654321",
        "recipientEmail": "juan@email.com",
        "requireSignature": true,
        "requirePhoto": false,
        "proofEnabled": true,
        "clientName": "Empresa ABC",
        "packageCount": 2,
        "products": "[{\"name\":\"Item1\",\"qty\":1}]",
        "externalId": "EXT-12345",
        "barcodeIds": "BARCODE1,BARCODE2",
        "sellerName": "Vendedor SA",
        "orderNotes": "Tocar timbre 2 veces",
        "travelMinutesFromPrevious": 15,
        "estimatedArrival": "2024-01-15T08:45:00Z",
        "originalEstimatedArrival": "2024-01-15T08:47:00Z",
        "arrivedAt": "2024-01-15T08:48:00Z",
        "completedAt": "2024-01-15T09:02:00Z",
        "notes": "Entregado OK",
        "signatureUrl": null,
        "photoUrl": null,
        "failureReason": null,
        "address": {
          "id": "address-uuid",
          "fullAddress": "Calle Ejemplo 456, Providencia",
          "unit": "Depto 501",
          "latitude": -33.4280,
          "longitude": -70.6100,
          "customerName": "Juan Perez",
          "phone": "+56987654321",
          "email": "juan@email.com",
          "notes": "Edificio color rojo"
        }
      }
    ]
  }
}
```

#### PUT /routes/:id
Update route details.

**Request:**
```json
{
  "name": "Ruta Centro PM",
  "description": "Actualizado",
  "departureTime": "14:00",
  "depotId": "new-depot-uuid"
}
```

#### DELETE /routes/:id
Delete route (only DRAFT status).

---

### Route Stops

#### POST /routes/:id/stops
Add stops to route.

**Request:**
```json
{
  "addressIds": ["address-uuid-1", "address-uuid-2", "address-uuid-3"]
}
```

#### GET /routes/:id/stops/:stopId
Get stop details.

#### PUT /routes/:id/stops/:stopId
Update stop configuration.

**Request:**
```json
{
  "stopType": "DELIVERY",
  "estimatedMinutes": 20,
  "priority": 1,
  "timeWindowStart": "2024-01-15T09:00:00Z",
  "timeWindowEnd": "2024-01-15T11:00:00Z",
  "recipientName": "Juan Perez",
  "recipientPhone": "+56987654321",
  "recipientEmail": "juan@email.com",
  "requireSignature": true,
  "requirePhoto": true,
  "proofEnabled": true,
  "clientName": "Empresa ABC",
  "packageCount": 3,
  "products": "[{\"name\":\"Item1\",\"qty\":2}]",
  "externalId": "ORDER-12345",
  "barcodeIds": "BARCODE1,BARCODE2",
  "sellerName": "Vendedor SA",
  "orderNotes": "Llamar antes de llegar",
  "notes": "Notas internas"
}
```

#### DELETE /routes/:id/stops/:stopId
Remove stop from route.

#### PUT /routes/:id/stops/reorder
Reorder stops manually.

**Request:**
```json
{
  "stopIds": ["stop-uuid-3", "stop-uuid-1", "stop-uuid-2"]
}
```

---

### Route Optimization

#### POST /routes/:id/optimize
Optimize route order.

**Request:**
```json
{
  "firstStopId": "stop-uuid-to-force-first",
  "lastStopId": "stop-uuid-to-force-last",
  "useHaversine": false,
  "force": false,
  "driverStartTime": "2024-01-15T08:00:00Z",
  "driverEndTime": "2024-01-15T18:00:00Z"
}
```

**Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| firstStopId | uuid | Force this stop as first |
| lastStopId | uuid | Force this stop as last |
| useHaversine | boolean | Use free Haversine (true) or Google API (false) |
| force | boolean | Re-optimize even if unchanged |
| driverStartTime | datetime | Custom driver start time |
| driverEndTime | datetime | Custom driver end time |

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "route-uuid",
    "stops": [...]
  },
  "optimization": {
    "totalDistance": 45200,
    "totalDuration": 180,
    "totalWaitTime": 15,
    "hasTimeWindows": true,
    "hasPriorityStops": false,
    "usedTraffic": true,
    "depotReturnTime": "2024-01-15T14:00:00Z",
    "returnLegDuration": 25,
    "warnings": [],
    "unserviceableStops": []
  }
}
```

---

### Route Execution

#### POST /routes/:id/assign
Assign driver to route.

**Request:**
```json
{
  "driverId": "driver-uuid"
}
```

#### POST /routes/:id/load
Mark truck as loaded. Changes nothing but sets `loadedAt` timestamp.

#### POST /routes/:id/start
Start route execution.

**Effects:**
- Sets status to IN_PROGRESS
- Sets `startedAt` timestamp
- Freezes original ETAs to `originalEstimatedArrival`
- Sends `route.started` webhook to all customers

#### POST /routes/:id/location
Update driver GPS location.

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

**Note:** Call every 30-60 seconds while route is IN_PROGRESS.

#### GET /routes/:id/driver-location
Get current driver location.

**Response:**
```json
{
  "success": true,
  "data": {
    "latitude": -33.4200,
    "longitude": -70.6100,
    "heading": 180,
    "speed": 45.5,
    "updatedAt": "2024-01-15T10:15:00Z"
  }
}
```

#### POST /routes/:id/complete
Mark entire route as completed.

---

### Stop Execution

#### POST /routes/:id/stops/:stopId/in-transit
Notify customer driver is on the way.

**Effects:**
- Sets stop status to IN_TRANSIT
- Sends `stop.in_transit` webhook with driver location and ETA

#### POST /routes/:id/stops/:stopId/arrive
Mark driver arrived at stop.

**Effects:**
- Sets stop status to ARRIVED
- Sets `arrivedAt` timestamp

#### POST /routes/:id/stops/:stopId/complete
Complete or fail a stop.

**Request (Success):**
```json
{
  "status": "COMPLETED",
  "notes": "Entregado sin problemas",
  "signatureUrl": "https://storage.../signature.png",
  "photoUrl": "https://storage.../photo.jpg"
}
```

**Request (Failed):**
```json
{
  "status": "FAILED",
  "failureReason": "No habia nadie en el domicilio"
}
```

**Request (Skipped):**
```json
{
  "status": "SKIPPED",
  "notes": "Se reagendara para manana"
}
```

**Effects:**
- Updates stop status and timestamps
- Recalculates ETAs for remaining stops
- Sends `stop.completed` webhook
- Auto-completes route if all stops are done

---

### Addresses

#### GET /addresses
List all addresses.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| search | string | Search in fullAddress, customerName |
| page | number | Page number |
| limit | number | Items per page |

#### POST /addresses
Create new address.

**Request:**
```json
{
  "fullAddress": "Av. Providencia 1234, Providencia, Santiago",
  "unit": "Depto 501",
  "latitude": -33.4280,
  "longitude": -70.6100,
  "customerName": "Juan Perez",
  "phone": "+56987654321",
  "email": "juan@email.com",
  "notes": "Edificio color rojo, timbre no funciona"
}
```

#### PUT /addresses/:id
Update address.

#### DELETE /addresses/:id
Delete address.

#### POST /addresses/import-excel
Import addresses from Excel file.

**Request:** `multipart/form-data` with `file` field.

**Excel columns:**
- direccion (required)
- unit (optional)
- cliente (optional)
- telefono (optional)
- email (optional)
- notas (optional)

#### PUT /addresses/:id/location
Adjust address coordinates.

**Request:**
```json
{
  "latitude": -33.4281,
  "longitude": -70.6101
}
```

#### POST /addresses/:id/geocode
Re-geocode address using Google Geocoding API.

---

### Users

#### GET /users
List users (Admin only).

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| role | string | ADMIN, OPERATOR, DRIVER |
| isActive | boolean | Filter by active status |

#### POST /users
Create user (Admin only).

#### PUT /users/:id
Update user (Admin only).

#### DELETE /users/:id
Deactivate user (Admin only).

---

### Depots

#### GET /depots
List all depots.

#### POST /depots
Create depot.

**Request:**
```json
{
  "name": "Bodega Sur",
  "address": "Av. Sur 500, Santiago",
  "latitude": -33.5000,
  "longitude": -70.6500,
  "defaultDepartureTime": "08:00",
  "defaultServiceMinutes": 15
}
```

#### PUT /depots/:id
Update depot.

#### DELETE /depots/:id
Delete depot.

---

### Settings

#### GET /settings
Get all settings.

**Response:**
```json
{
  "success": true,
  "data": {
    "webhook": {
      "enabled": true,
      "url": "https://api.cliente.com/webhooks/route",
      "secret": "webhook-secret-key"
    },
    "notifications": {
      "etaWindowBefore": 15,
      "etaWindowAfter": 30
    }
  }
}
```

#### PUT /settings
Update settings.

**Request:**
```json
{
  "webhook": {
    "enabled": true,
    "url": "https://api.cliente.com/webhooks/route",
    "secret": "webhook-secret-key"
  },
  "notifications": {
    "etaWindowBefore": 15,
    "etaWindowAfter": 30
  }
}
```

---

## Webhooks

The system sends webhooks to notify external systems of route events.

### Events

| Event | Description |
|-------|-------------|
| route.started | Route execution started |
| stop.in_transit | Driver on the way to stop |
| stop.completed | Stop completed/failed/skipped |

### Payload Format

```json
{
  "event": "stop.in_transit",
  "timestamp": "2024-01-15T10:30:00Z",
  "route": {
    "id": "route-uuid",
    "name": "Ruta Centro AM",
    "status": "IN_PROGRESS"
  },
  "driver": {
    "id": "driver-uuid",
    "firstName": "Carlos",
    "lastName": "Gonzalez",
    "phone": "+56912345678"
  },
  "stop": {
    "id": "stop-uuid",
    "sequenceOrder": 3,
    "status": "IN_TRANSIT",
    "address": "Calle Ejemplo 456, Providencia",
    "unit": "Depto 501",
    "recipientName": "Juan Perez",
    "estimatedArrival": "2024-01-15T10:45:00Z",
    "etaWindowStart": "2024-01-15T10:30:00Z",
    "etaWindowEnd": "2024-01-15T11:15:00Z"
  },
  "remainingStops": [...],
  "metadata": {
    "driverLocation": {
      "latitude": -33.4200,
      "longitude": -70.6100,
      "updatedAt": "2024-01-15T10:29:00Z"
    }
  }
}
```

### Security

Webhooks include HMAC-SHA256 signature in header:
```
X-Webhook-Signature: sha256=abc123...
```

Verify with:
```javascript
const crypto = require('crypto');
const signature = crypto
  .createHmac('sha256', webhookSecret)
  .update(JSON.stringify(payload))
  .digest('hex');
const isValid = `sha256=${signature}` === req.headers['x-webhook-signature'];
```

---

## Enums

### Route Status
- `DRAFT` - Route being created
- `SCHEDULED` - Route ready for execution
- `IN_PROGRESS` - Route being executed
- `COMPLETED` - Route finished
- `CANCELLED` - Route cancelled

### Stop Status
- `PENDING` - Not yet visited
- `IN_TRANSIT` - Driver on the way
- `ARRIVED` - Driver at location
- `COMPLETED` - Successfully delivered
- `FAILED` - Delivery failed
- `SKIPPED` - Skipped (to reschedule)

### Stop Type
- `DELIVERY` - Drop off package
- `PICKUP` - Pick up from customer
- `SERVICE` - Service call
- `CHECKPOINT` - Checkpoint only

### User Role
- `ADMIN` - Full access
- `OPERATOR` - Manage routes, stops, addresses
- `DRIVER` - Execute assigned routes only

---

## Error Responses

```json
{
  "success": false,
  "error": {
    "code": "ROUTE_NOT_FOUND",
    "message": "La ruta no existe"
  }
}
```

### HTTP Status Codes
| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request - Invalid data |
| 401 | Unauthorized - Invalid/expired token |
| 403 | Forbidden - No permission |
| 404 | Not Found |
| 500 | Server Error |

---

## Rate Limiting

Currently no rate limiting is implemented. For production, recommend:
- 100 requests/minute for regular endpoints
- 10 requests/second for location updates

---

## CORS

CORS is enabled for:
- `http://localhost:5173` (development)
- `http://localhost` (production)

Configure additional origins in environment variables.
