# Sistema de ETAs y Tiempos de Entrega

Este documento explica cómo funciona el cálculo de ETAs (Estimated Time of Arrival) en el sistema Route Optimizer.

---

## Resumen Ejecutivo

| Campo | Descripción | Se actualiza? |
|-------|-------------|---------------|
| `estimatedArrival` | ETA actual de la parada | Sí, durante la ruta |
| `originalEstimatedArrival` | ETA congelada al inicio | No, nunca cambia |
| `etaWindowStart/End` | Ventana horaria para cliente | Basada en `originalEstimatedArrival` |

---

## 1. Cálculo Inicial de ETAs (Optimización)

Cuando se optimiza una ruta (`POST /routes/:id/optimize`), el sistema calcula las ETAs usando:

### Fórmula Haversine + Factor de Corrección

```
distancia_linea_recta = haversine(punto_A, punto_B)
distancia_real = distancia_linea_recta × ROAD_FACTOR
tiempo_viaje = distancia_real / VELOCIDAD_PROMEDIO
```

### Parámetros Actuales

| Parámetro | Valor | Archivo | Descripción |
|-----------|-------|---------|-------------|
| `ROAD_FACTOR` | 1.35 | vrpOptimizer.ts:82 | Las calles no son línea recta |
| `AVG_SPEED_M_PER_MIN` | 500 | vrpOptimizer.ts:83 | 30 km/h promedio |

**Ejemplo:**
- Distancia línea recta: 5 km
- Distancia real estimada: 5 × 1.35 = 6.75 km
- Tiempo de viaje: 6750m / 500 m/min = 13.5 minutos

### Cómo se calcula la ETA de cada parada

```
ETA[parada_1] = hora_salida_depot + tiempo_viaje[depot → parada_1]
ETA[parada_2] = ETA[parada_1] + tiempo_servicio[parada_1] + tiempo_viaje[parada_1 → parada_2]
ETA[parada_N] = ETA[parada_N-1] + tiempo_servicio[parada_N-1] + tiempo_viaje[parada_N-1 → parada_N]
```

---

## 2. originalEstimatedArrival vs estimatedArrival

### `estimatedArrival`
- **Cuándo se crea:** Durante la optimización de la ruta
- **Se actualiza:** Sí, cuando hay recálculo de ETAs
- **Uso:** Mostrar al conductor la ETA actual

### `originalEstimatedArrival`
- **Cuándo se crea:** Al INICIAR la ruta (`POST /routes/:id/start`)
- **Se actualiza:** NUNCA (queda congelada)
- **Uso:**
  - Calcular ventana horaria para notificaciones al cliente
  - Comparar desviación del conductor vs plan original
  - Decidir si recalcular ETAs (umbral de 15 min)

### Código relevante (routes.routes.ts:959)

```typescript
// Al iniciar ruta, congelar ETAs originales
await prisma.stop.updateMany({
  where: { routeId, originalEstimatedArrival: null },
  data: { originalEstimatedArrival: stop.estimatedArrival }
});
```

---

## 3. Recálculo de ETAs (Optimización de Costos)

### Problema Original
Cada vez que el conductor completaba una parada, se recalculaban TODAS las ETAs restantes llamando a Google Directions API. Con 20 paradas, esto generaba ~190 llamadas por ruta (~$0.95 USD).

### Solución Implementada: Umbral de 15 minutos

**Archivo:** `apps/api/src/services/etaRecalculationService.ts`

```typescript
const DEVIATION_THRESHOLD_MINUTES = 15;

// Si el conductor llegó dentro de 15 min de la ETA original, NO recalcular
if (deviationMinutes <= DEVIATION_THRESHOLD_MINUTES) {
  console.log(`[RECALC] Deviation <= 15 min - SKIPPING recalculation`);
  return { success: true, updatedStops: 0, skippedReason: 'on_time' };
}

// Si llegó con más de 15 min de desviación, recalcular todas las restantes
console.log(`[RECALC] Deviation > 15 min - RECALCULATING all remaining stops`);
```

### Flujo de Decisión

```
Conductor completa parada
         ↓
Calcular desviación = |hora_real - ETA_original|
         ↓
┌────────────────────────────────────────┐
│ ¿Desviación > 15 minutos?              │
├────────────────────────────────────────┤
│ NO  → No recalcular (ahorro de API)    │
│ SÍ  → Recalcular todas las restantes   │
└────────────────────────────────────────┘
```

### Ahorro Estimado

| Escenario | Sin optimización | Con optimización (80% on-time) |
|-----------|------------------|--------------------------------|
| 20 paradas | 190 llamadas | ~38 llamadas |
| Costo | ~$0.95 | ~$0.19 |

---

## 4. Parámetros Configurables

### En el Depot (Settings → Depots)

| Campo | Default | Descripción |
|-------|---------|-------------|
| `defaultDepartureTime` | "08:00" | Hora de salida del depot |
| `defaultServiceMinutes` | 15 | Minutos en cada parada |
| `etaWindowBefore` | 30 | Minutos antes de ETA para ventana |
| `etaWindowAfter` | 30 | Minutos después de ETA para ventana |

### Ajustar vía API

```bash
# Ver depot actual
curl -X GET https://api.tu-dominio.com/api/v1/depots/default

# Actualizar parámetros
curl -X PUT https://api.tu-dominio.com/api/v1/depots/{id} \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "defaultServiceMinutes": 5,
    "etaWindowBefore": 20,
    "etaWindowAfter": 60
  }'
```

### En el Código (requiere deploy)

| Parámetro | Archivo | Línea | Valor actual | Recomendado Santiago |
|-----------|---------|-------|--------------|----------------------|
| `AVG_SPEED_M_PER_MIN` | vrpOptimizer.ts | 83 | 500 (30 km/h) | 667 (40 km/h) |
| `ROAD_FACTOR` | vrpOptimizer.ts | 82 | 1.35 | 1.35 (mantener) |
| `DEVIATION_THRESHOLD_MINUTES` | etaRecalculationService.ts | 15 | 15 | 15 (mantener) |

---

## 5. Ventana Horaria para Cliente (Webhooks)

### Cálculo de la Ventana

**Archivo:** `apps/api/src/services/webhookService.ts`

```typescript
// Usar ETA original si existe, sino la actual
const etaDate = stop.originalEstimatedArrival || stop.estimatedArrival;

// Calcular ventana redondeada a 10 minutos
const etaWindowStart = roundDown(etaDate - etaWindowBefore, 10min);
const etaWindowEnd = roundUp(etaDate + etaWindowAfter, 10min);
```

### Ejemplo

```
ETA original: 14:23
etaWindowBefore: 20 min
etaWindowAfter: 60 min

Ventana sin redondear: 14:03 - 15:23
Ventana redondeada: 14:00 - 15:30  ← Se envía al cliente
```

### Payload del Webhook

```json
{
  "event": "stop.in_transit",
  "stop": {
    "id": "abc123",
    "estimatedArrival": "2026-01-23T14:23:00Z",
    "etaWindowStart": "2026-01-23T14:00:00Z",
    "etaWindowEnd": "2026-01-23T15:30:00Z"
  }
}
```

---

## 6. Diagnóstico: ¿Por qué las ETAs están mal?

### Síntomas y Causas

| Síntoma | Causa probable | Solución |
|---------|----------------|----------|
| Conductor llega MUY temprano | Velocidad muy baja (30 km/h) | Subir a 40 km/h |
| Conductor llega MUY temprano | Tiempo servicio muy alto (15 min) | Bajar a 5 min |
| Conductor llega tarde | Velocidad muy alta | Bajar velocidad |
| ETAs se desajustan progresivamente | Tiempo servicio incorrecto | Ajustar serviceMinutes |

### Cálculo del Error Acumulado

```
Error por parada = (tiempo_servicio_real - tiempo_servicio_configurado)
                 + (tiempo_viaje_real - tiempo_viaje_estimado)

Error total (20 paradas) = 20 × Error por parada
```

**Ejemplo del problema reportado:**
- Tiempo servicio configurado: 15 min
- Tiempo servicio real: 3-5 min
- Error por parada: ~10-12 min
- Error total (20 paradas): 200-240 min = 3-4 horas de adelanto

---

## 7. Logs para Diagnóstico

### Ver recálculos de ETA

```bash
docker compose logs api | grep "\[RECALC\]"
```

**Salida esperada:**
```
[RECALC] Stop completed at 2026-01-23T14:30:00Z
[RECALC] Original ETA was 2026-01-23T14:35:00Z
[RECALC] Deviation: 5.0 minutes (threshold: 15 min)
[RECALC] Deviation <= 15 min - SKIPPING recalculation (saving API calls)
```

### Ver llamadas a Google API

```bash
docker compose logs api | grep "directions/json"
```

---

## 8. Checklist de Configuración Óptima

- [ ] `defaultServiceMinutes` ajustado a tiempo real (ej: 5 min para entregas rápidas)
- [ ] `AVG_SPEED_M_PER_MIN` ajustado a velocidad real (667 = 40 km/h para Santiago)
- [ ] Optimización de recálculo desplegada (umbral 15 min)
- [ ] `etaWindowBefore/After` configurados según SLA con cliente

---

## 9. Referencias de Código

| Funcionalidad | Archivo | Función/Línea |
|---------------|---------|---------------|
| Optimización con Haversine | vrpOptimizer.ts | `getDistanceMatrixHaversine()` |
| Recálculo de ETAs | etaRecalculationService.ts | `recalculateETAs()` |
| Congelar ETA original | routes.routes.ts:959 | En `POST /routes/:id/start` |
| Ventana horaria | webhookService.ts | `buildStopWithWindowPayload()` |
| Config de depot | depot.routes.ts | `createDepotSchema`, `updateDepotSchema` |

---

## 10. Cambios Pendientes

### Para reducir costos de Google API (~99% ahorro)

1. **Ya implementado:** Umbral de 15 min en recálculo
2. **Pendiente deploy:** Archivo `etaRecalculationService.ts` con la optimización

### Para mejorar precisión de ETAs

1. **Cambiar en código (vrpOptimizer.ts:83):**
   ```typescript
   // ANTES
   const AVG_SPEED_M_PER_MIN = 500;  // 30 km/h

   // DESPUÉS
   const AVG_SPEED_M_PER_MIN = 667;  // 40 km/h
   ```

2. **Cambiar en Settings → Depots:**
   - `defaultServiceMinutes`: 15 → 5 (o el tiempo real de tus entregas)
