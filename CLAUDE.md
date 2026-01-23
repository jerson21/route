# Notas del Proyecto Route Optimizer

## Stack Tecnologico

| Capa | Tecnologia |
|------|------------|
| Backend | Express, TypeScript, Prisma, Zod |
| Frontend | React 18, Vite, Tailwind, Zustand |
| Base de datos | PostgreSQL 15 |
| Mapas | Google Maps APIs |
| Auth | JWT (access 15min + refresh 7 dias) + Device Sessions |
| Push Notifications | Firebase Cloud Messaging (FCM) |
| DevOps | Docker, Turbo, pnpm |

## Estructura del Monorepo

```
apps/
  api/          # Backend Express + Prisma
  web/          # Frontend React + Vite
  mobile/       # App Android (Kotlin) - repo separado
packages/
  shared/       # Tipos compartidos
```

## Errores Comunes y Soluciones

### Express: Orden de rutas importa
Las rutas parametrizadas (`:id`) capturan cualquier valor. Definir rutas especificas ANTES de las parametrizadas:

```typescript
// MAL - /users/connected se interpreta como /users/:id con id="connected"
router.get('/:id', ...);
router.get('/connected', ...);

// BIEN - rutas especificas primero
router.get('/connected', ...);  // Debe ir primero
router.get('/:id', ...);        // Despues las parametrizadas
```

### lucide-react: No usar `title` como prop
Los iconos de lucide-react NO aceptan la prop `title`. Para tooltips, envolver en un elemento HTML:

```tsx
// MAL - Error TypeScript
<CheckCircle className="w-5 h-5" title="Tooltip" />

// BIEN - Funciona
<span title="Tooltip">
  <CheckCircle className="w-5 h-5" />
</span>
```

### API imports
El cliente axios se exporta como named export:

```tsx
// MAL
import api from '../../services/api';

// BIEN
import { api } from '../../services/api';
```

## Autenticacion

### Arquitectura de Tokens (Actualizado Enero 2026)

El sistema usa **JWT con rotacion de tokens** y **sesiones por dispositivo**:

| Token | Expiracion | Storage | Proposito |
|-------|------------|---------|-----------|
| Access Token | 15 min | localStorage | Autenticar requests |
| Refresh Token | 7 dias | localStorage + BD (hasheado) | Obtener nuevo access token |
| Device ID | Permanente | localStorage | Identificar dispositivo/sesion |

### Flujo de Autenticacion

```
1. Login → Backend genera access + refresh token
         → Hashea refresh token y guarda en BD con deviceId
         → Retorna tokens + deviceId al cliente

2. Request normal → Access token en header Authorization
                  → Si 401, interceptor hace refresh automatico

3. Refresh → Cliente envia refreshToken + deviceId
           → Backend verifica hash en BD (en transaccion atomica)
           → Revoca token viejo, crea nuevo
           → Retorna nuevos tokens

4. Logout → Solo revoca token del dispositivo actual (por defecto)
          → O revoca TODOS si logoutAll: true
```

### Sesiones por Dispositivo

Cada dispositivo/navegador tiene su propia sesion independiente:
- Login desde Chrome = Sesion 1
- Login desde Firefox = Sesion 2
- Login desde App Android = Sesion 3
- **Logout en uno NO afecta a los otros**

### Proteccion contra Race Conditions

El refresh usa transacciones atomicas de Prisma:
```typescript
await prisma.$transaction(async (tx) => {
  // 1. Buscar y verificar token (atomico)
  const storedToken = await tx.refreshToken.findFirst({...});

  // 2. Revocar viejo y crear nuevo (atomico)
  await tx.refreshToken.update({...});
  await tx.refreshToken.create({...});
});
```
Si dos requests intentan refresh simultaneo, solo una gana.

### SSE (Server-Sent Events) y Tokens

**Problema resuelto**: SSE capturaba el token una sola vez y moria cuando expiraba (15 min).

**Solucion implementada** (`useSSE` hook):
1. Reconexion automatica cuando el token cambia
2. Refresh proactivo cada 10 minutos
3. Reconexion con backoff exponencial en errores
4. Escucha cambios de token del interceptor axios

```tsx
// Uso del hook
const { isConnected, error, reconnect } = useSSE(
  '/routes/123/events',
  {
    'stop.status_changed': (data) => handleStopChange(data),
    'driver.location_updated': (data) => updateLocation(data)
  },
  { enabled: route.status === 'IN_PROGRESS' }
);
```

### Archivos Clave del Sistema de Auth

| Archivo | Responsabilidad |
|---------|-----------------|
| `apps/api/src/services/auth.service.ts` | Logica de login, refresh, logout |
| `apps/api/src/utils/jwt.ts` | Generacion y verificacion de JWT, hasheo |
| `apps/api/src/routes/auth.routes.ts` | Endpoints de auth |
| `apps/web/src/services/api.ts` | Interceptor axios, manejo de refresh |
| `apps/web/src/hooks/useSSE.ts` | Hook para SSE con reconexion automatica |
| `apps/web/src/services/authService.ts` | Funciones de auth del frontend |

### FCM Token (Push Notifications)
- Se guarda por separado del JWT
- La app Android debe llamar `POST /auth/fcm-token` despues del login
- Se limpia en logout solo si `logoutAll: true`

## Endpoints Importantes

### Auth
- `POST /auth/login` - Login (acepta deviceId, deviceInfo)
- `POST /auth/refresh` - Refresh token (acepta deviceId)
- `POST /auth/logout` - Logout (acepta refreshToken, logoutAll)
- `GET /auth/sessions` - Listar sesiones activas del usuario
- `DELETE /auth/sessions/:id` - Revocar sesion especifica

### Usuarios
- `GET /users/connected` - Usuarios con sesion activa (refresh token valido)
- `POST /users/:id/notify` - Enviar notificacion push a usuario

### Rutas
- `POST /routes/:id/send` - Enviar ruta al conductor (notifica via FCM)
- `POST /routes/:id/optimize` - Optimizar orden de paradas
- `GET /routes/:id/events` - SSE para actualizaciones en tiempo real

## Notas de Desarrollo

### Docker Build
El build de produccion usa TypeScript strict. Asegurarse de que no hay errores de tipos antes de hacer push.

### Base de datos
- Prisma schema en `prisma/schema.prisma`
- Para actualizar schema: `pnpm db:push` (desarrollo) o `pnpm db:migrate` (produccion)
- Para generar cliente: `pnpm db:generate`

### Despues de cambios en schema de RefreshToken
```bash
# 1. Actualizar BD y regenerar cliente
pnpm db:push && pnpm db:generate

# 2. Los tokens existentes se invalidan (usuarios deben re-login)
```

## Comandos Utiles (Servidor)

### PostgreSQL
Usuario: `route_user` | Base de datos: `route_db`

```bash
# Conectar a PostgreSQL
docker compose exec postgres psql -U route_user -d route_db

# Ver refresh tokens activos (sesiones) con dispositivo
docker compose exec postgres psql -U route_user -d route_db -c "SELECT u.email, rt.device_info, rt.expires_at FROM refresh_tokens rt JOIN users u ON rt.user_id = u.id WHERE rt.revoked_at IS NULL ORDER BY rt.created_at DESC LIMIT 10;"

# Ver usuarios con FCM token
docker compose exec postgres psql -U route_user -d route_db -c "SELECT email, fcm_token IS NOT NULL as has_fcm FROM users WHERE is_active = true;"

# Revocar todas las sesiones de un usuario (forzar re-login)
docker compose exec postgres psql -U route_user -d route_db -c "UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = 'USER_ID_AQUI' AND revoked_at IS NULL;"
```

### Docker
```bash
# Rebuild y deploy
git pull && docker compose up -d --build api web

# Ver logs del API
docker compose logs api --tail=50 -f

# Ver logs de todos los servicios
docker compose logs --tail=20
```
