import { useEffect, useRef, useState, ReactElement } from 'react';
import { Wrapper, Status } from '@googlemaps/react-wrapper';

interface MapLocation {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  type?: 'origin' | 'stop' | 'destination';
  priority?: number;
  status?: 'PENDING' | 'IN_TRANSIT' | 'COMPLETED' | 'SKIPPED' | 'FAILED';
}

interface DriverLocation {
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  updatedAt?: string;
}

interface RouteMapProps {
  apiKey: string;
  locations: MapLocation[];
  center?: { lat: number; lng: number };
  zoom?: number;
  showRoute?: boolean;
  showReturnLeg?: boolean; // Show return leg to depot in different color
  returnLegDestination?: { lat: number; lng: number }; // Depot location for return leg
  showSearch?: boolean;
  driverLocation?: DriverLocation; // Live driver location
  focusLocation?: { lat: number; lng: number }; // Location to focus/zoom to
  onFocusComplete?: () => void; // Called after focus animation completes
  onMarkerClick?: (location: MapLocation) => void;
  onDriverMarkerClick?: () => void; // Called when driver marker is clicked
  onPlaceSelect?: (place: { lat: number; lng: number; address: string }) => void;
}

// Santiago de Chile por defecto
const SANTIAGO_CENTER = { lat: -33.4489, lng: -70.6693 };

// Crear elemento HTML para AdvancedMarkerElement
// Simplificado: siempre muestra el número, el color indica el estado
function createMarkerElement(
  label: string,
  type: 'origin' | 'stop' | 'destination' = 'stop',
  priority?: number,
  status?: 'PENDING' | 'IN_TRANSIT' | 'COMPLETED' | 'SKIPPED' | 'FAILED'
): HTMLElement {
  // Determinar colores según tipo y estado
  let color: string;
  let borderColor: string;
  let textColor: string;

  if (type === 'origin') {
    color = '#22C55E';
    borderColor = '#16A34A';
    textColor = '#16A34A';
  } else if (type === 'destination') {
    color = '#EF4444';
    borderColor = '#DC2626';
    textColor = '#DC2626';
  } else {
    // Para paradas, el color depende del estado
    switch (status) {
      case 'COMPLETED':
        color = '#22C55E'; // Verde
        borderColor = '#16A34A';
        textColor = '#16A34A';
        break;
      case 'SKIPPED':
      case 'FAILED':
        color = '#9CA3AF'; // Gris
        borderColor = '#6B7280';
        textColor = '#6B7280';
        break;
      case 'IN_TRANSIT':
        color = '#F59E0B'; // Amarillo/Naranja
        borderColor = '#D97706';
        textColor = '#D97706';
        break;
      default: // PENDING
        color = '#3B82F6'; // Azul
        borderColor = '#2563EB';
        textColor = '#2563EB';
    }
  }

  const hasPriority = priority && priority > 0;
  const isInTransit = status === 'IN_TRANSIT';

  const container = document.createElement('div');
  container.innerHTML = `
    <div style="position: relative; cursor: pointer;">
      ${isInTransit ? `
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -70%);
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: rgba(245, 158, 11, 0.3);
          animation: pulse-stop 1.5s ease-out infinite;
        "></div>
        <style>
          @keyframes pulse-stop {
            0% { transform: translate(-50%, -70%) scale(0.8); opacity: 1; }
            100% { transform: translate(-50%, -70%) scale(1.4); opacity: 0; }
          }
        </style>
      ` : ''}
      ${hasPriority ? `<div style="position: absolute; top: -6px; right: -6px; width: 14px; height: 14px; background: #EF4444; border-radius: 50%; display: flex; align-items: center; justify-content: center; z-index: 10; box-shadow: 0 1px 2px rgba(0,0,0,0.3);">
        <span style="color: white; font-size: 8px; font-weight: bold;">!</span>
      </div>` : ''}
      <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36" style="filter: drop-shadow(0 2px 2px rgba(0,0,0,0.25));">
        <path d="M14 0C6.268 0 0 6.268 0 14c0 7.732 14 22 14 22s14-14.268 14-22C28 6.268 21.732 0 14 0z"
              fill="${color}" stroke="${borderColor}" stroke-width="1"/>
        <circle cx="14" cy="12" r="9" fill="white"/>
        <text x="14" y="16" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" font-weight="bold" fill="${textColor}">${label}</text>
      </svg>
    </div>
  `;
  return container.firstElementChild as HTMLElement;
}

// Crear elemento HTML para marcador apilado (múltiples paradas en el mismo punto)
// Simplificado: muestra los números de parada y badge con progreso
function createStackedMarkerElement(
  labels: string[],
  count: number,
  statuses?: Array<'PENDING' | 'IN_TRANSIT' | 'COMPLETED' | 'SKIPPED' | 'FAILED' | undefined>
): HTMLElement {
  const container = document.createElement('div');

  // Mostrar los números separados por coma (ej: "1,2,3")
  const labelsText = labels.slice(0, 3).join(',') + (labels.length > 3 ? '..' : '');

  // Calcular estadísticas de estado
  const completed = statuses?.filter(s => s === 'COMPLETED').length || 0;
  const inTransit = statuses?.filter(s => s === 'IN_TRANSIT').length || 0;
  const allCompleted = completed === count;
  const hasInTransit = inTransit > 0;

  // Color según estado del grupo
  let color = '#8B5CF6'; // Púrpura por defecto
  let borderColor = '#6D28D9';
  let textColor = '#6D28D9';

  if (allCompleted) {
    color = '#22C55E';
    borderColor = '#16A34A';
    textColor = '#16A34A';
  } else if (hasInTransit) {
    color = '#F59E0B';
    borderColor = '#D97706';
    textColor = '#D97706';
  } else if (completed > 0) {
    color = '#3B82F6';
    borderColor = '#2563EB';
    textColor = '#2563EB';
  }

  // Badge: muestra progreso si hay completados, sino solo cantidad
  const badgeText = completed > 0 ? `${completed}/${count}` : `${count}`;

  container.innerHTML = `
    <div style="position: relative; cursor: pointer;">
      ${hasInTransit ? `
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -70%);
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: rgba(245, 158, 11, 0.3);
          animation: pulse-stack 1.5s ease-out infinite;
        "></div>
        <style>
          @keyframes pulse-stack {
            0% { transform: translate(-50%, -70%) scale(0.8); opacity: 1; }
            100% { transform: translate(-50%, -70%) scale(1.4); opacity: 0; }
          }
        </style>
      ` : ''}
      <!-- Badge con cantidad/progreso -->
      <div style="position: absolute; top: -8px; right: -8px; min-width: 18px; height: 18px; padding: 0 4px; background: ${color}; border-radius: 9px; display: flex; align-items: center; justify-content: center; z-index: 10; box-shadow: 0 1px 3px rgba(0,0,0,0.3); border: 2px solid white;">
        <span style="color: white; font-size: 9px; font-weight: bold;">${badgeText}</span>
      </div>
      <!-- Marcador con efecto de stack -->
      <div style="position: relative;">
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36" style="position: absolute; left: 3px; top: 3px; opacity: 0.25;">
          <path d="M14 0C6.268 0 0 6.268 0 14c0 7.732 14 22 14 22s14-14.268 14-22C28 6.268 21.732 0 14 0z" fill="${color}"/>
        </svg>
        <svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36" style="position: relative; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.25));">
          <path d="M14 0C6.268 0 0 6.268 0 14c0 7.732 14 22 14 22s14-14.268 14-22C28 6.268 21.732 0 14 0z"
                fill="${color}" stroke="${borderColor}" stroke-width="1"/>
          <circle cx="14" cy="12" r="9" fill="white"/>
          <text x="14" y="15" text-anchor="middle" font-family="Arial, sans-serif" font-size="8" font-weight="bold" fill="${textColor}">${labelsText}</text>
        </svg>
      </div>
    </div>
  `;
  return container.firstElementChild as HTMLElement;
}

// Agrupar ubicaciones por coordenadas (detectar mismo edificio)
function groupLocationsByCoordinates(locations: MapLocation[]): Map<string, MapLocation[]> {
  const groups = new Map<string, MapLocation[]>();

  for (const loc of locations) {
    // Redondear a 5 decimales (~1 metro de precisión)
    const key = `${loc.lat.toFixed(5)},${loc.lng.toFixed(5)}`;
    const group = groups.get(key) || [];
    group.push(loc);
    groups.set(key, group);
  }

  return groups;
}

// Crear elemento HTML para el marcador del conductor con animación de pulso
function createDriverMarkerElement(heading?: number, speed?: number): HTMLElement {
  // Heading viene en grados desde el Norte (0=N, 90=E, 180=S, 270=W)
  // El camión SVG apunta a la derecha (Este), así que restamos 90
  const rotation = (heading || 0) - 90;

  // Velocidad en km/h (viene en m/s desde Android)
  const speedKmh = speed ? Math.round(speed * 3.6) : null;
  const isMoving = speedKmh !== null && speedKmh > 2;

  const container = document.createElement('div');
  container.innerHTML = `
    <div style="position: relative; cursor: pointer;">
      <!-- Pulse animation rings -->
      <div style="
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 60px;
        height: 60px;
        border-radius: 50%;
        background: rgba(59, 130, 246, 0.3);
        animation: pulse-ring 2s ease-out infinite;
      "></div>
      <div style="
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: rgba(59, 130, 246, 0.4);
        animation: pulse-ring 2s ease-out infinite 0.5s;
      "></div>

      <!-- Speed badge -->
      ${speedKmh !== null ? `
        <div style="
          position: absolute;
          top: -12px;
          right: -12px;
          min-width: 32px;
          height: 20px;
          padding: 0 6px;
          background: ${isMoving ? '#22C55E' : '#6B7280'};
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 20;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          border: 2px solid white;
        ">
          <span style="color: white; font-size: 10px; font-weight: bold; white-space: nowrap;">${speedKmh} km/h</span>
        </div>
      ` : ''}

      <!-- Driver icon container -->
      <div style="
        position: relative;
        width: 44px;
        height: 44px;
        background: linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.5), 0 2px 4px rgba(0,0,0,0.2);
        border: 3px solid white;
        transform: rotate(${rotation}deg);
        z-index: 10;
      ">
        <!-- Truck/Van icon -->
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4z" fill="white"/>
          <circle cx="6" cy="17" r="1.5" fill="#3B82F6"/>
          <circle cx="18" cy="17" r="1.5" fill="#3B82F6"/>
          <path d="M17 9.5V12h4.46L19.5 9.5H17z" fill="#3B82F6"/>
        </svg>
      </div>

      <!-- Direction indicator arrow (apunta en la dirección del movimiento) -->
      <div style="
        position: absolute;
        top: -8px;
        left: 50%;
        transform: translateX(-50%) rotate(${(heading || 0)}deg);
        transform-origin: center 30px;
        width: 0;
        height: 0;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-bottom: 10px solid #1D4ED8;
        z-index: 11;
      "></div>

      <style>
        @keyframes pulse-ring {
          0% {
            transform: translate(-50%, -50%) scale(0.5);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) scale(1.5);
            opacity: 0;
          }
        }
      </style>
    </div>
  `;
  return container.firstElementChild as HTMLElement;
}

// Type for AdvancedMarkerElement (since @types/google.maps might not have it yet)
type AdvancedMarkerElement = google.maps.marker.AdvancedMarkerElement;

// Helper para obtener lat/lng de LatLng o LatLngLiteral
function getLatLng(pos: google.maps.LatLng | google.maps.LatLngLiteral | null | undefined): { lat: number; lng: number } | null {
  if (!pos) return null;
  if (typeof (pos as google.maps.LatLng).lat === 'function') {
    return {
      lat: (pos as google.maps.LatLng).lat(),
      lng: (pos as google.maps.LatLng).lng()
    };
  }
  return pos as google.maps.LatLngLiteral;
}

// Componente interno del mapa
function MapComponent({
  showReturnLeg = false,
  returnLegDestination,
  locations,
  center,
  zoom = 12,
  showRoute = false,
  showSearch = false,
  driverLocation,
  focusLocation,
  onFocusComplete,
  onMarkerClick,
  onDriverMarkerClick,
  onPlaceSelect
}: Omit<RouteMapProps, 'apiKey'>) {
  const mapRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [markers, setMarkers] = useState<AdvancedMarkerElement[]>([]);
  const [directionsRenderer, setDirectionsRenderer] = useState<google.maps.DirectionsRenderer | null>(null);
  const [searchMarker, setSearchMarker] = useState<AdvancedMarkerElement | null>(null);
  const [returnLegPolyline, setReturnLegPolyline] = useState<google.maps.Polyline | null>(null);
  const driverMarkerRef = useRef<AdvancedMarkerElement | null>(null);
  const driverAnimationRef = useRef<number | null>(null); // Para cancelar animaciones
  const lastDriverUpdateRef = useRef<number>(0); // Timestamp de última actualización
  const hasFitBounds = useRef(false);
  const lastLocationsKey = useRef<string>('');
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const stackedGroupsRef = useRef<Map<string, MapLocation[]>>(new Map());

  // Inicializar mapa
  useEffect(() => {
    if (!mapRef.current || map) return;

    const defaultCenter = center || SANTIAGO_CENTER;

    const newMap = new google.maps.Map(mapRef.current, {
      center: defaultCenter,
      zoom,
      mapId: 'route-optimizer-map', // Required for AdvancedMarkerElement - styles must be configured in Google Cloud Console
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      zoomControl: true
    });

    setMap(newMap);

    const renderer = new google.maps.DirectionsRenderer({
      suppressMarkers: true,
      preserveViewport: true, // No ajustar zoom cuando se muestra la ruta
      polylineOptions: {
        strokeColor: '#4285F4',
        strokeWeight: 5,
        strokeOpacity: 0.8
      }
    });
    renderer.setMap(newMap);
    setDirectionsRenderer(renderer);
  }, [mapRef.current]);

  // Inicializar buscador de Places
  useEffect(() => {
    if (!map || !searchInputRef.current || !showSearch) return;

    const autocomplete = new google.maps.places.Autocomplete(searchInputRef.current, {
      componentRestrictions: { country: 'cl' },
      fields: ['formatted_address', 'geometry', 'name']
    });

    autocomplete.bindTo('bounds', map);

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();

      if (!place.geometry || !place.geometry.location) {
        return;
      }

      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();

      map.setCenter({ lat, lng });
      map.setZoom(16);

      if (searchMarker) {
        searchMarker.map = null;
      }

      // Use AdvancedMarkerElement for search marker
      const { AdvancedMarkerElement } = google.maps.marker;
      const newMarker = new AdvancedMarkerElement({
        position: { lat, lng },
        map,
        content: createMarkerElement('?', 'destination'),
        title: 'Ubicación seleccionada'
      });

      setSearchMarker(newMarker);

      if (onPlaceSelect) {
        onPlaceSelect({
          lat,
          lng,
          address: place.formatted_address || place.name || ''
        });
      }
    });

    return () => {
      google.maps.event.clearInstanceListeners(autocomplete);
    };
  }, [map, showSearch]);

  // Actualizar marcadores
  useEffect(() => {
    if (!map) return;

    // Crear clave única para las locations actuales
    const currentKey = locations.map(l => `${l.id}-${l.lat}-${l.lng}`).join('|');

    // Si las locations no cambiaron, no hacer nada
    if (currentKey === lastLocationsKey.current && markers.length > 0) {
      return;
    }
    lastLocationsKey.current = currentKey;

    // Limpiar marcadores anteriores
    markers.forEach(marker => { marker.map = null; });

    const { AdvancedMarkerElement } = google.maps.marker;
    const newMarkers: AdvancedMarkerElement[] = [];
    const bounds = new google.maps.LatLngBounds();

    // Agrupar locations por coordenadas para detectar edificios con múltiples paradas
    const groups = groupLocationsByCoordinates(locations);
    const processedCoords = new Set<string>();

    locations.forEach((location) => {
      const coordKey = `${location.lat.toFixed(5)},${location.lng.toFixed(5)}`;
      const position = { lat: location.lat, lng: location.lng };

      // Si ya procesamos este grupo de coordenadas, saltar
      if (processedCoords.has(coordKey)) {
        bounds.extend(position);
        return;
      }

      const group = groups.get(coordKey) || [location];

      if (group.length > 1 && location.type === 'stop') {
        // Múltiples paradas en el mismo punto - crear marcador apilado
        processedCoords.add(coordKey);
        const labels = group.map(l => l.label || '?');
        const statuses = group.map(l => l.status);

        // Guardar el grupo para referencia en el click
        stackedGroupsRef.current.set(coordKey, group);

        const marker = new AdvancedMarkerElement({
          position,
          map,
          content: createStackedMarkerElement(labels, group.length, statuses),
          title: `${group.length} paradas en este edificio: ${labels.join(', ')}`,
          zIndex: 100 // Por encima de marcadores normales
        });

        // Al hacer click, mostrar InfoWindow con opciones
        marker.addListener('click', () => {
          if (!map) return;

          // Cerrar InfoWindow anterior si existe
          if (infoWindowRef.current) {
            infoWindowRef.current.close();
          }

          // Crear contenido del InfoWindow
          const content = document.createElement('div');
          content.style.cssText = 'padding: 8px; min-width: 180px;';
          content.innerHTML = `
            <div style="font-weight: 600; margin-bottom: 8px; color: #6D28D9; font-size: 13px;">
              ${group.length} paradas en este edificio
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
              ${group.map((loc, idx) => `
                <button
                  data-stop-index="${idx}"
                  style="
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 12px;
                    background: #F3F4F6;
                    border: 1px solid #E5E7EB;
                    border-radius: 6px;
                    cursor: pointer;
                    text-align: left;
                    font-size: 13px;
                    transition: background 0.15s;
                  "
                  onmouseover="this.style.background='#E5E7EB'"
                  onmouseout="this.style.background='#F3F4F6'"
                >
                  <span style="
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 24px;
                    height: 24px;
                    background: #4285F4;
                    color: white;
                    border-radius: 50%;
                    font-weight: 600;
                    font-size: 11px;
                  ">${loc.label}</span>
                  <span style="color: #374151;">Parada ${loc.label}</span>
                </button>
              `).join('')}
            </div>
          `;

          // Agregar event listeners a los botones
          content.querySelectorAll('button').forEach((btn) => {
            btn.addEventListener('click', (e) => {
              const idx = parseInt((e.currentTarget as HTMLElement).dataset.stopIndex || '0');
              if (onMarkerClick && group[idx]) {
                onMarkerClick(group[idx]);
              }
              if (infoWindowRef.current) {
                infoWindowRef.current.close();
              }
            });
          });

          // Crear y abrir InfoWindow
          const infoWindow = new google.maps.InfoWindow({
            content,
            position
          });
          infoWindow.open(map);
          infoWindowRef.current = infoWindow;
        });

        newMarkers.push(marker);
      } else {
        // Marcador normal (único o depot/origin)
        processedCoords.add(coordKey);

        const marker = new AdvancedMarkerElement({
          position,
          map,
          content: createMarkerElement(location.label || '?', location.type || 'stop', location.priority, location.status),
          title: location.label
        });

        if (onMarkerClick) {
          marker.addListener('click', () => onMarkerClick(location));
        }

        newMarkers.push(marker);
      }

      bounds.extend(position);
    });

    setMarkers(newMarkers);

    // Solo hacer fitBounds la primera vez, no resetear el zoom del usuario
    if (!hasFitBounds.current && locations.length > 0) {
      hasFitBounds.current = true;
      if (locations.length > 1) {
        map.fitBounds(bounds);
        // Limitar zoom máximo
        const listener = google.maps.event.addListener(map, 'idle', () => {
          const currentZoom = map.getZoom();
          if (currentZoom && currentZoom > 15) {
            map.setZoom(15);
          }
          google.maps.event.removeListener(listener);
        });
      } else {
        map.setCenter({ lat: locations[0].lat, lng: locations[0].lng });
        map.setZoom(15);
      }
    }
  }, [map, locations]);

  // Dibujar ruta
  useEffect(() => {
    if (!map || !directionsRenderer || !showRoute || locations.length < 2) {
      if (directionsRenderer) {
        directionsRenderer.setMap(null);
        directionsRenderer.setMap(map);
      }
      return;
    }

    const directionsService = new google.maps.DirectionsService();

    const origin = locations[0];
    const destination = locations[locations.length - 1];
    const waypoints = locations.slice(1, -1).map(loc => ({
      location: { lat: loc.lat, lng: loc.lng },
      stopover: true
    }));

    directionsService.route(
      {
        origin: { lat: origin.lat, lng: origin.lng },
        destination: { lat: destination.lat, lng: destination.lng },
        waypoints,
        travelMode: google.maps.TravelMode.DRIVING,
        optimizeWaypoints: false
      },
      (result: google.maps.DirectionsResult | null, status: google.maps.DirectionsStatus) => {
        if (status === google.maps.DirectionsStatus.OK && result) {
          directionsRenderer.setDirections(result);
        }
      }
    );
  }, [map, directionsRenderer, showRoute, locations]);

  // Dibujar línea de retorno al depot
  useEffect(() => {
    // Limpiar polyline anterior
    if (returnLegPolyline) {
      returnLegPolyline.setMap(null);
    }

    if (!map || !showReturnLeg || !returnLegDestination || locations.length < 2) {
      return;
    }

    const lastStop = locations[locations.length - 1];
    const directionsService = new google.maps.DirectionsService();

    directionsService.route(
      {
        origin: { lat: lastStop.lat, lng: lastStop.lng },
        destination: returnLegDestination,
        travelMode: google.maps.TravelMode.DRIVING
      },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK && result) {
          const route = result.routes[0];
          if (route && route.overview_path) {
            const polyline = new google.maps.Polyline({
              path: route.overview_path,
              strokeColor: '#22C55E', // Verde para retorno
              strokeWeight: 4,
              strokeOpacity: 0.8,
              icons: [{
                icon: {
                  path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                  scale: 3,
                  strokeColor: '#16A34A'
                },
                offset: '100%'
              }]
            });
            polyline.setMap(map);
            setReturnLegPolyline(polyline);
          }
        }
      }
    );
  }, [map, showReturnLeg, returnLegDestination, locations]);

  // Manejar marcador del conductor con interpolación suave
  useEffect(() => {
    if (!map || !driverLocation) {
      // Cancelar animación en curso
      if (driverAnimationRef.current) {
        cancelAnimationFrame(driverAnimationRef.current);
        driverAnimationRef.current = null;
      }
      // Limpiar marcador si no hay ubicación
      if (driverMarkerRef.current) {
        driverMarkerRef.current.map = null;
        driverMarkerRef.current = null;
      }
      return;
    }

    const { AdvancedMarkerElement } = google.maps.marker;
    const targetPosition = { lat: driverLocation.lat, lng: driverLocation.lng };

    // Calcular tiempo desde última actualización para ajustar duración de animación
    const now = Date.now();
    const timeSinceLastUpdate = lastDriverUpdateRef.current > 0
      ? now - lastDriverUpdateRef.current
      : 0;
    lastDriverUpdateRef.current = now;

    if (driverMarkerRef.current) {
      // Cancelar animación anterior si existe
      if (driverAnimationRef.current) {
        cancelAnimationFrame(driverAnimationRef.current);
        driverAnimationRef.current = null;
      }

      const currentPos = getLatLng(driverMarkerRef.current.position);
      if (currentPos) {
        const startLat = currentPos.lat;
        const startLng = currentPos.lng;
        const endLat = targetPosition.lat;
        const endLng = targetPosition.lng;

        // Calcular distancia para determinar si vale la pena animar
        const deltaLat = Math.abs(endLat - startLat);
        const deltaLng = Math.abs(endLng - startLng);
        const significantMove = deltaLat > 0.00001 || deltaLng > 0.00001;

        if (significantMove) {
          // Duración de animación: 80% del intervalo entre actualizaciones
          // Mínimo 500ms, máximo 4000ms (para que no sea muy lento si hay lag)
          // Si es la primera vez, usar 1500ms por defecto
          const animDuration = timeSinceLastUpdate > 0
            ? Math.min(4000, Math.max(500, timeSinceLastUpdate * 0.8))
            : 1500;

          const startTime = now;

          const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / animDuration, 1);

            // Easing cubic-out para movimiento suave y natural
            const easeProgress = 1 - Math.pow(1 - progress, 3);

            const newLat = startLat + (endLat - startLat) * easeProgress;
            const newLng = startLng + (endLng - startLng) * easeProgress;

            if (driverMarkerRef.current) {
              driverMarkerRef.current.position = { lat: newLat, lng: newLng };
            }

            if (progress < 1 && driverMarkerRef.current) {
              driverAnimationRef.current = requestAnimationFrame(animate);
            } else {
              driverAnimationRef.current = null;
            }
          };

          driverAnimationRef.current = requestAnimationFrame(animate);
        } else {
          // Movimiento insignificante, solo actualizar posición
          driverMarkerRef.current.position = targetPosition;
        }
      } else {
        driverMarkerRef.current.position = targetPosition;
      }

      // Actualizar el contenido si cambió el heading o speed
      driverMarkerRef.current.content = createDriverMarkerElement(driverLocation.heading, driverLocation.speed);
    } else {
      // Crear nuevo marcador
      const marker = new AdvancedMarkerElement({
        position: targetPosition,
        map,
        content: createDriverMarkerElement(driverLocation.heading, driverLocation.speed),
        title: 'Conductor en ruta',
        zIndex: 1000 // Por encima de otros marcadores
      });

      // Agregar click handler para zoom al conductor
      if (onDriverMarkerClick) {
        marker.addListener('click', onDriverMarkerClick);
      }

      driverMarkerRef.current = marker;
    }

    // Cleanup: cancelar animación al desmontar o cambiar dependencias
    return () => {
      if (driverAnimationRef.current) {
        cancelAnimationFrame(driverAnimationRef.current);
        driverAnimationRef.current = null;
      }
    };
  }, [map, driverLocation]);

  // Manejar focus/zoom a una ubicación específica
  useEffect(() => {
    if (!map || !focusLocation) return;

    // Primero centrar en la ubicación y hacer zoom
    map.setCenter(focusLocation);
    map.setZoom(16);

    // Después de que el mapa se actualice, desplazar hacia la izquierda
    // para que el marcador no quede tapado por el panel derecho (450px)
    setTimeout(() => {
      // panBy mueve el mapa en píxeles (positivo = derecha/abajo)
      // Movemos hacia la derecha para que el centro visual quede a la izquierda del panel
      map.panBy(200, 0); // 200px hacia la derecha = marcador queda más a la izquierda
    }, 100);

    // Notificar que se completó el focus
    if (onFocusComplete) {
      setTimeout(onFocusComplete, 600);
    }
  }, [map, focusLocation]);

  return (
    <div className="relative w-full h-full min-h-[400px]">
      {showSearch && (
        <div className="absolute top-3 left-3 right-3 z-10">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Buscar dirección en Chile..."
            className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg shadow-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      )}
      <div ref={mapRef} className="w-full h-full rounded-lg" />
    </div>
  );
}

// Render de estados de carga
function renderStatus(status: Status): ReactElement {
  if (status === Status.LOADING) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-100 rounded-lg">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
          <div className="text-gray-500">Cargando mapa...</div>
        </div>
      </div>
    );
  }
  if (status === Status.FAILURE) {
    return (
      <div className="flex items-center justify-center h-full bg-red-50 rounded-lg">
        <div className="text-red-500">Error al cargar el mapa</div>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center h-full bg-gray-100 rounded-lg">
      <div className="text-gray-500">Inicializando...</div>
    </div>
  );
}

// Componente principal exportado
export function RouteMap({ apiKey, ...props }: RouteMapProps) {
  if (!apiKey) {
    return (
      <div className="flex items-center justify-center h-full bg-yellow-50 rounded-lg border border-yellow-200">
        <div className="text-yellow-700 text-center">
          <p className="font-medium">API Key de Google Maps no configurada</p>
          <p className="text-sm mt-1">Configura GOOGLE_MAPS_API_KEY en las variables de entorno</p>
        </div>
      </div>
    );
  }

  return (
    <Wrapper apiKey={apiKey} libraries={['places', 'marker']} render={renderStatus}>
      <MapComponent {...props} />
    </Wrapper>
  );
}
