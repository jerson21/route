# Guia de Deployment

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENTE (Browser/App)                     │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼ HTTPS :443
┌─────────────────────────────────────────────────────────────┐
│                  NGINX / TRAEFIK (Reverse Proxy)            │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  /            → React SPA (archivos estaticos)        │  │
│  │  /api/*       → Backend API (:3001)                   │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                           │
         ┌─────────────────┴─────────────────┐
         ▼                                   ▼
┌─────────────────┐                 ┌─────────────────┐
│   API Express   │◄───────────────►│   PostgreSQL    │
│     :3001       │                 │     :5432       │
└─────────────────┘                 └─────────────────┘
```

**Solo se expone el puerto 80/443.** El frontend y API estan unificados detras de nginx.

---

## Opcion 1: VPS con Docker Compose (Recomendado)

### Requisitos
- VPS con 2GB RAM minimo (4GB recomendado)
- Ubuntu 22.04 o Debian 12
- Docker y Docker Compose instalados
- Dominio apuntando al servidor

### Paso 1: Preparar el servidor

```bash
# Actualizar sistema
sudo apt update && sudo apt upgrade -y

# Instalar Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Instalar Docker Compose
sudo apt install docker-compose-plugin -y

# Reiniciar sesion para aplicar grupo docker
exit
```

### Paso 2: Clonar y configurar

```bash
# Clonar repositorio
git clone https://github.com/tu-usuario/route-optimizer.git
cd route-optimizer

# Crear archivo de variables
cp .env.example .env
nano .env
```

### Paso 3: Configurar .env para produccion

```env
# Base de datos
DB_USER=route_user
DB_PASSWORD=tu-password-seguro-aqui
DB_NAME=route_db

# JWT (generar con: openssl rand -hex 32)
JWT_ACCESS_SECRET=tu-clave-acceso-super-segura-minimo-32-caracteres
JWT_REFRESH_SECRET=tu-clave-refresh-super-segura-minimo-32-caracteres

# Google Maps
GOOGLE_MAPS_API_KEY=AIzaSy...tu-api-key

# Dominio (para SSL automatico)
DOMAIN=rutas.tuempresa.com
ACME_EMAIL=admin@tuempresa.com
```

### Paso 4: Levantar servicios

```bash
# Con SSL automatico (produccion)
docker compose -f docker-compose.prod.yml up -d --build

# Sin SSL (desarrollo/testing)
docker compose up -d --build
```

### Paso 5: Verificar

```bash
# Ver logs
docker compose -f docker-compose.prod.yml logs -f

# Verificar servicios
docker compose -f docker-compose.prod.yml ps

# Probar API
curl https://tudominio.com/api/v1/health
```

---

## Opcion 2: Render.com (PaaS Gratuito)

### Web Service (API)

1. Ir a [render.com](https://render.com) y crear cuenta
2. New → Web Service
3. Conectar repositorio GitHub
4. Configurar:
   - **Name:** route-api
   - **Root Directory:** apps/api
   - **Build Command:** `npm install && npx prisma generate`
   - **Start Command:** `npm start`
   - **Environment Variables:**
     ```
     DATABASE_URL=postgresql://...
     JWT_ACCESS_SECRET=...
     JWT_REFRESH_SECRET=...
     GOOGLE_MAPS_API_KEY=...
     ```

### Static Site (Frontend)

1. New → Static Site
2. Conectar mismo repositorio
3. Configurar:
   - **Name:** route-web
   - **Root Directory:** apps/web
   - **Build Command:** `npm install && npm run build`
   - **Publish Directory:** `dist`
   - **Environment Variables:**
     ```
     VITE_GOOGLE_MAPS_API_KEY=...
     ```

### PostgreSQL Database

1. New → PostgreSQL
2. Copiar connection string a `DATABASE_URL`

---

## Opcion 3: Railway.app

```bash
# Instalar CLI
npm i -g @railway/cli

# Login
railway login

# Inicializar proyecto
railway init

# Agregar PostgreSQL
railway add postgresql

# Deploy
railway up
```

---

## Opcion 4: AWS / Google Cloud / Azure

### Con Kubernetes (EKS/GKE/AKS)

Crear manifiestos Kubernetes:

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: route-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: route-api
  template:
    metadata:
      labels:
        app: route-api
    spec:
      containers:
      - name: api
        image: your-registry/route-api:latest
        ports:
        - containerPort: 3001
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: route-secrets
              key: database-url
---
apiVersion: v1
kind: Service
metadata:
  name: route-api
spec:
  selector:
    app: route-api
  ports:
  - port: 3001
    targetPort: 3001
```

### Con App Runner (AWS) / Cloud Run (GCP)

```bash
# AWS App Runner
aws apprunner create-service \
  --service-name route-api \
  --source-configuration '{...}'

# Google Cloud Run
gcloud run deploy route-api \
  --source . \
  --platform managed \
  --region us-central1
```

---

## Configuracion de Dominio

### DNS Records

```
Tipo    Nombre              Valor
A       @                   IP_DEL_SERVIDOR
A       www                 IP_DEL_SERVIDOR
CNAME   api                 tudominio.com
```

### SSL con Let's Encrypt (incluido en docker-compose.prod.yml)

El certificado se genera automaticamente con Traefik.

---

## Monitoreo y Logs

### Ver logs en tiempo real

```bash
# Todos los servicios
docker compose -f docker-compose.prod.yml logs -f

# Solo API
docker compose -f docker-compose.prod.yml logs -f api

# Solo web
docker compose -f docker-compose.prod.yml logs -f web
```

### Backups de base de datos

```bash
# Backup
docker exec route-postgres pg_dump -U route_user route_db > backup_$(date +%Y%m%d).sql

# Restore
cat backup.sql | docker exec -i route-postgres psql -U route_user route_db
```

### Automatizar backups (cron)

```bash
# Editar crontab
crontab -e

# Agregar (backup diario a las 3am)
0 3 * * * docker exec route-postgres pg_dump -U route_user route_db > /backups/route_$(date +\%Y\%m\%d).sql
```

---

## Actualizaciones

```bash
# Descargar cambios
git pull origin main

# Reconstruir y reiniciar
docker compose -f docker-compose.prod.yml up -d --build

# Limpiar imagenes antiguas
docker image prune -f
```

---

## Troubleshooting

### API no responde

```bash
# Verificar que el contenedor esta corriendo
docker ps

# Ver logs del API
docker logs route-api --tail 100

# Reiniciar API
docker compose -f docker-compose.prod.yml restart api
```

### Error de conexion a base de datos

```bash
# Verificar que postgres esta corriendo
docker logs route-postgres

# Conectar manualmente
docker exec -it route-postgres psql -U route_user -d route_db
```

### SSL no funciona

```bash
# Verificar que el dominio apunta al servidor
dig +short tudominio.com

# Ver logs de Traefik
docker logs route-traefik

# Verificar certificado
openssl s_client -connect tudominio.com:443 -servername tudominio.com
```

---

## Escalamiento

### Horizontal (multiples instancias)

```yaml
# docker-compose.prod.yml
services:
  api:
    deploy:
      replicas: 3
```

### Vertical (mas recursos)

```yaml
services:
  api:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
```

---

## Checklist de Produccion

- [ ] Variables de entorno configuradas
- [ ] JWT secrets generados (minimo 32 caracteres)
- [ ] Google Maps API key configurada
- [ ] Dominio apuntando al servidor
- [ ] SSL funcionando
- [ ] Backups automaticos configurados
- [ ] Monitoreo activo
- [ ] Firewall configurado (solo 80/443 abiertos)
- [ ] Base de datos con password seguro
