# Sistema de Pagos - Verificacion de Transferencias

## Resumen

El sistema permite registrar pagos de entregas con soporte especial para **transferencias bancarias** que requieren verificacion antes de marcar como pagado.

**Metodos de pago soportados:**
- `CASH` - Efectivo (pago inmediato)
- `CARD` - Tarjeta (pago inmediato)
- `TRANSFER` - Transferencia bancaria (requiere verificacion)
- `ONLINE` - Pago online (pago inmediato)

---

## Como Funciona

### Pagos Inmediatos (CASH, CARD, ONLINE)

```
Conductor registra pago
        │
        ▼
POST /routes/:routeId/stops/:stopId/payment
{ amount: 50000, method: "CASH" }
        │
        ▼
┌─────────────────────────────────┐
│  1. Crea registro Payment       │
│     status = VERIFIED           │
│  2. Actualiza Stop              │
│     isPaid = true               │
│     paymentStatus = PAID        │
└─────────────────────────────────┘
        │
        ▼
Respuesta: { success: true, message: "Pago registrado" }
```

### Pagos por Transferencia (TRANSFER)

```
Conductor registra pago con RUT
        │
        ▼
POST /routes/:routeId/stops/:stopId/payment
{ amount: 50000, method: "TRANSFER", customerRut: "12345678-9" }
        │
        ▼
┌─────────────────────────────────┐
│  1. Crea registro Payment       │
│     status = PENDING            │
│  2. Actualiza Stop              │
│     customerRut = "12345678-9"  │
│     isPaid = false  (NO PAGADO) │
└─────────────────────────────────┘
        │
        ▼
Respuesta: {
  success: true,
  requiresVerification: true,
  paymentId: "uuid",
  message: "Pendiente verificacion"
}
```

---

## Flujos de Verificacion

### Flujo A: Cliente valida en su portal (Recomendado)

```
┌────────────────────────────────────────────────────────────────┐
│  1. Cliente entra a portal Intranet                            │
│     - Ingresa su RUT + monto                                   │
│     - Sistema valida contra banco                              │
│     - Si OK → guarda en BD Intranet                           │
└──────────────────────────┬─────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────┐
│  2. Intranet envia webhook a Route API                         │
│                                                                │
│  POST /api/v1/payments/webhooks/verified                       │
│  Headers: { "X-Webhook-Secret": "tu-secret" }                  │
│  Body: {                                                       │
│    "customerRut": "12345678-9",                                │
│    "amount": 50000,                                            │
│    "transactionId": "TRX123456"                                │
│  }                                                             │
└──────────────────────────┬─────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────┐
│  3. Route API procesa webhook                                  │
│     - Busca Payment PENDING con RUT + monto (±$1 tolerancia)  │
│     - Si encuentra:                                            │
│       • Payment.status = VERIFIED                              │
│       • Stop.isPaid = true                                     │
│       • Envia FCM al conductor: "Transferencia verificada"     │
└────────────────────────────────────────────────────────────────┘
```

### Flujo B: Conductor valida manualmente (Fallback)

```
┌────────────────────────────────────────────────────────────────┐
│  1. Cliente no sabe validar o tiene error                      │
│     → Le pide al conductor que valide por el                   │
└──────────────────────────┬─────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────┐
│  2. Conductor presiona "Validar Transferencia" en Android      │
│                                                                │
│  POST /api/v1/payments/{paymentId}/verify                      │
│  (No necesita body - usa el RUT y monto del Payment)          │
└──────────────────────────┬─────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────────────┐
│  3. Route API llama a Lambda de verificacion                   │
│                                                                │
│  POST {PAYMENT_VERIFICATION_LAMBDA_URL}                        │
│  Body: { customerRut, amount }                                 │
└──────────────────────────┬─────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
        Encontrado                 No encontrado
              │                         │
              ▼                         ▼
┌─────────────────────────┐   ┌─────────────────────────┐
│  Payment → VERIFIED     │   │  Respuesta:             │
│  Stop → isPaid: true    │   │  { verified: false,     │
│  Respuesta:             │   │    message: "No se      │
│  { verified: true }     │   │    encontro" }          │
└─────────────────────────┘   └─────────────────────────┘
```

---

## Endpoints Implementados

### 1. Registrar Pago (modificado)

```http
POST /api/v1/routes/:routeId/stops/:stopId/payment
Authorization: Bearer {token}

{
  "amount": 50000,
  "method": "TRANSFER",
  "notes": "Cliente dice que transfirio",
  "customerRut": "12345678-9",
  "collectedBy": "driver"
}
```

**Respuesta TRANSFER:**
```json
{
  "success": true,
  "message": "Pago registrado, pendiente verificacion de transferencia",
  "data": {
    "paymentId": "uuid",
    "status": "PENDING",
    "requiresVerification": true,
    "customerRut": "12345678-9"
  }
}
```

**Respuesta CASH/CARD:**
```json
{
  "success": true,
  "message": "Pago registrado correctamente",
  "data": {
    "id": "stop-uuid",
    "isPaid": true,
    "paymentStatus": "PAID",
    "paymentId": "payment-uuid"
  }
}
```

### 2. Webhook de Verificacion

```http
POST /api/v1/payments/webhooks/verified
X-Webhook-Secret: {PAYMENT_WEBHOOK_SECRET}

{
  "customerRut": "12345678-9",
  "amount": 50000,
  "transactionId": "TRX123456",
  "bankReference": "REF-001",
  "verifiedAt": "2024-01-18T15:30:00Z"
}
```

**Respuesta exitosa:**
```json
{
  "success": true,
  "matched": true,
  "paymentId": "uuid",
  "stopId": "stop-uuid",
  "message": "Pago verificado y actualizado"
}
```

**Respuesta sin match:**
```json
{
  "success": true,
  "matched": false,
  "message": "No se encontraron pagos pendientes que coincidan"
}
```

### 3. Verificacion Manual (Conductor)

```http
POST /api/v1/payments/:paymentId/verify
Authorization: Bearer {token}

// Body OPCIONAL - para cuando la transferencia fue desde otro RUT
{
  "customerRut": "98765432-1",  // RUT alternativo (familiar, empresa, etc.)
  "amount": 50000              // Monto alternativo si difiere
}
```

**Caso de uso:** El cliente dice "mi esposa hizo la transferencia desde su cuenta".
El conductor ingresa el RUT de la esposa para verificar.

**Respuesta verificado:**
```json
{
  "success": true,
  "verified": true,
  "usedAlternativeRut": true,
  "message": "Transferencia verificada correctamente"
}
```

**Respuesta no encontrado:**
```json
{
  "success": true,
  "verified": false,
  "message": "Transferencia no encontrada. El cliente debe verificar en su portal."
}
```

### 4. Listar Pagos Pendientes (para Lambda)

```http
GET /api/v1/payments/pending?hoursAgo=48
Authorization: Bearer {token}  (requiere ADMIN u OPERATOR)
```

**Respuesta:**
```json
{
  "success": true,
  "data": [
    {
      "id": "payment-uuid",
      "stopId": "stop-uuid",
      "amount": "50000",
      "customerRut": "12345678-9",
      "createdAt": "2024-01-18T10:00:00Z",
      "stop": {
        "recipientName": "Juan Perez",
        "address": { "customerName": "Empresa ABC" },
        "route": { "id": "route-uuid", "name": "Ruta Centro" }
      }
    }
  ],
  "count": 1
}
```

### 5. Obtener Detalles de Pago

```http
GET /api/v1/payments/:paymentId
Authorization: Bearer {token}
```

### 6. Pagos de una Parada

```http
GET /api/v1/payments/stop/:stopId
Authorization: Bearer {token}
```

---

## Modelo de Datos

### Tabla: payments

| Campo | Tipo | Descripcion |
|-------|------|-------------|
| id | UUID | ID unico |
| stopId | UUID | FK a stops |
| amount | Decimal(10,2) | Monto del pago |
| method | Enum | CASH, CARD, TRANSFER, ONLINE |
| status | Enum | PENDING, VERIFIED, NOT_FOUND, EXPIRED |
| customerRut | String? | RUT para verificacion de transferencias |
| notes | String? | Notas del pago |
| collectedBy | String | "driver", "office", "online" |
| transactionId | String? | ID de transaccion bancaria |
| bankReference | String? | Referencia bancaria |
| verifiedAt | DateTime? | Fecha de verificacion |
| verifiedBy | String? | "webhook", "driver", "operator" |
| intranetSynced | Boolean | Si se sincronizo con Intranet |
| intranetSyncedAt | DateTime? | Fecha de sincronizacion |
| intranetId | String? | ID en sistema Intranet |
| createdAt | DateTime | Fecha de creacion |
| updatedAt | DateTime | Ultima actualizacion |

### Enums

```typescript
// Metodo de pago
enum PaymentMethod {
  CASH      // Efectivo
  CARD      // Tarjeta
  TRANSFER  // Transferencia bancaria
  ONLINE    // Pago online
}

// Estado de verificacion (para transferencias)
enum TransferStatus {
  PENDING    // Esperando verificacion
  VERIFIED   // Transferencia verificada
  NOT_FOUND  // No se encontro la transferencia
  EXPIRED    // Timeout sin verificacion (>48h)
}
```

---

## Notificaciones FCM

Cuando una transferencia es verificada via webhook, se envia notificacion push al conductor:

```json
{
  "title": "Transferencia verificada",
  "body": "Pago de Juan Perez ($50.000) verificado",
  "data": {
    "type": "payment_verified",
    "paymentId": "uuid",
    "stopId": "stop-uuid",
    "amount": "50000"
  }
}
```

---

## Variables de Entorno

```env
# Secret para autenticar webhooks (requerido)
PAYMENT_WEBHOOK_SECRET=tu-secret-seguro-aqui

# URL de Lambda para verificacion manual (opcional)
PAYMENT_VERIFICATION_LAMBDA_URL=https://xxx.lambda-url.us-east-1.on.aws/verify
PAYMENT_VERIFICATION_API_KEY=tu-api-key

# Timeout para pagos pendientes en horas (default: 48)
PAYMENT_VERIFICATION_TIMEOUT_HOURS=48
```

---

## Implementacion en Android

### 1. Registrar pago por transferencia

```kotlin
// En PaymentDialog, agregar campo para RUT cuando method == TRANSFER
suspend fun recordPayment(
    routeId: String,
    stopId: String,
    amount: Double,
    method: String,  // "TRANSFER"
    customerRut: String  // Requerido para TRANSFER
): PaymentResult {
    return api.post("/routes/$routeId/stops/$stopId/payment") {
        json {
            "amount" to amount
            "method" to method
            "customerRut" to customerRut
            "collectedBy" to "driver"
        }
    }
}
```

### 2. Verificar transferencia manualmente

```kotlin
// Boton "Validar Transferencia" en UI de parada pendiente
// Si el cliente dice que transfirio desde otro RUT, mostrar campo para ingresarlo
suspend fun verifyTransfer(
    paymentId: String,
    alternativeRut: String? = null,  // RUT alternativo (familiar, empresa)
    alternativeAmount: Double? = null
): VerifyResult {
    return api.post("/payments/$paymentId/verify") {
        if (alternativeRut != null || alternativeAmount != null) {
            json {
                alternativeRut?.let { "customerRut" to it }
                alternativeAmount?.let { "amount" to it }
            }
        }
    }
}
```

**UI sugerida:**
```
┌─────────────────────────────────────┐
│  Verificar Transferencia            │
├─────────────────────────────────────┤
│  RUT del cliente: 12345678-9        │
│                                     │
│  [ ] Transferencia desde otro RUT   │
│  RUT alternativo: [____________]    │
│                                     │
│  [Cancelar]        [Verificar]      │
└─────────────────────────────────────┘
```

### 3. Manejar notificacion de verificacion

```kotlin
// En FCMService.kt
when (data["type"]) {
    "payment_verified" -> {
        val stopId = data["stopId"]
        // Actualizar UI de la parada como pagada
        // Mostrar toast: "Transferencia verificada"
    }
}
```

---

## Estado de Implementacion

### Completado
- [x] Modelo Payment en Prisma
- [x] Campo customerRut en Stop
- [x] Endpoint POST /stops/:id/payment (modificado para TRANSFER)
- [x] Endpoint POST /webhooks/verified
- [x] Endpoint POST /payments/:id/verify
- [x] Endpoint GET /payments/pending
- [x] Notificacion FCM al verificar
- [x] Variables de entorno documentadas

### Pendiente
- [ ] Implementar en Android: campo RUT en PaymentDialog
- [ ] Implementar en Android: boton "Validar" para transferencias pendientes
- [ ] Implementar en Android: handler FCM para payment_verified
- [ ] Crear Lambda de verificacion (opcional, para Flujo B)
- [ ] Configurar webhook desde Intranet (Flujo A)
- [ ] Sincronizacion bidireccional con Intranet
