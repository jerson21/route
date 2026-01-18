# Sistema de Pagos - Integracion con Intranet

## Flujo Actual (Android App)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  PaymentDialog                                                           │
│  (Usuario selecciona metodo y confirma)                                  │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ onConfirm(amount, method, notes)
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  RouteDetailViewModel.recordPayment()                                    │
│  → Muestra loading, llama repository                                     │
└────────────────────────────┬────────────────────────────────────────────┘
                             │ routeRepository.recordStopPayment(...)
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  HTTP POST /routes/{routeId}/stops/{stopId}/payment                     │
│                                                                          │
│  Body JSON:                                                              │
│  {                                                                       │
│    "amount": 50000.0,                                                    │
│    "method": "CASH" | "CARD" | "TRANSFER" | "ONLINE",                   │
│    "notes": "Pago con billetes",                                        │
│    "collectedBy": "driver"                                               │
│  }                                                                       │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  UI se actualiza:                                                        │
│  - Badge cambia de "COBRAR $50.000" (rojo) a "PAGADO" (verde)           │
│  - Toast muestra "Pago registrado correctamente"                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Integracion Requerida con Intranet

### Sistemas Involucrados

1. **Route API** (este proyecto) - Backend Node.js
2. **Intranet/Cliente** - Servidor externo donde el cliente valida sus transferencias
3. **Lambda** - Funcion que llama al endpoint de validacion de pagos existente

### Flujos de Verificacion de Transferencia

Hay DOS formas de verificar una transferencia:

#### Flujo A: Cliente valida en su portal
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Cliente entra a su portal web                                          │
│  - Ingresa RUT + monto                                                   │
│  - Sistema valida contra banco                                           │
│  - Si OK → guarda en BD Intranet                                        │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Intranet envia webhook a Route API                                     │
│  POST /webhooks/payment-verified                                         │
│  { customerRut, amount, transactionId, ... }                            │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Route API:                                                              │
│  - Busca Payment pendiente con RUT + monto                              │
│  - Actualiza status = CONFIRMED                                          │
│  - Notifica conductor via FCM                                            │
└─────────────────────────────────────────────────────────────────────────┘
```

#### Flujo B: Conductor valida desde Android (fallback)
```
┌─────────────────────────────────────────────────────────────────────────┐
│  Cliente no sabe validar o tiene error                                  │
│  → Le dice al conductor que valide por el                               │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Android App: Conductor presiona boton "Validar Transferencia"          │
│  → Envia RUT + monto a Route API                                        │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Route API: POST /payments/:paymentId/verify                            │
│  → Llama a Lambda con RUT + monto                                       │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Lambda:                                                                 │
│  - Recibe RUT + monto                                                    │
│  - Llama al endpoint de validacion de pagos existente (Intranet)        │
│  - Retorna resultado: encontrado/no encontrado                          │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │                              │
              ▼                              ▼
        Encontrado                      No encontrado
              │                              │
              ▼                              ▼
┌─────────────────────────┐    ┌─────────────────────────┐
│  Payment → CONFIRMED    │    │  Mostrar error:         │
│  Stop → isPaid: true    │    │  "Transferencia no      │
│  FCM → Notificar        │    │   encontrada"           │
└─────────────────────────┘    └─────────────────────────┘
```

### Flujo Completo

```
                    CONDUCTOR REGISTRA PAGO
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  POST /routes/:routeId/stops/:stopId/payment                            │
│  { amount, method, notes, collectedBy, customerRut }                    │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
        ┌────────────────────┴────────────────────┐
        │                                          │
        ▼                                          ▼
   method = CASH/CARD                        method = TRANSFER
   (Pago inmediato)                          (Requiere verificacion)
        │                                          │
        ▼                                          ▼
┌─────────────────────┐          ┌─────────────────────────────────────┐
│  Payment: CONFIRMED │          │  Payment: PENDING                   │
│  Stop: isPaid=true  │          │  Guardar: RUT + monto               │
└─────────────────────┘          │  Stop: isPaid=false                 │
                                 └────────────────────┬────────────────┘
                                                      │
                     ┌────────────────────────────────┴───────────┐
                     │                                            │
                     ▼                                            ▼
          Flujo A: Cliente valida              Flujo B: Conductor valida
          en su portal                          desde Android
                     │                                            │
                     ▼                                            ▼
          Webhook a Route API               Route API llama Lambda
                     │                                            │
                     └────────────────────┬───────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Si verificado OK:                                                       │
│  1. Payment.status = CONFIRMED                                           │
│  2. Stop.isPaid = true                                                   │
│  3. Guardar en BD Intranet (si no vino de ahi)                          │
│  4. FCM notificar conductor: "Pago verificado"                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Endpoints Requeridos

### 1. Registrar Pago (existente, modificar)
```
POST /routes/:routeId/stops/:stopId/payment

Request:
{
  "amount": 50000,
  "method": "TRANSFER",  // CASH | CARD | TRANSFER | ONLINE
  "notes": "Cliente dice que transfirio",
  "collectedBy": "driver",
  "customerRut": "12345678-9"  // NUEVO: requerido para TRANSFER
}

Response:
{
  "success": true,
  "data": {
    "paymentId": "uuid",
    "status": "PENDING" | "CONFIRMED",  // PENDING si es TRANSFER
    "message": "Pago registrado, pendiente verificacion"
  }
}
```

### 2. Webhook de Verificacion (Lambda → Route API)
```
POST /webhooks/payment-verified
Headers: { "X-Webhook-Secret": "secret_key" }

Request:
{
  "customerRut": "12345678-9",
  "amount": 50000,
  "transactionId": "TRX123456",
  "bankReference": "...",
  "verifiedAt": "2024-01-18T15:30:00Z"
}

Response:
{
  "success": true,
  "matched": true,
  "stopsUpdated": ["stop-uuid-1", "stop-uuid-2"]
}
```

### 3. Sincronizar con Intranet
```
POST {INTRANET_URL}/api/payments

Request:
{
  "routeId": "...",
  "stopId": "...",
  "customerRut": "12345678-9",
  "customerName": "Juan Perez",
  "amount": 50000,
  "method": "TRANSFER",
  "status": "CONFIRMED",
  "collectedBy": "driver",
  "driverName": "Pedro Conductor",
  "verifiedAt": "2024-01-18T15:30:00Z",
  "transactionId": "TRX123456"
}
```

---

## Modelo de Datos

### Payment (nueva tabla)
```prisma
model Payment {
  id            String        @id @default(cuid())
  stopId        String
  stop          Stop          @relation(fields: [stopId], references: [id])

  amount        Decimal       @db.Decimal(10, 2)
  method        PaymentMethod
  status        PaymentStatus @default(PENDING)

  customerRut   String?       // Para verificacion de transferencias
  notes         String?
  collectedBy   String        // "driver" | "office" | "online"

  // Verificacion de transferencia
  transactionId String?       // ID de transaccion bancaria
  bankReference String?
  verifiedAt    DateTime?

  // Sincronizacion con Intranet
  intranetSynced   Boolean   @default(false)
  intranetSyncedAt DateTime?
  intranetId       String?   // ID en sistema Intranet

  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt
}

enum PaymentMethod {
  CASH
  CARD
  TRANSFER
  ONLINE
}

enum PaymentStatus {
  PENDING     // Esperando verificacion (transferencias)
  CONFIRMED   // Pago verificado/completado
  FAILED      // Verificacion fallo
  REFUNDED    // Devuelto
}
```

### Stop (agregar campos)
```prisma
model Stop {
  // ... campos existentes ...

  isPaid         Boolean   @default(false)
  paymentStatus  PaymentStatus?
  amountDue      Decimal?  @db.Decimal(10, 2)  // Monto a cobrar
  customerRut    String?   // RUT del cliente para verificacion

  payments       Payment[]
}
```

---

## Flujo de Verificacion Lambda

```
┌─────────────────────────────────────────────────────────────────────────┐
│  AWS Lambda: payment-verifier                                            │
│  Trigger: CloudWatch Events (cada 5 minutos)                            │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  1. Consultar Route API: GET /payments/pending                          │
│     → Lista de pagos TRANSFER en estado PENDING                         │
│     → Incluye: customerRut, amount, stopId, createdAt                   │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  2. Para cada pago pendiente:                                           │
│     - Consultar banco/scraping con RUT + monto                          │
│     - Buscar transferencia en ultimas 24-48 horas                       │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │                              │
              ▼                              ▼
         Match encontrado              No encontrado
              │                              │
              ▼                              ▼
┌─────────────────────────┐    ┌─────────────────────────┐
│  POST /webhooks/        │    │  Si > 48h sin match:    │
│  payment-verified       │    │  Marcar como FAILED     │
│  { rut, amount, txId }  │    │  Notificar operador     │
└─────────────────────────┘    └─────────────────────────┘
```

---

## Notificaciones FCM

### Pago Verificado (conductor)
```json
{
  "type": "payment_verified",
  "stopId": "...",
  "customerName": "Juan Perez",
  "amount": 50000,
  "message": "Transferencia verificada para Juan Perez ($50.000)"
}
```

### Pago Pendiente Timeout (operador)
```json
{
  "type": "payment_timeout",
  "stopId": "...",
  "customerName": "Juan Perez",
  "amount": 50000,
  "hoursWaiting": 48,
  "message": "Pago pendiente de Juan Perez ($50.000) lleva 48h sin verificar"
}
```

---

## Variables de Entorno

```env
# Intranet
INTRANET_API_URL=https://intranet.empresa.cl/api
INTRANET_API_KEY=xxx

# Lambda Webhook
PAYMENT_WEBHOOK_SECRET=xxx

# Verificacion
PAYMENT_VERIFICATION_TIMEOUT_HOURS=48
```

---

## TODO - Implementacion

### Fase 1: Modelo y Endpoints Basicos
- [ ] Crear modelo Payment en Prisma
- [ ] Agregar campos a Stop (customerRut, amountDue)
- [ ] Modificar endpoint POST /stops/:id/payment
- [ ] Crear endpoint GET /payments/pending

### Fase 2: Webhook Verificacion
- [ ] Crear endpoint POST /webhooks/payment-verified
- [ ] Implementar logica de matching (RUT + monto)
- [ ] Actualizar Payment y Stop al verificar
- [ ] Notificar conductor via FCM

### Fase 3: Sincronizacion Intranet
- [ ] Crear servicio IntranetService
- [ ] Sincronizar pagos confirmados
- [ ] Manejar errores y reintentos
- [ ] Log de sincronizacion

### Fase 4: Lambda Robot
- [ ] Endpoint GET /payments/pending para Lambda
- [ ] Configurar Lambda en AWS
- [ ] Conectar con sistema bancario/scraping
- [ ] Pruebas end-to-end
