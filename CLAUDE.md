# Notas del Proyecto Route Optimizer

## Stack Tecnologico

| Capa | Tecnologia |
|------|------------|
| Backend | Express, TypeScript, Prisma, Zod |
| Frontend | React 18, Vite, Tailwind, Zustand |
| Base de datos | PostgreSQL 15 |
| Mapas | Google Maps APIs |
| Auth | JWT (access 15min + refresh 7 dias) |
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

### Flujo de tokens
1. Login retorna `{ accessToken, refreshToken }`
2. Access token expira en 15 minutos
3. Refresh token expira en 7 dias
4. El interceptor en `api.ts` hace refresh automatico al recibir 401
5. **IMPORTANTE**: Despues del refresh, guardar AMBOS tokens (access y refresh)

### FCM Token (Push Notifications)
- Se guarda por separado del JWT
- La app Android debe llamar `POST /auth/fcm-token` despues del login
- Se limpia en logout para evitar notificaciones a dispositivos deslogueados

## Endpoints Importantes

### Usuarios
- `GET /users/connected` - Usuarios con sesion activa (refresh token valido)
- `POST /users/:id/notify` - Enviar notificacion push a usuario

### Rutas
- `POST /routes/:id/send` - Enviar ruta al conductor (notifica via FCM)
- `POST /routes/:id/optimize` - Optimizar orden de paradas

## Notas de Desarrollo

### Docker Build
El build de produccion usa TypeScript strict. Asegurarse de que no hay errores de tipos antes de hacer push.

### Base de datos
- Prisma schema en `prisma/schema.prisma`
- Para migraciones: `pnpm db:migrate`
- Para generar cliente: `pnpm db:generate`

## Comandos Utiles (Servidor)

### PostgreSQL
Usuario: `route_user` | Base de datos: `route_optimizer`

```bash
# Conectar a PostgreSQL
docker compose exec postgres psql -U route_user -d route_optimizer

# Ver refresh tokens activos (sesiones)
docker compose exec postgres psql -U route_user -d route_optimizer -c "SELECT u.email, rt.expires_at, rt.revoked_at FROM refresh_tokens rt JOIN users u ON rt.user_id = u.id WHERE rt.revoked_at IS NULL ORDER BY rt.created_at DESC LIMIT 5;"

# Ver usuarios con FCM token
docker compose exec postgres psql -U route_user -d route_optimizer -c "SELECT email, fcm_token IS NOT NULL as has_fcm FROM users WHERE is_active = true;"
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
