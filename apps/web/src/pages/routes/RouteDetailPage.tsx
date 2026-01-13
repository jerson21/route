import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { RouteMap } from '../../components/map/RouteMap';
import { AddressSearch } from '../../components/search/AddressSearch';
import { StopDetailPanel } from '../../components/stops/StopDetailPanel';
import { ToastContainer, useToast } from '../../components/ui/Toast';
import {
  MapPin, User, Play, CheckCircle, Trash2, ArrowLeft,
  Plus, Database, Search, X, GripVertical, Navigation, Loader2, Edit2, ChevronDown, Home, Check, Clock, AlertTriangle
} from 'lucide-react';

interface Stop {
  id: string;
  sequenceOrder: number;
  status: string;
  estimatedArrival?: string;
  originalEstimatedArrival?: string; // ETA original congelado al iniciar ruta
  estimatedMinutes?: number;
  travelMinutesFromPrevious?: number;
  timeWindowStart?: string;
  timeWindowEnd?: string;
  priority?: number;
  address: {
    id: string;
    fullAddress: string;
    unit?: string; // Depto, Casa, Oficina, Local, etc.
    customerName?: string;
    customerPhone?: string;
    latitude?: number;
    longitude?: number;
  };
}

interface RouteDetail {
  id: string;
  name: string;
  description?: string;
  status: string;
  scheduledDate?: string;
  startedAt?: string;
  completedAt?: string;
  optimizedAt?: string;
  totalDistanceKm?: number;
  totalDurationMin?: number;
  departureTime?: string; // HH:mm format, route-specific override
  depotReturnTime?: string; // ISO datetime
  loadedAt?: string; // Cuando se cargó el camión
  actualStartTime?: string; // Hora real de inicio
  originAddress?: string;
  originLatitude?: number;
  originLongitude?: number;
  // Ubicación en vivo del conductor
  driverLatitude?: number;
  driverLongitude?: number;
  driverLocationAt?: string;
  driverHeading?: number;
  driverSpeed?: number;
  depot?: {
    id: string;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    defaultDepartureTime?: string;
    defaultServiceMinutes?: number;
  };
  createdBy?: { id: string; firstName: string; lastName: string };
  assignedTo?: { id: string; firstName: string; lastName: string; phone?: string };
  stops: Stop[];
}

interface Driver {
  id: string;
  firstName: string;
  lastName: string;
}

interface DbAddress {
  id: string;
  fullAddress: string;
  latitude?: number;
  longitude?: number;
  customerName?: string;
  geocodeStatus: string;
}

interface Depot {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  defaultDepartureTime?: string;
  defaultServiceMinutes?: number;
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SCHEDULED: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700'
};

const statusLabels: Record<string, string> = {
  DRAFT: 'Borrador',
  SCHEDULED: 'Programada',
  IN_PROGRESS: 'En Progreso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada'
};

export function RouteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toasts, addToast, removeToast } = useToast();
  const [route, setRoute] = useState<RouteDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedDriver, setSelectedDriver] = useState('');
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Para agregar direcciones
  const [showAddStops, setShowAddStops] = useState(false);
  const [addMethod, setAddMethod] = useState<'search' | 'database' | null>(null);
  const [dbAddresses, setDbAddresses] = useState<DbAddress[]>([]);
  const [dbSearch, setDbSearch] = useState('');
  const [loadingDb, setLoadingDb] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [firstStopId, setFirstStopId] = useState<string | null>(null); // Para forzar primera parada en optimización
  const [useHaversine, setUseHaversine] = useState(true); // Modo económico (Haversine) por defecto
  const [depotReturnTime, setDepotReturnTime] = useState<Date | null>(null); // Hora estimada de llegada al depot

  // Para editar nombre
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');

  // Para editar hora de salida
  const [editingDepartureTime, setEditingDepartureTime] = useState(false);
  const [newDepartureTime, setNewDepartureTime] = useState('');
  const [pendingDepartureTime, setPendingDepartureTime] = useState<string | null>(null);

  // Simulación de hora de salida (para recalcular tiempos client-side)
  const [simulatedDepartureTime, setSimulatedDepartureTime] = useState<string | null>(null);

  // Drag and drop
  const [draggedStop, setDraggedStop] = useState<string | null>(null);

  // Selected stop for detail panel
  const [selectedStop, setSelectedStop] = useState<{ id: string; index: number } | null>(null);

  // Delete confirmation modal
  const [deleteConfirm, setDeleteConfirm] = useState<{ stopId: string; address: string } | null>(null);

  // Para cambiar punto de origen
  const [showOriginModal, setShowOriginModal] = useState(false);
  const [depots, setDepots] = useState<Depot[]>([]);
  const [loadingDepots, setLoadingDepots] = useState(false);

  // Estado para confirmación de re-optimización al agregar parada
  const [pendingReoptimizeAfterAdd, setPendingReoptimizeAfterAdd] = useState(false);

  // Estado para agregar unit/indicaciones después de buscar en Google
  const [pendingGoogleAddress, setPendingGoogleAddress] = useState<{
    placeId: string;
    address: string;
    lat: number;
    lng: number;
  } | null>(null);
  const [googleUnit, setGoogleUnit] = useState('');
  const [googleNotes, setGoogleNotes] = useState('');

  // Location to focus/zoom on the map
  const [focusLocation, setFocusLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Live driver location for tracking
  const [driverLocation, setDriverLocation] = useState<{
    lat: number;
    lng: number;
    heading?: number;
    speed?: number;
    updatedAt?: string;
  } | null>(null);

  // Simulación de conductor (solo para desarrollo)
  const [isSimulating, setIsSimulating] = useState(false);
  const simulationRef = useRef<{ cancel: boolean }>({ cancel: false });

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

  const fetchRoute = async () => {
    try {
      setIsLoading(true);
      const response = await api.get(`/routes/${id}`);
      const routeData = response.data.data;
      setRoute(routeData);
      // Cargar depotReturnTime guardado en la ruta
      if (routeData.depotReturnTime) {
        setDepotReturnTime(new Date(routeData.depotReturnTime));
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Error al cargar la ruta');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDrivers = async () => {
    try {
      const response = await api.get('/users?role=DRIVER');
      setDrivers(response.data.data);
    } catch (err) {
      console.error('Error fetching drivers:', err);
    }
  };

  const fetchDbAddresses = async (searchTerm?: string) => {
    try {
      setLoadingDb(true);
      const params = new URLSearchParams();
      if (searchTerm) params.append('search', searchTerm);
      params.append('status', 'SUCCESS');
      params.append('limit', '50');

      const response = await api.get(`/addresses?${params.toString()}`);
      setDbAddresses(response.data.data);
    } catch (error) {
      console.error('Error fetching addresses:', error);
    } finally {
      setLoadingDb(false);
    }
  };

  const fetchDepots = async () => {
    try {
      setLoadingDepots(true);
      const response = await api.get('/depots');
      setDepots(response.data.data);
    } catch (error) {
      console.error('Error fetching depots:', error);
    } finally {
      setLoadingDepots(false);
    }
  };

  const handleChangeOrigin = async (depotId: string, shouldReoptimize: boolean = false) => {
    try {
      setActionLoading(true);
      await api.put(`/routes/${id}`, {
        depotId,
        originAddress: null,
        originLatitude: null,
        originLongitude: null
      });

      // Re-optimizar si se solicitó y hay suficientes paradas
      if (shouldReoptimize && route && route.stops.length >= 2) {
        setIsOptimizing(true);
        try {
          const optimizeResponse = await api.post(`/routes/${id}/optimize`);
          const optimization = optimizeResponse.data.optimization;
          addToast(`Origen actualizado y ruta re-optimizada: ${(optimization.totalDistance / 1000).toFixed(1)} km, ${Math.round(optimization.totalDuration)} min`, 'success');
        } catch (optErr: any) {
          addToast(optErr.response?.data?.error || 'Error al re-optimizar', 'error');
        } finally {
          setIsOptimizing(false);
        }
      } else {
        addToast('Punto de origen actualizado', 'success');
      }

      await fetchRoute();
      setShowOriginModal(false);
      setPendingOriginChange(null);
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Error al cambiar origen', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Estado para confirmación de re-optimización al cambiar origen
  const [pendingOriginChange, setPendingOriginChange] = useState<string | null>(null);

  const handleOriginChangeRequest = (depotId: string) => {
    // Si hay paradas, preguntar si quiere re-optimizar
    if (route && route.stops.length >= 2) {
      setPendingOriginChange(depotId);
    } else {
      // Si no hay suficientes paradas, solo cambiar el origen
      handleChangeOrigin(depotId, false);
    }
  };

  useEffect(() => {
    fetchRoute();
    fetchDrivers();
  }, [id]);

  useEffect(() => {
    if (addMethod === 'database') {
      fetchDbAddresses(dbSearch);
    }
  }, [addMethod, dbSearch]);

  useEffect(() => {
    if (showOriginModal) {
      fetchDepots();
    }
  }, [showOriginModal]);

  // Polling for live driver location when route is IN_PROGRESS
  useEffect(() => {
    if (!route || route.status !== 'IN_PROGRESS') {
      setDriverLocation(null);
      return;
    }

    // Initial load from route data
    if (route.driverLatitude && route.driverLongitude) {
      setDriverLocation({
        lat: route.driverLatitude,
        lng: route.driverLongitude,
        heading: route.driverHeading,
        speed: route.driverSpeed,
        updatedAt: route.driverLocationAt
      });
    }

    // Poll for updates every 5 seconds
    const pollInterval = setInterval(async () => {
      try {
        const response = await api.get(`/routes/${id}/driver-location`);
        const location = response.data.data;
        if (location && location.latitude && location.longitude) {
          setDriverLocation({
            lat: location.latitude,
            lng: location.longitude,
            heading: location.heading,
            speed: location.speed,
            updatedAt: location.updatedAt
          });
        }
      } catch (err) {
        // Silently fail - location might not be available
        console.debug('Could not fetch driver location:', err);
      }
    }, 5000);

    return () => clearInterval(pollInterval);
  }, [route?.status, id]);


  const handleAssignDriver = async () => {
    if (!selectedDriver) return;

    try {
      setActionLoading(true);
      await api.post(`/routes/${id}/assign`, { driverId: selectedDriver });
      await fetchRoute();
      setShowAssignModal(false);
      setSelectedDriver('');
      addToast('Chofer asignado y ruta programada', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Error al asignar chofer', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartRoute = async () => {
    try {
      setActionLoading(true);
      await api.post(`/routes/${id}/start`);
      await fetchRoute();
      addToast('Ruta iniciada', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Error al iniciar ruta', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCompleteRoute = async () => {
    if (!confirm('¿Estás seguro de completar esta ruta?')) return;

    try {
      setActionLoading(true);
      await api.post(`/routes/${id}/complete`);
      await fetchRoute();
      addToast('Ruta completada', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Error al completar ruta', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteRoute = async () => {
    if (!confirm('¿Estás seguro de eliminar esta ruta?')) return;

    try {
      setActionLoading(true);
      await api.delete(`/routes/${id}`);
      navigate('/routes');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Error al eliminar ruta', 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleUpdateName = async () => {
    if (!newName.trim()) return;

    try {
      await api.put(`/routes/${id}`, { name: newName });
      await fetchRoute();
      setEditingName(false);
      addToast('Nombre actualizado', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Error al actualizar nombre', 'error');
    }
  };

  const handleUpdateDepartureTimeRequest = () => {
    // Si hay paradas con tiempos de viaje, preguntar si re-optimizar
    if (route && route.stops.length >= 2 && route.stops.some(s => s.travelMinutesFromPrevious)) {
      setPendingDepartureTime(newDepartureTime || null);
    } else {
      handleUpdateDepartureTime(false);
    }
  };

  const handleUpdateDepartureTime = async (shouldReoptimize: boolean) => {
    const timeToSave = pendingDepartureTime !== null ? pendingDepartureTime : (newDepartureTime || null);
    try {
      await api.put(`/routes/${id}`, { departureTime: timeToSave });

      if (shouldReoptimize && route && route.stops.length >= 2) {
        setIsOptimizing(true);
        try {
          const optimizeResponse = await api.post(`/routes/${id}/optimize`);
          const optimization = optimizeResponse.data.optimization;
          addToast(`Hora actualizada y ruta re-optimizada: ${(optimization.totalDistance / 1000).toFixed(1)} km, ${Math.round(optimization.totalDuration)} min`, 'success');
        } catch (optErr: any) {
          addToast(optErr.response?.data?.error || 'Error al re-optimizar', 'error');
        } finally {
          setIsOptimizing(false);
        }
      } else {
        addToast('Hora de salida actualizada', 'success');
      }

      await fetchRoute();
      setEditingDepartureTime(false);
      setSimulatedDepartureTime(null);
      setPendingDepartureTime(null);
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Error al actualizar hora de salida', 'error');
    }
  };

  // Recalcular tiempos de llegada client-side basado en una hora de salida
  const recalculateArrivalTimes = (departureTimeStr: string): Map<string, Date> => {
    const arrivals = new Map<string, Date>();
    if (!route || route.stops.length === 0) return arrivals;

    // Parse departure time (HH:mm) to today's date
    const [hours, minutes] = departureTimeStr.split(':').map(Number);
    const baseDate = route.scheduledDate ? new Date(route.scheduledDate) : new Date();
    baseDate.setHours(hours, minutes, 0, 0);

    let currentTime = new Date(baseDate);

    for (const stop of route.stops) {
      // Add travel time from previous stop (or depot)
      const travelMinutes = stop.travelMinutesFromPrevious || 0;
      currentTime = new Date(currentTime.getTime() + travelMinutes * 60 * 1000);

      // This is the arrival time
      arrivals.set(stop.id, new Date(currentTime));

      // Add service/stop time for next calculation
      const serviceMinutes = stop.estimatedMinutes || 15;
      currentTime = new Date(currentTime.getTime() + serviceMinutes * 60 * 1000);
    }

    return arrivals;
  };

  // Handle "Ahora" button - set simulation to current time
  const handleSimulateNow = () => {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    setSimulatedDepartureTime(timeStr);
  };

  // Agregar dirección desde búsqueda Google - muestra modal para agregar unit/indicaciones
  const handleAddressSelect = (place: { placeId: string; address: string; lat: number; lng: number }) => {
    setPendingGoogleAddress(place);
    setGoogleUnit('');
    setGoogleNotes('');
  };

  // Confirmar dirección de Google con unit/indicaciones opcional
  const confirmGoogleAddress = async () => {
    if (!pendingGoogleAddress) return;

    try {
      const addressResponse = await api.post('/addresses', {
        street: pendingGoogleAddress.address.split(',')[0] || pendingGoogleAddress.address,
        unit: googleUnit || undefined,
        city: 'Santiago',
        country: 'Chile',
        latitude: pendingGoogleAddress.lat,
        longitude: pendingGoogleAddress.lng,
        notes: googleNotes || undefined,
        geocodeStatus: 'MANUAL'
      });

      await api.post(`/routes/${id}/stops`, {
        addressIds: [addressResponse.data.data.id]
      });

      setPendingGoogleAddress(null);
      setGoogleUnit('');
      setGoogleNotes('');
      await fetchRoute();
      addToast('Dirección agregada a la ruta', 'success');

      if (route && route.optimizedAt && route.stops.length >= 2) {
        setPendingReoptimizeAfterAdd(true);
      }
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Error al agregar dirección', 'error');
    }
  };

  // Agregar dirección desde BD
  const handleAddFromDb = async (addressId: string) => {
    try {
      await api.post(`/routes/${id}/stops`, {
        addressIds: [addressId]
      });
      await fetchRoute();
      addToast('Dirección agregada a la ruta', 'success');

      // Si la ruta estaba optimizada y tiene al menos 2 paradas, preguntar si re-optimizar
      if (route && route.optimizedAt && route.stops.length >= 2) {
        setPendingReoptimizeAfterAdd(true);
      }
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Error al agregar dirección', 'error');
    }
  };

  // Confirmar re-optimización después de agregar parada
  const handleReoptimizeAfterAdd = async (shouldReoptimize: boolean) => {
    setPendingReoptimizeAfterAdd(false);
    if (shouldReoptimize) {
      await handleOptimize();
    }
  };

  // Mostrar confirmación para eliminar parada
  const handleRemoveStopClick = (stopId: string, address: string) => {
    setDeleteConfirm({ stopId, address });
  };

  // Confirmar eliminación de parada
  const confirmRemoveStop = async (reoptimize: boolean) => {
    if (!deleteConfirm) return;

    try {
      await api.delete(`/routes/${id}/stops/${deleteConfirm.stopId}`);
      setDeleteConfirm(null);

      if (reoptimize && route && route.stops.length > 2) {
        // Re-optimizar la ruta
        setIsOptimizing(true);
        try {
          await api.post(`/routes/${id}/optimize`, {});
        } catch (err) {
          console.warn('Re-optimization failed:', err);
        } finally {
          setIsOptimizing(false);
        }
      }

      await fetchRoute();
      addToast('Parada eliminada', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Error al eliminar parada', 'error');
    }
  };

  // Drag and drop reorder
  const handleDragStart = (stopId: string) => {
    setDraggedStop(stopId);
  };

  const handleDragOver = (e: React.DragEvent, targetStopId: string) => {
    e.preventDefault();
    if (!draggedStop || draggedStop === targetStopId) return;
  };

  const handleDrop = async (e: React.DragEvent, targetStopId: string) => {
    e.preventDefault();
    if (!draggedStop || !route || draggedStop === targetStopId) return;

    const draggedIndex = route.stops.findIndex(s => s.id === draggedStop);
    const targetIndex = route.stops.findIndex(s => s.id === targetStopId);

    if (draggedIndex === -1 || targetIndex === -1) return;

    const newStops = [...route.stops];
    const [removed] = newStops.splice(draggedIndex, 1);
    newStops.splice(targetIndex, 0, removed);

    try {
      await api.put(`/routes/${id}/stops/reorder`, {
        stopIds: newStops.map(s => s.id)
      });
      await fetchRoute();
      addToast('Orden actualizado', 'success');
    } catch (err: any) {
      addToast(err.response?.data?.error || 'Error al reordenar', 'error');
    }

    setDraggedStop(null);
  };

  // Fallback: optimizar usando Google Directions API del cliente
  const optimizeWithDirectionsAPI = async () => {
    const stops = route!.stops.filter(s => s.address.latitude && s.address.longitude);
    if (stops.length < 2) return false;

    const directionsService = new google.maps.DirectionsService();

    // Usar depot como origen si existe
    const depotOrigin = route!.depot ? {
      lat: route!.depot.latitude,
      lng: route!.depot.longitude
    } : null;

    const origin = depotOrigin || { lat: stops[0].address.latitude!, lng: stops[0].address.longitude! };
    const destination = { lat: stops[stops.length - 1].address.latitude!, lng: stops[stops.length - 1].address.longitude! };

    const waypoints = (depotOrigin ? stops : stops.slice(1, -1)).map(stop => ({
      location: { lat: stop.address.latitude!, lng: stop.address.longitude! },
      stopover: true
    }));

    if (waypoints.length === 0) return false;

    return new Promise<boolean>((resolve) => {
      directionsService.route(
        {
          origin,
          destination,
          waypoints,
          travelMode: google.maps.TravelMode.DRIVING,
          optimizeWaypoints: true
        },
        async (result, status) => {
          if (status === google.maps.DirectionsStatus.OK && result?.routes[0]?.waypoint_order) {
            const waypointOrder = result.routes[0].waypoint_order;
            const stopsToReorder = depotOrigin ? stops : stops.slice(1, -1);
            const optimizedMiddle = waypointOrder.map(i => stopsToReorder[i]);
            const optimizedStops = depotOrigin
              ? optimizedMiddle
              : [stops[0], ...optimizedMiddle, stops[stops.length - 1]];

            try {
              await api.put(`/routes/${id}/stops/reorder`, {
                stopIds: optimizedStops.map(s => s.id)
              });
              resolve(true);
            } catch {
              resolve(false);
            }
          } else {
            resolve(false);
          }
        }
      );
    });
  };

  // Optimizar ruta - intenta backend primero, fallback a cliente
  const handleOptimize = async () => {
    if (!route || route.stops.length < 2) {
      addToast('Necesitas al menos 2 paradas para optimizar', 'warning');
      return;
    }

    // DEBUG: Log current firstStopId state
    console.log('[OPTIMIZE FRONTEND] Starting optimization with firstStopId:', firstStopId);
    const selectedStop = firstStopId ? route.stops.find(s => s.id === firstStopId) : null;
    if (selectedStop) {
      console.log('[OPTIMIZE FRONTEND] Selected first stop:', selectedStop.address.fullAddress);
    }

    setIsOptimizing(true);

    try {
      // Obtener hora de salida: ruta > depot > 08:00
      const departureTimeStr = route.departureTime || route.depot?.defaultDepartureTime || '08:00';
      const [depHours, depMinutes] = departureTimeStr.split(':').map(Number);

      // Usar la fecha programada o la fecha actual
      const baseDate = route.scheduledDate ? new Date(route.scheduledDate) : new Date();
      const startDate = new Date(baseDate);
      startDate.setHours(depHours, depMinutes, 0, 0);

      const endDate = new Date(baseDate);
      endDate.setHours(23, 59, 0, 0); // Hasta el final del día

      const payload = {
        driverStartTime: startDate.toISOString(),
        driverEndTime: endDate.toISOString(),
        firstStopId: firstStopId || undefined,
        force: true, // Siempre recalcular cuando el usuario hace clic
        useHaversine // Modo económico (Haversine) vs Google Matrix API
      };
      console.log('[OPTIMIZE FRONTEND] Hora de salida:', departureTimeStr);
      console.log('[OPTIMIZE FRONTEND] Modo:', useHaversine ? 'Haversine (GRATIS)' : 'Google Matrix API');
      console.log('[OPTIMIZE FRONTEND] Sending payload:', JSON.stringify(payload, null, 2));

      // Intentar optimizacion del backend (con soporte de ventanas de tiempo)
      const response = await api.post(`/routes/${id}/optimize`, payload);

      const { optimization } = response.data;

      if (optimization.warnings && optimization.warnings.length > 0) {
        addToast(`Ruta optimizada con advertencias`, 'warning');
      } else {
        addToast(`Ruta optimizada: ${(optimization.totalDistance / 1000).toFixed(1)} km, ${Math.round(optimization.totalDuration)} min`, 'success');
      }

      console.log(`Optimizacion backend completada:
        - Distancia: ${optimization.totalDistance ? (optimization.totalDistance / 1000).toFixed(1) : '?'} km
        - Duracion: ${optimization.totalDuration ? Math.round(optimization.totalDuration) : '?'} min
        - Con ventanas de tiempo: ${optimization.hasTimeWindows ? 'Si' : 'No'}
        - Llegada al depot: ${optimization.depotReturnTime || 'N/A'}
        - Return leg duration: ${optimization.returnLegDuration || 'N/A'} min`);
      console.log('[DEBUG] optimization object:', JSON.stringify(optimization, null, 2));

      // Guardar hora de retorno al depot
      if (optimization.depotReturnTime) {
        const returnTime = new Date(optimization.depotReturnTime);
        console.log('[DEBUG] Setting depotReturnTime:', returnTime.toISOString(), '-> local:', returnTime.toLocaleTimeString('es-CL'));
        setDepotReturnTime(returnTime);
      } else {
        console.log('[DEBUG] depotReturnTime is null or undefined');
      }

      await fetchRoute();
    } catch (err: any) {
      console.warn('Backend optimization failed, trying client-side:', err);

      // Fallback a optimizacion del cliente (solo por distancia)
      const success = await optimizeWithDirectionsAPI();
      if (success) {
        console.log('Optimizacion cliente completada (solo por distancia)');
        await fetchRoute();
        addToast('Ruta optimizada (por distancia)', 'success');
      } else {
        addToast('Error al optimizar la ruta', 'error');
      }
    } finally {
      setIsOptimizing(false);
    }
  };

  const isAddressInRoute = (addressId: string) =>
    route?.stops.some(s => s.address.id === addressId) || false;

  // Función para simular movimiento del conductor
  const handleSimulateDriver = async () => {
    if (!route || !route.depot) return;

    setIsSimulating(true);
    simulationRef.current.cancel = false;

    // Construir puntos: depot -> paradas -> depot
    const points: { lat: number; lng: number; name: string }[] = [];

    points.push({ lat: route.depot.latitude, lng: route.depot.longitude, name: 'Depot' });

    for (const stop of route.stops) {
      if (stop.address.latitude && stop.address.longitude) {
        points.push({
          lat: stop.address.latitude,
          lng: stop.address.longitude,
          name: stop.address.customerName || `Parada ${stop.sequenceOrder}`
        });
      }
    }

    points.push({ lat: route.depot.latitude, lng: route.depot.longitude, name: 'Retorno' });

    const calculateHeading = (from: { lat: number; lng: number }, to: { lat: number; lng: number }) => {
      const dLon = (to.lng - from.lng) * Math.PI / 180;
      const lat1 = from.lat * Math.PI / 180;
      const lat2 = to.lat * Math.PI / 180;
      const y = Math.sin(dLon) * Math.cos(lat2);
      const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
      let heading = Math.atan2(y, x) * 180 / Math.PI;
      return (heading + 360) % 360;
    };

    try {
      for (let i = 0; i < points.length - 1 && !simulationRef.current.cancel; i++) {
        const from = points[i];
        const to = points[i + 1];
        const heading = calculateHeading(from, to);
        const steps = 8;

        for (let step = 0; step <= steps && !simulationRef.current.cancel; step++) {
          const t = step / steps;
          const lat = from.lat + (to.lat - from.lat) * t;
          const lng = from.lng + (to.lng - from.lng) * t;
          const speed = step === 0 || step === steps ? 0 : 30 + Math.random() * 20;

          try {
            await api.post(`/routes/${id}/location`, { latitude: lat, longitude: lng, heading, speed });
          } catch (err) {
            console.error('Error updating location:', err);
          }

          await new Promise(r => setTimeout(r, 1500)); // 1.5 segundos entre updates
        }

        // Pausa en parada
        if (i < points.length - 2 && !simulationRef.current.cancel) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }

      if (!simulationRef.current.cancel) {
        addToast('Simulación completada', 'success');
      }
    } finally {
      setIsSimulating(false);
    }
  };

  const handleStopSimulation = () => {
    simulationRef.current.cancel = true;
    setIsSimulating(false);
    addToast('Simulación detenida', 'info');
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !route) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || 'Ruta no encontrada'}</p>
          <button
            onClick={() => navigate('/routes')}
            className="text-blue-600 hover:text-blue-800"
          >
            Volver a rutas
          </button>
        </div>
      </div>
    );
  }

  const mapLocations: Array<{
    id: string;
    lat: number;
    lng: number;
    label: string;
    type: 'origin' | 'stop' | 'destination';
    priority?: number;
  }> = route.stops
    .filter(stop => stop.address.latitude && stop.address.longitude)
    .map((stop, index) => ({
      id: stop.id,
      lat: stop.address.latitude!,
      lng: stop.address.longitude!,
      label: String(index + 1),
      type: 'stop' as const,
      priority: stop.priority
    }));

  // Agregar depot como punto de inicio
  if (route.depot) {
    mapLocations.unshift({
      id: 'depot',
      lat: route.depot.latitude,
      lng: route.depot.longitude,
      label: 'D',
      type: 'origin'
    });
  }

  const isDraft = route.status === 'DRAFT';
  const canEdit = route.status === 'DRAFT' || route.status === 'SCHEDULED' || route.status === 'IN_PROGRESS';

  return (
    <div className="h-full flex">
      {/* Left Panel - Route Details */}
      <div className="w-[400px] flex flex-col border-r border-gray-200 bg-white">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200">
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={() => navigate('/routes')}
              className="p-1 hover:bg-gray-100 rounded"
            >
              <ArrowLeft className="w-5 h-5 text-gray-500" />
            </button>
            {editingName ? (
              <div className="flex-1 flex items-center gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="flex-1 text-lg font-semibold border-b-2 border-blue-500 focus:outline-none"
                  autoFocus
                  onKeyPress={(e) => e.key === 'Enter' && handleUpdateName()}
                />
                <button onClick={handleUpdateName} className="text-green-600">
                  <CheckCircle className="w-5 h-5" />
                </button>
                <button onClick={() => setEditingName(false)} className="text-gray-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <div className="flex-1 flex items-center gap-2">
                <h1 className="text-lg font-semibold text-gray-900">{route.name}</h1>
                {isDraft && (
                  <button
                    onClick={() => { setNewName(route.name); setEditingName(true); }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
            <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColors[route.status]}`}>
              {statusLabels[route.status]}
            </span>
          </div>

          {/* Quick Info */}
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <span className="flex items-center gap-1">
              <MapPin className="w-4 h-4" />
              {route.stops.length} paradas
            </span>
            {route.assignedTo && (
              <span className="flex items-center gap-1">
                <User className="w-4 h-4" />
                {route.assignedTo.firstName}
              </span>
            )}
            {/* Departure Time - inline */}
            {route.depot && (
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {editingDepartureTime ? (
                  <span className="flex items-center gap-1">
                    <input
                      type="time"
                      value={newDepartureTime}
                      onChange={(e) => setNewDepartureTime(e.target.value)}
                      className="px-1 py-0.5 text-sm border border-gray-300 rounded w-20"
                      autoFocus
                    />
                    <button onClick={handleUpdateDepartureTimeRequest} className="text-green-600">
                      <CheckCircle className="w-4 h-4" />
                    </button>
                    <button onClick={() => setEditingDepartureTime(false)} className="text-gray-400">
                      <X className="w-4 h-4" />
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => {
                      if (canEdit) {
                        setNewDepartureTime(route.departureTime || route.depot?.defaultDepartureTime || '08:00');
                        setEditingDepartureTime(true);
                      }
                    }}
                    disabled={!canEdit}
                    className={`${simulatedDepartureTime ? 'text-orange-600' : 'text-gray-700'} ${canEdit ? 'hover:text-blue-600' : ''}`}
                    title={canEdit ? 'Click para editar' : undefined}
                  >
                    {simulatedDepartureTime || route.departureTime || route.depot?.defaultDepartureTime || '08:00'}
                  </button>
                )}
                {simulatedDepartureTime && (
                  <button
                    onClick={() => setSimulatedDepartureTime(null)}
                    className="text-gray-400 hover:text-gray-600"
                    title="Quitar simulación"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
                {!simulatedDepartureTime && (route.optimizedAt || route.stops.some(s => s.travelMinutesFromPrevious)) && (
                  <button
                    onClick={handleSimulateNow}
                    className="text-xs text-orange-600 hover:text-orange-700 font-medium"
                    title="Simular salida ahora"
                  >
                    Ahora
                  </button>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Depot Info - Compact */}
        {route.depot && (
          <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 flex items-center gap-2 text-sm">
            <div className="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
              <span className="text-white text-xs font-medium">D</span>
            </div>
            <span className="text-gray-700 font-medium truncate flex-1">{route.depot.name}</span>
            {canEdit && (
              <button
                onClick={() => setShowOriginModal(true)}
                className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                title="Cambiar depot"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* Option to add depot if none exists */}
        {!route.depot && canEdit && (
          <div className="px-4 py-3 border-b border-gray-200 bg-yellow-50">
            <div className="flex items-center gap-2 text-sm">
              <div className="w-6 h-6 bg-yellow-400 rounded-full flex items-center justify-center flex-shrink-0">
                <Home className="w-3 h-3 text-yellow-800" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-yellow-800">Sin depot configurado</p>
                <p className="text-yellow-600 text-xs">Selecciona un depot para poder optimizar la ruta</p>
              </div>
              <button
                onClick={() => setShowOriginModal(true)}
                className="px-3 py-1.5 text-xs bg-yellow-200 text-yellow-800 rounded hover:bg-yellow-300 font-medium"
              >
                Seleccionar
              </button>
            </div>
          </div>
        )}

        {/* Actions Bar */}
        <div className="px-4 py-3 border-b border-gray-200 space-y-2">
          {/* Primera fila: Agregar paradas */}
          {canEdit && (
            <button
              onClick={() => setShowAddStops(!showAddStops)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
            >
              <Plus className="w-4 h-4" />
              Agregar paradas
              <ChevronDown className={`w-4 h-4 transition-transform ${showAddStops ? 'rotate-180' : ''}`} />
            </button>
          )}

          {/* Segunda fila: Optimizar con selector de primera parada */}
          {canEdit && route.stops.length >= 2 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <select
                  value={firstStopId || ''}
                  onChange={(e) => {
                    const newValue = e.target.value || null;
                    setFirstStopId(newValue);
                  }}
                  className="flex-1 min-w-0 text-sm border border-gray-300 rounded-lg px-2 py-2 bg-white text-gray-700 truncate"
                  title="Primera parada (opcional)"
                >
                  <option value="">1ra: Auto</option>
                  {route.stops.filter(s => s.address.latitude && s.address.longitude).map((stop) => (
                    <option key={stop.id} value={stop.id}>
                      1ra: {(stop.address.customerName || stop.address.fullAddress).substring(0, 18)}...
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleOptimize}
                  disabled={isOptimizing || !route.depot}
                  className="flex-shrink-0 flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium disabled:opacity-50"
                  title={route.depot ? 'Optimizar orden de paradas' : 'Configura un depot primero'}
                >
                  {isOptimizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Navigation className="w-4 h-4" />}
                </button>
              </div>
              {/* Toggle modo de optimización */}
              <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useHaversine}
                  onChange={(e) => setUseHaversine(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Modo Eco (gratis)</span>
                <span className={`px-1.5 py-0.5 rounded text-xs ${useHaversine ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                  {useHaversine ? 'Haversine' : 'Google API'}
                </span>
              </label>
            </div>
          )}

          {/* Botones de estado de ruta */}
          {route.status === 'SCHEDULED' && (
            <button
              onClick={handleStartRoute}
              disabled={actionLoading}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50"
            >
              <Play className="w-4 h-4" />
              Iniciar Ruta
            </button>
          )}
          {route.status === 'IN_PROGRESS' && (
            <div className="flex gap-2">
              <button
                onClick={handleCompleteRoute}
                disabled={actionLoading}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm disabled:opacity-50"
              >
                <CheckCircle className="w-4 h-4" />
                Completar
              </button>
              {isSimulating ? (
                <button
                  onClick={handleStopSimulation}
                  className="flex items-center gap-1 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
                  title="Detener simulación"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={handleSimulateDriver}
                  disabled={!route.depot || route.stops.length === 0}
                  className="flex items-center gap-1 px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 text-sm disabled:opacity-50"
                  title="Simular movimiento del conductor"
                >
                  <Navigation className="w-4 h-4" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Add Stops Panel */}
        {showAddStops && canEdit && (
          <div className="border-b border-gray-200 bg-gray-50">
            <div className="px-4 py-2 flex gap-2">
              <button
                onClick={() => setAddMethod(addMethod === 'search' ? null : 'search')}
                className={`flex-1 px-3 py-2 text-sm rounded-lg border ${
                  addMethod === 'search'
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Search className="w-4 h-4 inline mr-1" />
                Buscar
              </button>
              <button
                onClick={() => setAddMethod(addMethod === 'database' ? null : 'database')}
                className={`flex-1 px-3 py-2 text-sm rounded-lg border ${
                  addMethod === 'database'
                    ? 'bg-purple-50 border-purple-200 text-purple-700'
                    : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Database className="w-4 h-4 inline mr-1" />
                Existentes
              </button>
            </div>

            {addMethod === 'search' && (
              <div className="px-4 pb-3">
                <AddressSearch
                  apiKey={apiKey}
                  onSelect={handleAddressSelect}
                  placeholder="Buscar dirección..."
                  minChars={4}
                  debounceMs={500}
                />
              </div>
            )}

            {addMethod === 'database' && (
              <div className="max-h-64 overflow-y-auto">
                <div className="px-4 py-2 sticky top-0 bg-gray-50">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                      type="text"
                      value={dbSearch}
                      onChange={(e) => setDbSearch(e.target.value)}
                      placeholder="Filtrar direcciones..."
                      className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg"
                    />
                  </div>
                </div>
                {loadingDb ? (
                  <div className="p-4 text-center">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" />
                  </div>
                ) : dbAddresses.length === 0 ? (
                  <div className="p-4 text-center text-sm text-gray-500">
                    No hay direcciones disponibles
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {dbAddresses.map((addr) => (
                      <div
                        key={addr.id}
                        className={`px-4 py-2 flex items-center justify-between text-sm ${
                          isAddressInRoute(addr.id) ? 'bg-green-50' : 'hover:bg-gray-100'
                        }`}
                      >
                        <div className="flex-1 min-w-0 mr-2">
                          <p className="truncate text-gray-900">{addr.fullAddress}</p>
                          {addr.customerName && (
                            <p className="text-xs text-gray-500">{addr.customerName}</p>
                          )}
                        </div>
                        {isAddressInRoute(addr.id) ? (
                          <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                        ) : (
                          <button
                            onClick={() => handleAddFromDb(addr.id)}
                            className="p-1 text-blue-600 hover:bg-blue-50 rounded"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        {/* Stops List - Timeline Style */}
        <div className="flex-1 overflow-y-auto relative">
          {/* Overlay de optimización */}
          {isOptimizing && (
            <div className="absolute inset-0 bg-white/80 z-10 flex items-center justify-center">
              <div className="text-center">
                <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
                <p className="text-blue-600 font-medium">Optimizando ruta...</p>
                <p className="text-sm text-gray-500 mt-1">Calculando mejor orden</p>
              </div>
            </div>
          )}

          {route.stops.length === 0 ? (
            <div className="p-8 text-center">
              <MapPin className="w-12 h-12 mx-auto text-gray-300 mb-3" />
              <p className="text-gray-500">No hay paradas</p>
              <p className="text-sm text-gray-400">Agrega paradas para planificar la ruta</p>
            </div>
          ) : (
            <div className="relative">
              {/* Depot/Origin row */}
              {route.depot && (
                <div className="flex items-center px-4 py-3 border-b border-gray-100 bg-gray-50/50">
                  <div className="w-8 flex-shrink-0 flex justify-center">
                    <Home className="w-5 h-5 text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0 ml-3">
                    <p className="text-sm font-medium text-gray-700">{route.depot.name}</p>
                    <p className="text-xs text-gray-400 truncate">{route.depot.address}</p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <p className={`text-sm font-medium ${simulatedDepartureTime ? 'text-orange-600' : 'text-gray-600'}`}>
                      {simulatedDepartureTime || route.departureTime || route.depot.defaultDepartureTime || '08:00'}
                    </p>
                    <p className="text-xs text-gray-400">
                      {simulatedDepartureTime ? 'Simulado' : 'Salida'}
                    </p>
                  </div>
                </div>
              )}

              {/* Timeline stops */}
              {(() => {
                // Calculate arrival times based on simulation or stored values
                const recalculatedArrivals = simulatedDepartureTime
                  ? recalculateArrivalTimes(simulatedDepartureTime)
                  : null;

                return route.stops.map((stop, index) => {
                  // Use recalculated time if simulating, otherwise use stored value
                  const arrivalTime = recalculatedArrivals
                    ? recalculatedArrivals.get(stop.id) || null
                    : stop.estimatedArrival
                    ? new Date(stop.estimatedArrival)
                    : null;
                  const formattedTime = arrivalTime
                    ? arrivalTime.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', hour12: false })
                    : null;

                  // Calcular retraso comparando ETA original vs actual
                  const originalArrival = stop.originalEstimatedArrival
                    ? new Date(stop.originalEstimatedArrival)
                    : null;
                  const delayMinutes = (arrivalTime && originalArrival)
                    ? Math.round((arrivalTime.getTime() - originalArrival.getTime()) / 60000)
                    : 0;
                  const isDelayed = delayMinutes > 5; // Considerar retraso si > 5 min
                  const isEarly = delayMinutes < -5; // Considerar adelantado si > 5 min antes

                  // Check if within time window
                  const hasTimeWindow = stop.timeWindowStart || stop.timeWindowEnd;
                  let timeWindowStatus: 'ok' | 'late' | 'none' = 'none';
                  if (hasTimeWindow && arrivalTime) {
                    const windowEnd = stop.timeWindowEnd ? new Date(stop.timeWindowEnd) : null;
                    if (windowEnd && arrivalTime > windowEnd) {
                      timeWindowStatus = 'late';
                    } else {
                      timeWindowStatus = 'ok';
                    }
                  }

                  return (
                  <div
                    key={stop.id}
                    draggable={canEdit}
                    onDragStart={() => handleDragStart(stop.id)}
                    onDragOver={(e) => handleDragOver(e, stop.id)}
                    onDrop={(e) => handleDrop(e, stop.id)}
                    className={`relative flex items-stretch border-b border-gray-100 hover:bg-blue-50/30 transition-colors group ${
                      draggedStop === stop.id ? 'opacity-50 bg-blue-100' : ''
                    } ${selectedStop?.id === stop.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''}`}
                  >
                    {/* Timeline column */}
                    <div className="w-8 flex-shrink-0 flex flex-col items-center relative py-3">
                      {/* Vertical line */}
                      {index > 0 && (
                        <div className="absolute top-0 w-0.5 h-3 bg-gray-300" />
                      )}
                      {index < route.stops.length - 1 && (
                        <div className="absolute bottom-0 w-0.5 h-3 bg-gray-300" />
                      )}
                      {/* Number badge with priority indicator */}
                      <div className="relative">
                        <div className={`w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center z-10 ${
                          stop.priority && stop.priority > 0 ? 'bg-red-500' : 'bg-blue-600'
                        }`}>
                          {String(index + 1).padStart(2, '0')}
                        </div>
                        {(stop.priority ?? 0) > 0 && (
                          <div className="absolute -top-1 -right-1 w-3 h-3 bg-yellow-400 rounded-full flex items-center justify-center">
                            <AlertTriangle className="w-2 h-2 text-yellow-800" />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Drag handle */}
                    {canEdit && (
                      <div className="flex items-center px-1">
                        <GripVertical className="w-4 h-4 text-gray-300 cursor-move" />
                      </div>
                    )}

                    {/* Content */}
                    <div
                      className="flex-1 min-w-0 py-3 pr-2 cursor-pointer"
                      onClick={() => {
                        setSelectedStop({ id: stop.id, index });
                        // Zoom to stop location
                        if (stop.address.latitude && stop.address.longitude) {
                          setFocusLocation({ lat: stop.address.latitude, lng: stop.address.longitude });
                        }
                      }}
                    >
                      <p className="text-sm font-medium text-gray-900 leading-tight pr-20">{stop.address.fullAddress}</p>
                      {stop.address.customerName && (
                        <p className="text-xs text-gray-500 mt-0.5">{stop.address.customerName}</p>
                      )}
                    </div>

                    {/* Time column */}
                    <div
                      className="flex items-center gap-2 pr-4 cursor-pointer"
                      onClick={() => {
                        setSelectedStop({ id: stop.id, index });
                        if (stop.address.latitude && stop.address.longitude) {
                          setFocusLocation({ lat: stop.address.latitude, lng: stop.address.longitude });
                        }
                      }}
                    >
                      {formattedTime ? (
                        <div className="flex items-center gap-1.5">
                          {timeWindowStatus === 'ok' && (
                            <Check className="w-4 h-4 text-green-500" />
                          )}
                          {timeWindowStatus === 'late' && (
                            <X className="w-4 h-4 text-red-500" />
                          )}
                          <div className="flex flex-col items-end">
                            <span className={`text-sm font-medium ${
                              timeWindowStatus === 'late'
                                ? 'text-red-600'
                                : isDelayed
                                  ? 'text-orange-600'
                                  : isEarly
                                    ? 'text-green-600'
                                    : simulatedDepartureTime
                                      ? 'text-orange-600'
                                      : 'text-gray-700'
                            }`}>
                              {formattedTime}
                            </span>
                            {/* Indicador de retraso/adelanto */}
                            {isDelayed && (
                              <span className="text-xs text-orange-500 flex items-center gap-0.5" title={`Retraso de ${delayMinutes} minutos vs ETA original`}>
                                <AlertTriangle className="w-3 h-3" />
                                +{delayMinutes} min
                              </span>
                            )}
                            {isEarly && (
                              <span className="text-xs text-green-500" title={`Adelantado ${Math.abs(delayMinutes)} minutos vs ETA original`}>
                                {delayMinutes} min
                              </span>
                            )}
                          </div>
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">--:--</span>
                      )}
                    </div>

                    {/* Delete button */}
                    {canEdit && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRemoveStopClick(stop.id, stop.address.fullAddress); }}
                        className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                  );
                });
              })()}

              {/* Depot como destino final (retorno) */}
              {route.depot && route.stops.length > 0 && (
                <div className="relative flex items-stretch border-b border-gray-100 bg-gray-50">
                  {/* Timeline connector */}
                  <div className="flex flex-col items-center px-3 py-2">
                    <div className="w-0.5 h-3 bg-gray-300" />
                    <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center shadow-sm">
                      <Home className="w-3.5 h-3.5 text-white" />
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 py-3 pr-2">
                    <p className="text-sm font-medium text-gray-700 leading-tight">
                      {route.depot.name || 'Depot'}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {route.depot.address} (Retorno)
                    </p>
                  </div>

                  {/* Hora de llegada al depot */}
                  <div className="flex items-center gap-2 pr-4">
                    {(() => {
                      console.log('[RENDER] depotReturnTime state:', depotReturnTime);
                      return depotReturnTime ? (
                        <span className="text-xs font-medium text-green-600">
                          {depotReturnTime.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">Fin</span>
                      );
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 border-t border-gray-200 bg-gray-50">
          {isDraft && (
            <div className="flex gap-2">
              <button
                onClick={() => setShowAssignModal(true)}
                disabled={actionLoading || route.stops.length === 0}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-50"
              >
                <User className="w-4 h-4" />
                Asignar y Programar
              </button>
              <button
                onClick={handleDeleteRoute}
                disabled={actionLoading}
                className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                title="Eliminar ruta"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          )}
          {route.status !== 'DRAFT' && route.assignedTo && (
            <div className="text-sm text-gray-600">
              Asignado a: <span className="font-medium">{route.assignedTo.firstName} {route.assignedTo.lastName}</span>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel - Map */}
      <div className="flex-1 relative">
        {mapLocations.length > 0 ? (
          <RouteMap
            apiKey={apiKey}
            locations={mapLocations}
            showRoute={mapLocations.length >= 2}
            showReturnLeg={!!route.depot && route.stops.length > 0}
            returnLegDestination={route.depot ? { lat: route.depot.latitude, lng: route.depot.longitude } : undefined}
            driverLocation={driverLocation || undefined}
            focusLocation={focusLocation || undefined}
            onFocusComplete={() => setFocusLocation(null)}
            onMarkerClick={(location) => {
              if (location.id !== 'depot') {
                const stopIndex = route.stops.findIndex(s => s.id === location.id);
                if (stopIndex !== -1) {
                  setSelectedStop({ id: location.id, index: stopIndex });
                  // Zoom al marcador clickeado
                  setFocusLocation({ lat: location.lat, lng: location.lng });
                }
              }
            }}
            onDriverMarkerClick={() => {
              if (driverLocation) {
                setFocusLocation({ lat: driverLocation.lat, lng: driverLocation.lng });
              }
            }}
          />
        ) : (
          <div className="h-full flex items-center justify-center bg-gray-100">
            <div className="text-center">
              <MapPin className="w-16 h-16 mx-auto text-gray-300 mb-4" />
              <p className="text-gray-500">Agrega paradas para ver el mapa</p>
            </div>
          </div>
        )}
      </div>

      {/* Assign Driver Modal */}
      {showAssignModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold">Asignar Chofer</h3>
            </div>
            <div className="p-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Selecciona un chofer
              </label>
              <select
                value={selectedDriver}
                onChange={(e) => setSelectedDriver(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Seleccionar...</option>
                {drivers.map(driver => (
                  <option key={driver.id} value={driver.id}>
                    {driver.firstName} {driver.lastName}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-sm text-gray-500">
                Al asignar, la ruta pasará a estado "Programada"
              </p>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setShowAssignModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleAssignDriver}
                disabled={!selectedDriver || actionLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {actionLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                Asignar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stop Detail Panel */}
      {selectedStop && (
        <StopDetailPanel
          routeId={id!}
          stopId={selectedStop.id}
          stopIndex={selectedStop.index}
          onClose={() => setSelectedStop(null)}
          onUpdate={fetchRoute}
          canEdit={canEdit}
        />
      )}

      {/* Delete Stop Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Eliminar Parada</h3>
            </div>
            <div className="p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <Trash2 className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <p className="text-gray-700">¿Estás seguro de eliminar esta parada?</p>
                  <p className="text-sm text-gray-500 mt-1 line-clamp-2">{deleteConfirm.address}</p>
                </div>
              </div>
              {route && route.optimizedAt && route.stops.length > 2 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-4">
                  <p className="text-sm text-blue-800">
                    La ruta está optimizada. ¿Deseas re-optimizar después de eliminar?
                  </p>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex flex-col gap-2">
              {route && route.optimizedAt && route.stops.length > 2 ? (
                <>
                  <button
                    onClick={() => confirmRemoveStop(true)}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                  >
                    Eliminar y Re-optimizar
                  </button>
                  <button
                    onClick={() => confirmRemoveStop(false)}
                    className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium"
                  >
                    Solo Eliminar (mantener orden)
                  </button>
                </>
              ) : (
                <button
                  onClick={() => confirmRemoveStop(false)}
                  className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium"
                >
                  Eliminar Parada
                </button>
              )}
              <button
                onClick={() => setDeleteConfirm(null)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Origin Modal */}
      {showOriginModal && !pendingOriginChange && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md max-h-[80vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Cambiar Punto de Origen</h3>
              <p className="text-sm text-gray-500 mt-1">Selecciona desde dónde iniciará la ruta</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {loadingDepots ? (
                <div className="p-4 text-center">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-400" />
                </div>
              ) : depots.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-500">
                  No hay depots configurados. Configura uno en Configuraciones.
                </div>
              ) : (
                <div className="space-y-2">
                  {depots.map((depot) => (
                    <button
                      key={depot.id}
                      onClick={() => handleOriginChangeRequest(depot.id)}
                      disabled={actionLoading}
                      className={`w-full p-3 text-left rounded-lg border hover:bg-gray-50 ${
                        route?.depot?.id === depot.id ? 'border-green-500 bg-green-50' : 'border-gray-200'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-xs font-medium">D</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900">{depot.name}</p>
                          <p className="text-xs text-gray-500 truncate">{depot.address}</p>
                          {depot.defaultDepartureTime && (
                            <p className="text-xs text-gray-400 mt-1">
                              <Clock className="w-3 h-3 inline mr-1" />
                              Salida: {depot.defaultDepartureTime}
                            </p>
                          )}
                        </div>
                        {route?.depot?.id === depot.id && (
                          <Check className="w-5 h-5 text-green-500" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-200">
              <button
                onClick={() => setShowOriginModal(false)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Re-optimize Confirmation Modal */}
      {pendingOriginChange && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Re-optimizar Ruta</h3>
            </div>
            <div className="p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <Navigation className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-gray-700">
                    Al cambiar el punto de origen, ¿deseas re-optimizar la ruta?
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    Re-optimizar recalculará el mejor orden de paradas y los tiempos de viaje desde el nuevo origen.
                  </p>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex flex-col gap-2">
              <button
                onClick={() => handleChangeOrigin(pendingOriginChange, true)}
                disabled={actionLoading || isOptimizing}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {(actionLoading || isOptimizing) && <Loader2 className="w-4 h-4 animate-spin" />}
                Cambiar y Re-optimizar
              </button>
              <button
                onClick={() => handleChangeOrigin(pendingOriginChange, false)}
                disabled={actionLoading || isOptimizing}
                className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium disabled:opacity-50"
              >
                Solo cambiar origen
              </button>
              <button
                onClick={() => setPendingOriginChange(null)}
                disabled={actionLoading || isOptimizing}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Departure Time Re-optimize Confirmation Modal */}
      {pendingDepartureTime !== null && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Actualizar Hora de Salida</h3>
            </div>
            <div className="p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <Clock className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-gray-700">
                    Nueva hora de salida: <span className="font-semibold">{pendingDepartureTime || 'Sin definir'}</span>
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    Al cambiar la hora de salida, ¿deseas re-optimizar la ruta para recalcular los tiempos de llegada?
                  </p>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex flex-col gap-2">
              <button
                onClick={() => handleUpdateDepartureTime(true)}
                disabled={actionLoading || isOptimizing}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {(actionLoading || isOptimizing) && <Loader2 className="w-4 h-4 animate-spin" />}
                Actualizar y Re-optimizar
              </button>
              <button
                onClick={() => handleUpdateDepartureTime(false)}
                disabled={actionLoading || isOptimizing}
                className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium disabled:opacity-50"
              >
                Solo actualizar hora
              </button>
              <button
                onClick={() => { setPendingDepartureTime(null); setEditingDepartureTime(false); }}
                disabled={actionLoading || isOptimizing}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Re-optimize After Add Stop Modal */}
      {pendingReoptimizeAfterAdd && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Parada Agregada</h3>
            </div>
            <div className="p-6">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <Navigation className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-gray-700">
                    Se agregó una nueva parada a la ruta.
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    ¿Deseas re-optimizar la ruta para incluir la nueva parada en el mejor orden?
                  </p>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex flex-col gap-2">
              <button
                onClick={() => handleReoptimizeAfterAdd(true)}
                disabled={isOptimizing}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isOptimizing && <Loader2 className="w-4 h-4 animate-spin" />}
                Re-optimizar Ruta
              </button>
              <button
                onClick={() => handleReoptimizeAfterAdd(false)}
                disabled={isOptimizing}
                className="w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium disabled:opacity-50"
              >
                Mantener orden actual
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Google Address Unit Modal */}
      {pendingGoogleAddress && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Detalles adicionales</h3>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                {pendingGoogleAddress.address}
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Depto / Unidad
                </label>
                <input
                  type="text"
                  value={googleUnit}
                  onChange={(e) => setGoogleUnit(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Depto 501, Of. 204, Casa 3..."
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Indicaciones / Notas
                </label>
                <textarea
                  value={googleNotes}
                  onChange={(e) => setGoogleNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  placeholder="Ej: Tocar timbre 2 veces, dejar con conserje, etc."
                  rows={2}
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex gap-2">
              <button
                onClick={() => {
                  setPendingGoogleAddress(null);
                  setGoogleUnit('');
                  setGoogleNotes('');
                }}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                onClick={confirmGoogleAddress}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
              >
                Agregar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
