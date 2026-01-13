FROM node:18-alpine AS base

# Build argument para Google Maps API Key
ARG VITE_GOOGLE_MAPS_API_KEY
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY

# Instalar pnpm
RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

WORKDIR /app

# Copiar archivos de configuración
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
COPY turbo.json ./

# Copiar paquetes compartidos
COPY packages/shared ./packages/shared

# Copiar configuración de la web
COPY apps/web/package.json ./apps/web/
COPY apps/web/tsconfig.json ./apps/web/
COPY apps/web/tsconfig.node.json ./apps/web/
COPY apps/web/vite.config.ts ./apps/web/
COPY apps/web/tailwind.config.js ./apps/web/
COPY apps/web/postcss.config.js ./apps/web/

# Instalar dependencias
RUN pnpm install --frozen-lockfile || pnpm install

# Copiar código fuente
COPY apps/web/src ./apps/web/src
COPY apps/web/index.html ./apps/web/

# Build de la aplicación
RUN pnpm --filter @route-optimizer/web build

# Imagen de producción con nginx
FROM nginx:alpine

# Copiar archivos construidos
COPY --from=base /app/apps/web/dist /usr/share/nginx/html

# Copiar configuración de nginx
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

