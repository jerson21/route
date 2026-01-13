import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    host: '0.0.0.0', // Permite conexiones desde fuera del contenedor
    port: 5173,
    watch: {
      usePolling: true, // Necesario para hot reload en Docker
      interval: 1000
    },
    hmr: {
      host: 'localhost', // Para desarrollo local
      port: 5173
    },
    proxy: {
      '/api': {
        // En Docker, el proxy puede acceder al servicio 'api' por nombre de servicio
        // En desarrollo local, usa localhost
        // El proxy se ejecuta en el servidor de Vite, así que puede usar el nombre del servicio Docker
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001',
        changeOrigin: true,
        // No hacer rewrite porque las rutas de la API ya tienen /api/v1/
        secure: false
      }
    }
  }
});
