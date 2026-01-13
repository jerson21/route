# Route Optimizer

Sistema completo de optimización de rutas de entrega con tracking en tiempo real, notificaciones a clientes y algoritmos avanzados de optimización (VRP, Simulated Annealing, 2-Opt).

## Tabla de Contenidos

- [Requisitos](#requisitos)
- [Instalacion Rapida](#instalacion-rapida)
- [Guia de Uso Paso a Paso](#guia-de-uso-paso-a-paso)
- [Funcionalidades Principales](#funcionalidades-principales)
- [Arquitectura](#arquitectura)
- [API Endpoints](#api-endpoints)
- [Algoritmos de Optimizacion](#algoritmos-de-optimizacion)
- [Configuracion](#configuracion)
- [Usuarios por Defecto](#usuarios-por-defecto)
- [Comandos Utiles](#comandos-utiles)
- [Roadmap](#roadmap)

---

## Requisitos

### Docker (Recomendado)
- Docker 20+
- Docker Compose 2+
- Google Maps API Key

### Desarrollo Local
- Node.js 18+
- pnpm 8+
- PostgreSQL 15+

---

## Instalacion Rapida

### 1. Configurar variables de entorno

```bash
cp .env.example .env
```

Editar `.env`:
```env
JWT_ACCESS_SECRET=tu-clave-secreta-minimo-32-caracteres
JWT_REFRESH_SECRET=otra-clave-secreta-minimo-32-caracteres
GOOGLE_MAPS_API_KEY=AIzaSy...tu-api-key
```

### 2. Levantar con Docker

```bash
# Produccion
docker-compose up -d --build

# Desarrollo (hot reload)
docker-compose -f docker-compose.dev.yml up -d
```

### 3. Acceder

| Servicio | URL |
|----------|-----|
| Frontend | http://localhost (prod) o http://localhost:5173 (dev) |
| API | http://localhost:3001/api/v1 |

---

## Guia de Uso Paso a Paso

### Paso 1: Iniciar Sesion

1. Acceder a http://localhost
2. Ingresar credenciales:
   - Email: `admin@routeoptimizer.com`
   - Password: `admin123`

### Paso 2: Crear una Ruta

1. Ir a **Rutas** en el menu lateral
2. Click en **Nueva Ruta**
3. Completar:
   - Nombre de la ruta
   - Fecha programada
   - Punto de origen (bodega)
4. Click **Crear**

### Paso 3: Agregar Paradas

1. En la vista de detalle de ruta, click en **Agregar paradas**
2. **Opcion Buscar**: Buscar direccion con Google Maps
   - Escribir direccion
   - Seleccionar resultado
   - Agregar detalles:
     - **Depto/Unidad**: Ej: "Depto 501", "Of. 204"
     - **Indicaciones**: Ej: "Tocar timbre 2 veces"
3. **Opcion Existentes**: Seleccionar de direcciones guardadas
4. Repetir para cada parada

### Paso 4: Optimizar la Ruta

1. Click en **Optimizar**
2. Elegir modo:
   - **Economico**: Gratis, usa formula Haversine
   - **Preciso**: Usa Google API, considera trafico
3. Opciones avanzadas:
   - Forzar primera parada
   - Forzar ultima parada
4. Click **Optimizar**
5. Las paradas se reordenan automaticamente

### Paso 5: Asignar Conductor

1. Click en **Asignar conductor**
2. Seleccionar conductor de la lista
3. La ruta pasa a estado **Programada**

### Paso 6: Ejecutar la Ruta (Conductor)

1. **Cargar camion**: Marcar cuando el vehiculo esta listo
2. **Iniciar ruta**: Comienza el tracking y se congelan los ETAs
3. Por cada parada:
   - **En transito**: Notifica al cliente que el conductor va en camino
   - **Llegar**: Marca llegada al destino
   - **Completar**: Finaliza con foto/firma opcional
4. La ruta se completa automaticamente al terminar todas las paradas

---

## Funcionalidades Principales

### Optimizacion de Rutas
- Algoritmo VRP (Vehicle Routing Problem)
- Simulated Annealing + 2-Opt
- Soporte para ventanas de tiempo
- Prioridades de paradas
- Forzar primera/ultima parada

### Tracking en Tiempo Real
- Ubicacion del conductor en el mapa
- Recalculo automatico de ETAs
- Historial de tracking

### Notificaciones (Webhooks)
- `route.started`: Ruta iniciada
- `stop.in_transit`: Conductor en camino
- `stop.completed`: Parada completada

### Gestion de Direcciones
- Busqueda con Google Places
- Campo unit (Depto, Oficina, Casa)
- Notas e indicaciones
- Importacion masiva desde Excel
- Geocodificacion automatica

### Marcadores Apilados en Mapa
- Cuando hay multiples paradas en el mismo edificio
- Marcador morado con badge de cantidad
- Click para ver lista y seleccionar parada

### Control de Acceso (RBAC)
| Rol | Permisos |
|-----|----------|
| ADMIN | Todo |
| OPERATOR | Crear/editar rutas, optimizar, asignar |
| DRIVER | Ver rutas asignadas, tracking |

---

## Arquitectura

```
route-optimizer/
├── apps/
│   ├── api/                    # Backend Express + TypeScript
│   │   ├── src/
│   │   │   ├── routes/         # Endpoints REST (6 archivos)
│   │   │   ├── services/       # Logica de negocio
│   │   │   │   ├── vrpOptimizer.ts      # Motor de optimizacion
│   │   │   │   ├── geocoding.service.ts # Geocodificacion
│   │   │   │   └── webhookService.ts    # Notificaciones
│   │   │   ├── middleware/     # Auth, RBAC, errores
│   │   │   └── config/         # Database, env
│   │   └── Dockerfile
│   │
│   └── web/                    # Frontend React + Vite
│       ├── src/
│       │   ├── pages/          # Paginas por modulo
│       │   ├── components/     # Componentes reutilizables
│       │   │   ├── map/        # RouteMap (Google Maps)
│       │   │   ├── search/     # AddressSearch
│       │   │   └── stops/      # StopDetailPanel
│       │   ├── services/       # API client
│       │   └── store/          # Zustand state
│       └── Dockerfile
│
├── prisma/
│   └── schema.prisma           # Modelo de datos (10 tablas)
│
├── docker-compose.yml          # Produccion
└── docker-compose.dev.yml      # Desarrollo
```

### Stack Tecnologico

| Capa | Tecnologia |
|------|------------|
| Backend | Express, TypeScript, Prisma, Zod |
| Frontend | React 18, Vite, Tailwind, Zustand |
| Base de datos | PostgreSQL 15 |
| Mapas | Google Maps APIs |
| Auth | JWT (access + refresh tokens) |
| DevOps | Docker, Turbo, pnpm |

---

## API Endpoints

### Autenticacion
```
POST /api/v1/auth/login          # Login
POST /api/v1/auth/register       # Registro
POST /api/v1/auth/refresh        # Refresh token
GET  /api/v1/auth/me             # Usuario actual
```

### Rutas (Principal)
```
GET    /api/v1/routes                         # Listar rutas
POST   /api/v1/routes                         # Crear ruta
GET    /api/v1/routes/:id                     # Obtener ruta
PUT    /api/v1/routes/:id                     # Actualizar
DELETE /api/v1/routes/:id                     # Eliminar

POST   /api/v1/routes/:id/stops               # Agregar paradas
PUT    /api/v1/routes/:id/stops/reorder       # Reordenar
DELETE /api/v1/routes/:id/stops/:stopId       # Eliminar parada

POST   /api/v1/routes/:id/optimize            # OPTIMIZAR
POST   /api/v1/routes/:id/assign              # Asignar conductor
POST   /api/v1/routes/:id/start               # Iniciar ruta
POST   /api/v1/routes/:id/location            # Actualizar ubicacion

POST   /api/v1/routes/:id/stops/:stopId/in-transit  # En transito
POST   /api/v1/routes/:id/stops/:stopId/complete    # Completar
```

### Direcciones
```
GET    /api/v1/addresses                      # Listar
POST   /api/v1/addresses                      # Crear
POST   /api/v1/addresses/import-excel         # Importar Excel
PUT    /api/v1/addresses/:id/location         # Ajustar coords
POST   /api/v1/addresses/:id/geocode          # Geocodificar
```

### Otros
```
GET/POST/PUT/DELETE /api/v1/users             # Usuarios
GET/POST/PUT/DELETE /api/v1/depots            # Bodegas
GET/PUT /api/v1/settings                      # Configuracion
```

---

## Algoritmos de Optimizacion

### 1. VRP con Ventanas de Tiempo
Cuando las paradas tienen horarios especificos.
```
Algoritmo: Greedy Nearest Neighbor + Time Window Awareness
Score = travel_time + wait_time*0.5 - priority*20 - urgency_bonus
```

### 2. Simulated Annealing + 2-Opt
Optimizacion general sin restricciones de tiempo.
```
1. Nearest Neighbor (solucion inicial)
2. Simulated Annealing:
   - Temperatura: 10,000 → 0.1
   - Enfriamiento: 0.995
   - Movimientos: swap, reverse
3. 2-Opt (pulido final)
```

### Modos de Calculo

| Modo | Costo | Precision | Uso |
|------|-------|-----------|-----|
| Haversine | Gratis | ~85% | Pruebas |
| Google API | ~$0.005/ruta | 99% | Produccion |

---

## Configuracion

### Variables de Entorno

```env
# Base de datos
DATABASE_URL="postgresql://user:pass@postgres:5432/route_db"

# JWT (minimo 32 caracteres)
JWT_ACCESS_SECRET="clave-acceso-super-segura-32-chars"
JWT_REFRESH_SECRET="clave-refresh-super-segura-32-chars"

# Google Maps (REQUERIDO)
GOOGLE_MAPS_API_KEY="AIzaSy..."

# App
NODE_ENV="production"
PORT=3001
```

### APIs de Google Requeridas

Habilitar en Google Cloud Console:
1. Geocoding API
2. Directions API
3. Distance Matrix API
4. Maps JavaScript API
5. Places API

---

## Usuarios por Defecto

| Email | Password | Rol |
|-------|----------|-----|
| admin@routeoptimizer.com | admin123 | ADMIN |
| operador@routeoptimizer.com | operador123 | OPERATOR |
| chofer@routeoptimizer.com | chofer123 | DRIVER |

---

## Comandos Utiles

### Docker Produccion
```bash
docker-compose up -d --build          # Iniciar
docker-compose logs -f                # Ver logs
docker-compose down                   # Detener
docker-compose down -v                # Detener y borrar datos
```

### Docker Desarrollo
```bash
docker-compose -f docker-compose.dev.yml up -d
docker-compose -f docker-compose.dev.yml logs -f api
docker-compose -f docker-compose.dev.yml logs -f web
```

### Base de Datos
```bash
docker-compose exec api npx prisma studio    # UI para ver datos
docker-compose exec api npx prisma db push   # Sincronizar schema
```

---

## Roadmap

### Prioridad Alta
- [ ] App movil para conductores (React Native)
- [ ] Dashboard con KPIs y analytics
- [ ] Notificaciones SMS/WhatsApp

### Prioridad Media
- [ ] Reportes exportables (PDF/Excel)
- [ ] Multi-idioma (i18n)
- [ ] Zonas de entrega configurables

### Prioridad Baja
- [ ] Integracion con ERPs
- [ ] Modo offline para conductores
- [ ] Machine learning para ETAs

---

## Licencia

Privado - Todos los derechos reservados.
