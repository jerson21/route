#!/bin/bash
# Script para probar actualización de ubicación manualmente
#
# Uso: ./scripts/test-location-update.sh <routeId> <token> <lat> <lng>
#
# Ejemplo:
#   ./scripts/test-location-update.sh abc123 eyJ... -33.4489 -70.6693

ROUTE_ID=$1
TOKEN=$2
LAT=${3:--33.4489}
LNG=${4:--70.6693}

if [ -z "$ROUTE_ID" ] || [ -z "$TOKEN" ]; then
  echo "Uso: ./scripts/test-location-update.sh <routeId> <token> [lat] [lng]"
  echo ""
  echo "Para obtener el token:"
  echo "  1. Abre la app en el navegador"
  echo "  2. Abre DevTools (F12) -> Application -> Local Storage"
  echo "  3. Copia el valor de 'accessToken'"
  exit 1
fi

echo "Enviando ubicación a ruta $ROUTE_ID"
echo "Lat: $LAT, Lng: $LNG"

curl -X POST "http://localhost:3001/api/v1/routes/$ROUTE_ID/location" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"latitude\": $LAT, \"longitude\": $LNG, \"heading\": 45, \"speed\": 30}"

echo ""
