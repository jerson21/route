import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Navigation, Save, Loader2, ArrowUp, ArrowDown, Database, Search, CheckCircle, X } from 'lucide-react';
import { AddressSearch } from '../../components/search/AddressSearch';
import { RouteMap } from '../../components/map/RouteMap';
import { api } from '../../services/api';

interface RouteStop {
  id: string;
  addressId?: string; // ID de la dirección en la BD si viene de ahí
  address: string;
  lat: number;
  lng: number;
  customerName?: string;
  isFromDb?: boolean;
}

interface DbAddress {
  id: string;
  fullAddress: string;
  latitude?: number;
  longitude?: number;
  customerName?: string;
  geocodeStatus: string;
}

export function RouteBuilderPage() {
  const navigate = useNavigate();
  const [routeName, setRouteName] = useState('');
  const [routeDescription, setRouteDescription] = useState('');
  const [stops, setStops] = useState<RouteStop[]>([]);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Para búsqueda manual
  const [customerName, setCustomerName] = useState('');
  const [showCustomerInput, setShowCustomerInput] = useState(false);
  const [pendingStop, setPendingStop] = useState<Omit<RouteStop, 'id' | 'customerName'> | null>(null);

  // Para direcciones de la BD
  const [dbAddresses, setDbAddresses] = useState<DbAddress[]>([]);
  const [dbSearch, setDbSearch] = useState('');
  const [loadingDb, setLoadingDb] = useState(false);
  const [showDbModal, setShowDbModal] = useState(false);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

  // Cargar direcciones de la BD
  const fetchDbAddresses = async (searchTerm?: string) => {
    try {
      setLoadingDb(true);
      const params = new URLSearchParams();
      if (searchTerm) params.append('search', searchTerm);
      params.append('status', 'SUCCESS'); // Solo geocodificadas
      params.append('limit', '50');

      const response = await api.get(`/addresses?${params.toString()}`);
      setDbAddresses(response.data.data);
    } catch (error) {
      console.error('Error fetching addresses:', error);
    } finally {
      setLoadingDb(false);
    }
  };

  useEffect(() => {
    if (showDbModal) {
      fetchDbAddresses(dbSearch);
    }
  }, [showDbModal, dbSearch]);

  // Búsqueda manual - selección
  const handleAddressSelect = (place: { placeId: string; address: string; lat: number; lng: number }) => {
    setPendingStop({
      address: place.address,
      lat: place.lat,
      lng: place.lng
    });
    setShowCustomerInput(true);
    setCustomerName('');
  };

  const confirmAddStop = () => {
    if (!pendingStop) return;

    const newStop: RouteStop = {
      id: `stop-${Date.now()}`,
      address: pendingStop.address,
      lat: pendingStop.lat,
      lng: pendingStop.lng,
      customerName: customerName || undefined,
      isFromDb: false
    };

    setStops([...stops, newStop]);
    setPendingStop(null);
    setShowCustomerInput(false);
    setCustomerName('');
  };

  const cancelAddStop = () => {
    setPendingStop(null);
    setShowCustomerInput(false);
    setCustomerName('');
  };

  // Agregar desde BD
  const addFromDb = (addr: DbAddress) => {
    if (!addr.latitude || !addr.longitude) {
      alert('Esta dirección no tiene coordenadas. Geocodifícala primero.');
      return;
    }

    // Verificar si ya está agregada
    if (stops.some(s => s.addressId === addr.id)) {
      alert('Esta dirección ya está en la ruta');
      return;
    }

    const newStop: RouteStop = {
      id: `stop-${Date.now()}`,
      addressId: addr.id,
      address: addr.fullAddress,
      lat: addr.latitude,
      lng: addr.longitude,
      customerName: addr.customerName,
      isFromDb: true
    };

    setStops([...stops, newStop]);
  };

  const removeStop = (id: string) => {
    setStops(stops.filter(s => s.id !== id));
  };

  const moveStop = (index: number, direction: 'up' | 'down') => {
    const newStops = [...stops];
    const newIndex = direction === 'up' ? index - 1 : index + 1;

    if (newIndex < 0 || newIndex >= stops.length) return;

    [newStops[index], newStops[newIndex]] = [newStops[newIndex], newStops[index]];
    setStops(newStops);
  };

  const optimizeRoute = async () => {
    if (stops.length < 3) {
      alert('Necesitas al menos 3 paradas para optimizar');
      return;
    }

    setIsOptimizing(true);

    try {
      const directionsService = new google.maps.DirectionsService();

      const origin = stops[0];
      const destination = stops[stops.length - 1];
      const waypoints = stops.slice(1, -1).map(stop => ({
        location: { lat: stop.lat, lng: stop.lng },
        stopover: true
      }));

      directionsService.route(
        {
          origin: { lat: origin.lat, lng: origin.lng },
          destination: { lat: destination.lat, lng: destination.lng },
          waypoints,
          travelMode: google.maps.TravelMode.DRIVING,
          optimizeWaypoints: true
        },
        (result, status) => {
          setIsOptimizing(false);

          if (status === google.maps.DirectionsStatus.OK && result?.routes[0]?.waypoint_order) {
            const waypointOrder = result.routes[0].waypoint_order;
            const middleStops = stops.slice(1, -1);

            const optimizedMiddle = waypointOrder.map(i => middleStops[i]);
            const optimizedStops = [stops[0], ...optimizedMiddle, stops[stops.length - 1]];

            setStops(optimizedStops);
            alert('Ruta optimizada correctamente');
          } else {
            alert('No se pudo optimizar la ruta');
          }
        }
      );
    } catch (error) {
      setIsOptimizing(false);
      console.error('Error optimizing route:', error);
      alert('Error al optimizar la ruta');
    }
  };

  const saveRoute = async () => {
    if (!routeName.trim()) {
      alert('Ingresa un nombre para la ruta');
      return;
    }

    if (stops.length < 2) {
      alert('Agrega al menos 2 paradas');
      return;
    }

    setIsSaving(true);

    try {
      // 1. Crear la ruta
      const routeResponse = await api.post('/routes', {
        name: routeName,
        description: routeDescription || undefined,
        originLatitude: stops[0].lat,
        originLongitude: stops[0].lng,
        originAddress: stops[0].address
      });

      const routeId = routeResponse.data.data.id;

      // 2. Crear direcciones para las que no vienen de la BD
      const addressIds: string[] = [];

      for (const stop of stops) {
        if (stop.addressId) {
          // Ya existe en la BD
          addressIds.push(stop.addressId);
        } else {
          // Crear nueva dirección
          const addressResponse = await api.post('/addresses', {
            fullAddress: stop.address,
            street: stop.address.split(',')[0] || stop.address,
            city: 'Santiago',
            country: 'Chile',
            latitude: stop.lat,
            longitude: stop.lng,
            geocodeStatus: 'MANUAL',
            customerName: stop.customerName
          });
          addressIds.push(addressResponse.data.data.id);
        }
      }

      // 3. Agregar paradas a la ruta
      await api.post(`/routes/${routeId}/stops`, {
        addressIds
      });

      alert('Ruta guardada correctamente');
      navigate(`/routes/${routeId}`);
    } catch (error: any) {
      console.error('Error saving route:', error);
      alert(error.response?.data?.error || 'Error al guardar la ruta');
    } finally {
      setIsSaving(false);
    }
  };

  const mapLocations = stops.map((stop, index) => ({
    id: stop.id,
    lat: stop.lat,
    lng: stop.lng,
    label: String(index + 1),
    type: index === 0 ? 'origin' as const : index === stops.length - 1 ? 'destination' as const : 'stop' as const
  }));

  const isAddressInRoute = (id: string) => stops.some(s => s.addressId === id);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Planificar Ruta</h1>
        <p className="text-gray-500">Busca direcciones o usa las importadas de Excel para armar tu ruta</p>
      </div>

      {/* Route Info */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Nombre de la ruta *
            </label>
            <input
              type="text"
              value={routeName}
              onChange={(e) => setRouteName(e.target.value)}
              placeholder="Ej: Ruta Centro - Lunes"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Descripción (opcional)
            </label>
            <input
              type="text"
              value={routeDescription}
              onChange={(e) => setRouteDescription(e.target.value)}
              placeholder="Descripción de la ruta..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {/* Add Addresses Section */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between mb-4">
          <label className="block text-sm font-medium text-gray-700">
            Agregar direcciones a la ruta
          </label>
          <button
            onClick={() => setShowDbModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
          >
            <Database className="w-4 h-4" />
            Usar direcciones importadas
          </button>
        </div>

        {/* Manual Search */}
        <AddressSearch
          apiKey={apiKey}
          onSelect={handleAddressSelect}
          placeholder="Buscar nueva dirección en Chile (mín. 4 letras)..."
          minChars={4}
          debounceMs={500}
        />

        {/* Customer Name Input */}
        {showCustomerInput && pendingStop && (
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800 mb-2">
              <strong>Dirección seleccionada:</strong> {pendingStop.address}
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Nombre del cliente (opcional)"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                autoFocus
                onKeyPress={(e) => e.key === 'Enter' && confirmAddStop()}
              />
              <button
                onClick={confirmAddStop}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Agregar
              </button>
              <button
                onClick={cancelAddStop}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Stops List */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b flex justify-between items-center">
            <div>
              <h2 className="text-lg font-semibold">Paradas ({stops.length})</h2>
              <p className="text-sm text-gray-500">Ordena las paradas o usa "Optimizar"</p>
            </div>
            {stops.length >= 3 && (
              <button
                onClick={optimizeRoute}
                disabled={isOptimizing}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {isOptimizing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Navigation className="w-4 h-4" />
                )}
                Optimizar Orden
              </button>
            )}
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {stops.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <p>Agrega direcciones usando:</p>
                <ul className="mt-2 text-sm">
                  <li>• El buscador de arriba para nuevas direcciones</li>
                  <li>• El botón "Usar direcciones importadas" para las de Excel</li>
                </ul>
              </div>
            ) : (
              <div className="divide-y">
                {stops.map((stop, index) => (
                  <div
                    key={stop.id}
                    className="p-4 flex items-center gap-3 hover:bg-gray-50"
                  >
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => moveStop(index, 'up')}
                        disabled={index === 0}
                        className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => moveStop(index, 'down')}
                        disabled={index === stops.length - 1}
                        className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                    </div>

                    <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold text-white ${
                      index === 0 ? 'bg-green-500' : index === stops.length - 1 ? 'bg-red-500' : 'bg-blue-500'
                    }`}>
                      {index + 1}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 truncate">{stop.address}</p>
                        {stop.isFromDb && (
                          <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full">
                            Excel
                          </span>
                        )}
                      </div>
                      {stop.customerName && (
                        <p className="text-sm text-gray-500">Cliente: {stop.customerName}</p>
                      )}
                    </div>

                    <button
                      onClick={() => removeStop(stop.id)}
                      className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {stops.length >= 2 && (
            <div className="p-4 border-t">
              <button
                onClick={saveRoute}
                disabled={isSaving || !routeName.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
              >
                {isSaving ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Save className="w-5 h-5" />
                )}
                Guardar Ruta
              </button>
            </div>
          )}
        </div>

        {/* Map */}
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold mb-4">Vista previa del mapa</h2>
          <RouteMap
            apiKey={apiKey}
            locations={mapLocations}
            showRoute={stops.length >= 2}
          />
        </div>
      </div>

      {/* Modal para direcciones de la BD */}
      {showDbModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="text-lg font-semibold">Direcciones importadas de Excel</h3>
              <button
                onClick={() => setShowDbModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  value={dbSearch}
                  onChange={(e) => setDbSearch(e.target.value)}
                  placeholder="Buscar en direcciones importadas..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loadingDb ? (
                <div className="p-8 text-center text-gray-500">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                  Cargando...
                </div>
              ) : dbAddresses.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  No hay direcciones geocodificadas.
                  <br />
                  Importa un Excel y geocodifica las direcciones primero.
                </div>
              ) : (
                <div className="divide-y">
                  {dbAddresses.map((addr) => (
                    <div
                      key={addr.id}
                      className={`p-4 flex items-center justify-between hover:bg-gray-50 ${
                        isAddressInRoute(addr.id) ? 'bg-green-50' : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{addr.fullAddress}</p>
                        {addr.customerName && (
                          <p className="text-sm text-gray-500">Cliente: {addr.customerName}</p>
                        )}
                      </div>
                      {isAddressInRoute(addr.id) ? (
                        <span className="flex items-center gap-1 text-green-600 text-sm">
                          <CheckCircle className="w-4 h-4" />
                          Agregada
                        </span>
                      ) : (
                        <button
                          onClick={() => addFromDb(addr)}
                          className="flex items-center gap-1 px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                        >
                          <Plus className="w-4 h-4" />
                          Agregar
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t">
              <button
                onClick={() => setShowDbModal(false)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
