FROM node:18-alpine

# Instalar OpenSSL para Prisma
RUN apk add --no-cache openssl libc6-compat

WORKDIR /app

# Copiar configuración de Prisma
COPY prisma ./prisma

# Copiar paquetes compartidos
COPY packages/shared ./packages/shared

# Copiar configuración de la API
COPY apps/api/package.json ./apps/api/

# Instalar dependencias de la API con npm (más simple que pnpm en Docker)
WORKDIR /app/apps/api
# Quitar la dependencia de workspace que npm no entiende
RUN sed -i 's/"@route-optimizer\/shared": "workspace:\*",//' package.json
RUN npm install --legacy-peer-deps

# Generar cliente Prisma
RUN npx prisma generate --schema ../../prisma/schema.prisma

# Crear enlace al paquete shared en node_modules
RUN mkdir -p node_modules/@route-optimizer && \
    ln -s /app/packages/shared node_modules/@route-optimizer/shared

# Copiar código fuente de la API y script de seed
COPY apps/api/src ./src
COPY apps/api/tsconfig.json ./
COPY apps/api/seed-docker.js ./seed-docker.js

# Build de la aplicación
RUN npm run build

EXPOSE 3001

CMD ["npm", "start"]
