import { useState, useEffect } from 'react';
import { MapPin, Plus, Trash2, Check, Loader2, Clock, Edit2, Webhook, Send, Eye, EyeOff, Bell, Users, Package, Navigation, Smartphone, Key, Copy, CheckCircle } from 'lucide-react';
import { api } from '../../services/api';
import { AddressSearch } from '../../components/search/AddressSearch';

interface Depot {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  isDefault: boolean;
  isActive: boolean;
  defaultDepartureTime: string;
  defaultServiceMinutes: number;
}

interface Driver {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
}

interface DriverPreferences {
  autoNavigateAfterDelivery: boolean;
  autoNavigateExcludesPOD: boolean;
  navigationApp: 'google_maps' | 'waze' | 'apple_maps';
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  keepScreenOn: boolean;
  arrivalAlertIntrusive: boolean;
}

interface ApiKeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  permissions: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
  createdAt: string;
}

type SettingsSection = 'depots' | 'notifications' | 'webhook' | 'drivers' | 'delivery' | 'apikeys';

const menuItems: { id: SettingsSection; label: string; icon: typeof MapPin; description: string }[] = [
  { id: 'depots', label: 'Depots', icon: MapPin, description: 'Puntos de salida' },
  { id: 'drivers', label: 'Conductores', icon: Users, description: 'Preferencias app' },
  { id: 'delivery', label: 'Entregas', icon: Package, description: 'POD por defecto' },
  { id: 'notifications', label: 'Notificaciones', icon: Bell, description: 'Ventana ETA' },
  { id: 'webhook', label: 'Webhook', icon: Webhook, description: 'Integraciones' },
  { id: 'apikeys', label: 'API Keys', icon: Key, description: 'Acceso externo' },
];

export function SettingsPage() {
  // Section state
  const [activeSection, setActiveSection] = useState<SettingsSection>('depots');

  // Depots state
  const [depots, setDepots] = useState<Depot[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddDepot, setShowAddDepot] = useState(false);
  const [editingDepot, setEditingDepot] = useState<Depot | null>(null);
  const [newDepotName, setNewDepotName] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<{address: string; lat: number; lng: number} | null>(null);
  const [departureTime, setDepartureTime] = useState('08:00');
  const [serviceMinutes, setServiceMinutes] = useState(15);
  const [savingDepot, setSavingDepot] = useState(false);

  // Webhook state
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState<{success: boolean; message: string} | null>(null);

  // Notification state
  const [etaWindowBefore, setEtaWindowBefore] = useState(20);
  const [etaWindowAfter, setEtaWindowAfter] = useState(60);
  const [savingNotifications, setSavingNotifications] = useState(false);

  // Drivers state
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [driverPreferences, setDriverPreferences] = useState<DriverPreferences | null>(null);
  const [loadingPreferences, setLoadingPreferences] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);

  // Delivery defaults state
  const [defaultRequireSignature, setDefaultRequireSignature] = useState(false);
  const [defaultRequirePhoto, setDefaultRequirePhoto] = useState(false);
  const [defaultProofEnabled, setDefaultProofEnabled] = useState(true);
  const [defaultServiceMinutes, setDefaultServiceMinutes] = useState(15);
  const [savingDeliveryDefaults, setSavingDeliveryDefaults] = useState(false);

  // API Keys state
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([]);
  const [loadingApiKeys, setLoadingApiKeys] = useState(false);
  const [showCreateApiKey, setShowCreateApiKey] = useState(false);
  const [newApiKeyName, setNewApiKeyName] = useState('');
  const [newApiKeyPermissions, setNewApiKeyPermissions] = useState<string[]>(['addresses:write', 'routes:read']);
  const [newApiKeyExpiresDays, setNewApiKeyExpiresDays] = useState<number | null>(null);
  const [creatingApiKey, setCreatingApiKey] = useState(false);
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

  // Fetch depots
  const fetchDepots = async () => {
    try {
      setLoading(true);
      const response = await api.get('/depots');
      setDepots(response.data.data);
    } catch (error) {
      console.error('Error fetching depots:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch webhook settings
  const fetchWebhookSettings = async () => {
    try {
      const response = await api.get('/settings/webhook');
      const data = response.data.data;
      setWebhookUrl(data.url || '');
      setWebhookEnabled(data.enabled || false);
      setWebhookSecret(data.secret || '');
    } catch (error) {
      console.error('Error fetching webhook settings:', error);
    }
  };

  // Fetch notification settings
  const fetchNotificationSettings = async () => {
    try {
      const response = await api.get('/settings/notifications');
      const data = response.data.data;
      setEtaWindowBefore(data.etaWindowBefore ?? 20);
      setEtaWindowAfter(data.etaWindowAfter ?? 60);
    } catch (error) {
      console.error('Error fetching notification settings:', error);
    }
  };

  // Fetch drivers list
  const fetchDrivers = async () => {
    try {
      setLoadingDrivers(true);
      const response = await api.get('/users/drivers');
      setDrivers(response.data.data);
    } catch (error) {
      console.error('Error fetching drivers:', error);
    } finally {
      setLoadingDrivers(false);
    }
  };

  // Fetch driver preferences
  const fetchDriverPreferences = async (driverId: string) => {
    try {
      setLoadingPreferences(true);
      const response = await api.get(`/users/${driverId}/preferences`);
      setDriverPreferences(response.data.data);
    } catch (error) {
      console.error('Error fetching driver preferences:', error);
    } finally {
      setLoadingPreferences(false);
    }
  };

  // Save driver preferences
  const handleSaveDriverPreferences = async () => {
    if (!selectedDriver || !driverPreferences) return;
    try {
      setSavingPreferences(true);
      await api.patch(`/users/${selectedDriver.id}/preferences`, driverPreferences);
      alert('Preferencias guardadas');
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error al guardar preferencias');
    } finally {
      setSavingPreferences(false);
    }
  };

  // Fetch delivery defaults
  const fetchDeliveryDefaults = async () => {
    try {
      const response = await api.get('/settings/delivery');
      const data = response.data.data;
      setDefaultRequireSignature(data.requireSignature ?? false);
      setDefaultRequirePhoto(data.requirePhoto ?? false);
      setDefaultProofEnabled(data.proofEnabled ?? true);
      setDefaultServiceMinutes(data.serviceMinutes ?? 15);
    } catch (error) {
      console.error('Error fetching delivery defaults:', error);
    }
  };

  // Save delivery defaults
  const handleSaveDeliveryDefaults = async () => {
    try {
      setSavingDeliveryDefaults(true);
      await api.put('/settings/delivery', {
        requireSignature: defaultRequireSignature,
        requirePhoto: defaultRequirePhoto,
        proofEnabled: defaultProofEnabled,
        serviceMinutes: defaultServiceMinutes
      });
      alert('Configuracion guardada');
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error al guardar');
    } finally {
      setSavingDeliveryDefaults(false);
    }
  };

  // Fetch API keys
  const fetchApiKeys = async () => {
    try {
      setLoadingApiKeys(true);
      const response = await api.get('/api-keys');
      setApiKeys(response.data.data);
    } catch (error) {
      console.error('Error fetching API keys:', error);
    } finally {
      setLoadingApiKeys(false);
    }
  };

  // Create API key
  const handleCreateApiKey = async () => {
    if (!newApiKeyName) return;
    try {
      setCreatingApiKey(true);
      const response = await api.post('/api-keys', {
        name: newApiKeyName,
        permissions: newApiKeyPermissions,
        expiresInDays: newApiKeyExpiresDays
      });
      setCreatedApiKey(response.data.data.key);
      await fetchApiKeys();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error al crear API key');
    } finally {
      setCreatingApiKey(false);
    }
  };

  // Delete API key
  const handleDeleteApiKey = async (id: string) => {
    if (!confirm('Revocar esta API Key? Los sistemas que la usen dejaran de funcionar.')) return;
    try {
      await api.delete(`/api-keys/${id}`);
      await fetchApiKeys();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error al eliminar');
    }
  };

  // Toggle API key active status
  const handleToggleApiKey = async (id: string, isActive: boolean) => {
    try {
      await api.put(`/api-keys/${id}`, { isActive: !isActive });
      await fetchApiKeys();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error al actualizar');
    }
  };

  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  // Close create modal and reset
  const closeCreateModal = () => {
    setShowCreateApiKey(false);
    setCreatedApiKey(null);
    setNewApiKeyName('');
    setNewApiKeyPermissions(['addresses:write', 'routes:read']);
    setNewApiKeyExpiresDays(null);
  };

  useEffect(() => {
    fetchDepots();
    fetchWebhookSettings();
    fetchNotificationSettings();
    fetchDrivers();
    fetchDeliveryDefaults();
    fetchApiKeys();
  }, []);

  // Load preferences when driver selected
  useEffect(() => {
    if (selectedDriver) {
      fetchDriverPreferences(selectedDriver.id);
    } else {
      setDriverPreferences(null);
    }
  }, [selectedDriver]);

  // Depot handlers
  const handleAddDepot = async () => {
    if (!newDepotName || !selectedPlace) return;

    try {
      setSavingDepot(true);
      await api.post('/depots', {
        name: newDepotName,
        address: selectedPlace.address,
        latitude: selectedPlace.lat,
        longitude: selectedPlace.lng,
        isDefault: depots.length === 0,
        defaultDepartureTime: departureTime,
        defaultServiceMinutes: serviceMinutes
      });
      await fetchDepots();
      setShowAddDepot(false);
      resetDepotForm();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error al crear depot');
    } finally {
      setSavingDepot(false);
    }
  };

  const handleEditDepot = async () => {
    if (!editingDepot) return;

    try {
      setSavingDepot(true);
      await api.put(`/depots/${editingDepot.id}`, {
        name: newDepotName || editingDepot.name,
        defaultDepartureTime: departureTime,
        defaultServiceMinutes: serviceMinutes
      });
      await fetchDepots();
      setEditingDepot(null);
      resetDepotForm();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error al actualizar depot');
    } finally {
      setSavingDepot(false);
    }
  };

  const openEditDepot = (depot: Depot) => {
    setEditingDepot(depot);
    setNewDepotName(depot.name);
    setDepartureTime(depot.defaultDepartureTime || '08:00');
    setServiceMinutes(depot.defaultServiceMinutes || 15);
  };

  const resetDepotForm = () => {
    setNewDepotName('');
    setSelectedPlace(null);
    setDepartureTime('08:00');
    setServiceMinutes(15);
  };

  const handleSetDefault = async (id: string) => {
    try {
      await api.put(`/depots/${id}`, { isDefault: true });
      await fetchDepots();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error al actualizar');
    }
  };

  const handleDeleteDepot = async (id: string) => {
    if (!confirm('Eliminar este depot?')) return;

    try {
      await api.delete(`/depots/${id}`);
      await fetchDepots();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error al eliminar');
    }
  };

  // Webhook handlers
  const handleSaveWebhook = async () => {
    try {
      setSavingWebhook(true);
      await api.put('/settings/webhook', {
        url: webhookUrl || null,
        enabled: webhookEnabled,
        secret: webhookSecret || null
      });
      await fetchWebhookSettings();
      setWebhookTestResult({ success: true, message: 'Configuracion guardada' });
      setTimeout(() => setWebhookTestResult(null), 3000);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error al guardar webhook');
    } finally {
      setSavingWebhook(false);
    }
  };

  const handleTestWebhook = async () => {
    try {
      setTestingWebhook(true);
      setWebhookTestResult(null);

      // First save the settings
      await api.put('/settings/webhook', {
        url: webhookUrl || null,
        enabled: webhookEnabled,
        secret: webhookSecret || null
      });

      // Then test
      const response = await api.post('/settings/webhook/test');
      setWebhookTestResult({
        success: true,
        message: response.data.message || 'Webhook enviado correctamente'
      });
    } catch (error: any) {
      setWebhookTestResult({
        success: false,
        message: error.response?.data?.message || error.response?.data?.error || 'Error al enviar webhook'
      });
    } finally {
      setTestingWebhook(false);
    }
  };

  // Notification handlers
  const handleSaveNotifications = async () => {
    try {
      setSavingNotifications(true);
      await api.put('/settings/notifications', {
        etaWindowBefore,
        etaWindowAfter
      });
      await fetchNotificationSettings();
      alert('Configuracion guardada');
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error al guardar');
    } finally {
      setSavingNotifications(false);
    }
  };

  // Render sections
  const renderDepotsSection = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Depots</h2>
          <p className="text-sm text-gray-500">Puntos de salida de las rutas</p>
        </div>
        <button
          onClick={() => setShowAddDepot(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Agregar
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" />
        </div>
      ) : depots.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <MapPin className="w-12 h-12 mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500 mb-4">No hay depots configurados</p>
          <button
            onClick={() => setShowAddDepot(true)}
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            Agregar tu primer depot
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-200">
          {depots.map((depot) => (
            <div key={depot.id} className="px-6 py-4 flex items-center gap-4">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                depot.isDefault ? 'bg-blue-100' : 'bg-gray-100'
              }`}>
                <MapPin className={`w-5 h-5 ${depot.isDefault ? 'text-blue-600' : 'text-gray-500'}`} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{depot.name}</span>
                  {depot.isDefault && (
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
                      Por defecto
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500">{depot.address}</p>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Salida: {depot.defaultDepartureTime || '08:00'}
                  </span>
                  <span>Servicio: {depot.defaultServiceMinutes || 15} min</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openEditDepot(depot)}
                  className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                  title="Editar"
                >
                  <Edit2 className="w-5 h-5" />
                </button>
                {!depot.isDefault && (
                  <button
                    onClick={() => handleSetDefault(depot.id)}
                    className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"
                    title="Hacer por defecto"
                  >
                    <Check className="w-5 h-5" />
                  </button>
                )}
                <button
                  onClick={() => handleDeleteDepot(depot.id)}
                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                  title="Eliminar"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderNotificationsSection = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Notificaciones a Clientes</h2>
        <p className="text-sm text-gray-500">Configuracion de ventana de tiempo para ETAs</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <p className="text-sm text-gray-600">
          Define el rango de tiempo que se mostrara a los clientes en las notificaciones de llegada.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Minutos antes del ETA
            </label>
            <input
              type="number"
              value={etaWindowBefore}
              onChange={(e) => setEtaWindowBefore(parseInt(e.target.value) || 20)}
              min={0}
              max={120}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-400 mt-1">Inicio de la ventana</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Minutos despues del ETA
            </label>
            <input
              type="number"
              value={etaWindowAfter}
              onChange={(e) => setEtaWindowAfter(parseInt(e.target.value) || 60)}
              min={0}
              max={180}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-400 mt-1">Fin de la ventana</p>
          </div>
        </div>
        <div className="bg-gray-50 p-3 rounded-lg">
          <p className="text-sm text-gray-600">
            <strong>Ejemplo:</strong> Si ETA es 10:30, con {etaWindowBefore} min antes y {etaWindowAfter} min despues,
            el cliente vera "entre {new Date(new Date().setHours(10, 30 - etaWindowBefore)).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })} y {new Date(new Date().setHours(10, 30 + etaWindowAfter)).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}"
          </p>
        </div>
        <div className="flex justify-end">
          <button
            onClick={handleSaveNotifications}
            disabled={savingNotifications}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {savingNotifications && <Loader2 className="w-4 h-4 animate-spin" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );

  const renderWebhookSection = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Webhook</h2>
        <p className="text-sm text-gray-500">Recibe notificaciones en tiempo real de eventos</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            URL del Webhook
          </label>
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://tu-servidor.com/webhook"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Secret (opcional)
          </label>
          <div className="relative">
            <input
              type={showSecret ? 'text' : 'password'}
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder="Clave secreta para firmar requests"
              className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">Se usara para firmar requests con HMAC-SHA256</p>
        </div>

        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={webhookEnabled}
              onChange={(e) => setWebhookEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-700">Webhook activo</span>
          </label>

          <div className="flex items-center gap-2">
            <button
              onClick={handleTestWebhook}
              disabled={!webhookUrl || testingWebhook}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {testingWebhook ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Probar
            </button>
            <button
              onClick={handleSaveWebhook}
              disabled={savingWebhook}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {savingWebhook && <Loader2 className="w-4 h-4 animate-spin" />}
              Guardar
            </button>
          </div>
        </div>

        {webhookTestResult && (
          <div className={`p-3 rounded-lg text-sm ${
            webhookTestResult.success
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {webhookTestResult.message}
          </div>
        )}

        <div className="bg-gray-50 p-4 rounded-lg">
          <h4 className="font-medium text-gray-900 mb-2">Eventos disponibles:</h4>
          <ul className="text-sm text-gray-600 space-y-1">
            <li><code className="bg-gray-200 px-1 rounded">route.started</code> - Ruta iniciada</li>
            <li><code className="bg-gray-200 px-1 rounded">stop.in_transit</code> - Conductor en camino a parada</li>
            <li><code className="bg-gray-200 px-1 rounded">stop.completed</code> - Parada completada</li>
            <li><code className="bg-gray-200 px-1 rounded">stop.failed</code> - Parada fallida</li>
            <li><code className="bg-gray-200 px-1 rounded">eta.updated</code> - ETAs recalculados</li>
          </ul>
        </div>
      </div>
    </div>
  );

  const renderDriversSection = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Preferencias de Conductores</h2>
        <p className="text-sm text-gray-500">Configura la app movil de cada conductor</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        {/* Driver selector */}
        <div className="p-4 border-b border-gray-200">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Selecciona un conductor
          </label>
          {loadingDrivers ? (
            <div className="flex items-center gap-2 text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Cargando...
            </div>
          ) : drivers.length === 0 ? (
            <p className="text-gray-500 text-sm">No hay conductores registrados</p>
          ) : (
            <select
              value={selectedDriver?.id || ''}
              onChange={(e) => {
                const driver = drivers.find(d => d.id === e.target.value);
                setSelectedDriver(driver || null);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">-- Seleccionar --</option>
              {drivers.map(driver => (
                <option key={driver.id} value={driver.id}>
                  {driver.firstName} {driver.lastName}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Preferences form */}
        {selectedDriver && (
          <div className="p-6 space-y-6">
            {loadingPreferences ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              </div>
            ) : driverPreferences ? (
              <>
                {/* Navigation settings */}
                <div>
                  <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <Navigation className="w-4 h-4" />
                    Navegacion
                  </h4>
                  <div className="space-y-3 ml-6">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={driverPreferences.autoNavigateAfterDelivery}
                        onChange={(e) => setDriverPreferences({
                          ...driverPreferences,
                          autoNavigateAfterDelivery: e.target.checked
                        })}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                      />
                      <div>
                        <span className="text-sm text-gray-700">Navegar automaticamente</span>
                        <p className="text-xs text-gray-500">Abrir navegacion al siguiente destino al completar entrega</p>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={driverPreferences.autoNavigateExcludesPOD}
                        onChange={(e) => setDriverPreferences({
                          ...driverPreferences,
                          autoNavigateExcludesPOD: e.target.checked
                        })}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                      />
                      <div>
                        <span className="text-sm text-gray-700">Excluir si requiere POD</span>
                        <p className="text-xs text-gray-500">No navegar automaticamente si la parada requiere firma/foto</p>
                      </div>
                    </label>
                    <div>
                      <label className="block text-sm text-gray-700 mb-1">App de navegacion</label>
                      <select
                        value={driverPreferences.navigationApp}
                        onChange={(e) => setDriverPreferences({
                          ...driverPreferences,
                          navigationApp: e.target.value as 'google_maps' | 'waze' | 'apple_maps'
                        })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      >
                        <option value="google_maps">Google Maps</option>
                        <option value="waze">Waze</option>
                        <option value="apple_maps">Apple Maps</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* App settings */}
                <div>
                  <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <Smartphone className="w-4 h-4" />
                    Configuracion de App
                  </h4>
                  <div className="space-y-3 ml-6">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={driverPreferences.soundEnabled}
                        onChange={(e) => setDriverPreferences({
                          ...driverPreferences,
                          soundEnabled: e.target.checked
                        })}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                      />
                      <div>
                        <span className="text-sm text-gray-700">Sonidos habilitados</span>
                        <p className="text-xs text-gray-500">Reproducir sonidos de notificacion</p>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={driverPreferences.vibrationEnabled}
                        onChange={(e) => setDriverPreferences({
                          ...driverPreferences,
                          vibrationEnabled: e.target.checked
                        })}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                      />
                      <div>
                        <span className="text-sm text-gray-700">Vibracion habilitada</span>
                        <p className="text-xs text-gray-500">Vibrar en notificaciones</p>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={driverPreferences.keepScreenOn}
                        onChange={(e) => setDriverPreferences({
                          ...driverPreferences,
                          keepScreenOn: e.target.checked
                        })}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                      />
                      <div>
                        <span className="text-sm text-gray-700">Mantener pantalla encendida</span>
                        <p className="text-xs text-gray-500">Evitar que la pantalla se apague durante la ruta</p>
                      </div>
                    </label>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={driverPreferences.arrivalAlertIntrusive}
                        onChange={(e) => setDriverPreferences({
                          ...driverPreferences,
                          arrivalAlertIntrusive: e.target.checked
                        })}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                      />
                      <div>
                        <span className="text-sm text-gray-700">Alerta de llegada intrusiva</span>
                        <p className="text-xs text-gray-500">Mostrar dialogo modal al llegar a destino (si esta desactivado, solo notificacion)</p>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="flex justify-end pt-4 border-t border-gray-200">
                  <button
                    onClick={handleSaveDriverPreferences}
                    disabled={savingPreferences}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    {savingPreferences && <Loader2 className="w-4 h-4 animate-spin" />}
                    Guardar Preferencias
                  </button>
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );

  const renderDeliverySection = () => (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Configuracion de Entregas</h2>
        <p className="text-sm text-gray-500">Valores por defecto para nuevas paradas</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        {/* POD defaults */}
        <div>
          <h4 className="font-medium text-gray-900 mb-3">Prueba de Entrega (POD)</h4>
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={defaultProofEnabled}
                onChange={(e) => setDefaultProofEnabled(e.target.checked)}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded"
              />
              <span className="text-sm text-gray-700">Habilitar prueba de entrega por defecto</span>
            </label>
            {defaultProofEnabled && (
              <>
                <label className="flex items-center gap-3 cursor-pointer ml-6">
                  <input
                    type="checkbox"
                    checked={defaultRequireSignature}
                    onChange={(e) => setDefaultRequireSignature(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                  />
                  <span className="text-sm text-gray-700">Requerir firma por defecto</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer ml-6">
                  <input
                    type="checkbox"
                    checked={defaultRequirePhoto}
                    onChange={(e) => setDefaultRequirePhoto(e.target.checked)}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                  />
                  <span className="text-sm text-gray-700">Requerir foto por defecto</span>
                </label>
              </>
            )}
          </div>
        </div>

        {/* Service time */}
        <div>
          <h4 className="font-medium text-gray-900 mb-3">Tiempo de Servicio</h4>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={defaultServiceMinutes}
              onChange={(e) => setDefaultServiceMinutes(parseInt(e.target.value) || 15)}
              min={1}
              max={120}
              className="w-24 px-3 py-2 border border-gray-300 rounded-lg"
            />
            <span className="text-gray-500">minutos por parada</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">Tiempo estimado que el conductor pasa en cada parada</p>
        </div>

        <div className="bg-blue-50 p-4 rounded-lg">
          <p className="text-sm text-blue-800">
            <strong>Nota:</strong> Estos valores se aplicaran a nuevas paradas.
            Las paradas existentes mantienen su configuracion actual.
            Puedes cambiar la configuracion de cada parada individualmente desde el detalle de la ruta.
          </p>
        </div>

        <div className="flex justify-end pt-4 border-t border-gray-200">
          <button
            onClick={handleSaveDeliveryDefaults}
            disabled={savingDeliveryDefaults}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {savingDeliveryDefaults && <Loader2 className="w-4 h-4 animate-spin" />}
            Guardar
          </button>
        </div>
      </div>
    </div>
  );

  const renderApiKeysSection = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">API Keys</h2>
          <p className="text-sm text-gray-500">Gestiona acceso para integraciones externas</p>
        </div>
        <button
          onClick={() => setShowCreateApiKey(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Nueva API Key
        </button>
      </div>

      {loadingApiKeys ? (
        <div className="p-8 text-center">
          <Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" />
        </div>
      ) : apiKeys.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <Key className="w-12 h-12 mx-auto text-gray-300 mb-4" />
          <p className="text-gray-500 mb-4">No hay API keys configuradas</p>
          <button
            onClick={() => setShowCreateApiKey(true)}
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            Crear tu primera API key
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-200">
          {apiKeys.map((key) => (
            <div key={key.id} className="px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    key.isActive ? 'bg-green-100' : 'bg-gray-100'
                  }`}>
                    <Key className={`w-5 h-5 ${key.isActive ? 'text-green-600' : 'text-gray-400'}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{key.name}</span>
                      {!key.isActive && (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded-full">
                          Inactiva
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 font-mono">{key.keyPrefix}...</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleToggleApiKey(key.id, key.isActive)}
                    className={`p-2 rounded-lg ${
                      key.isActive
                        ? 'text-yellow-600 hover:bg-yellow-50'
                        : 'text-green-600 hover:bg-green-50'
                    }`}
                    title={key.isActive ? 'Desactivar' : 'Activar'}
                  >
                    {key.isActive ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                  <button
                    onClick={() => handleDeleteApiKey(key.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                    title="Eliminar"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(key.permissions as string[]).map((perm) => (
                  <span
                    key={perm}
                    className="px-2 py-1 bg-blue-50 text-blue-700 text-xs rounded-full"
                  >
                    {perm}
                  </span>
                ))}
              </div>
              <div className="mt-2 text-xs text-gray-400 flex items-center gap-4">
                <span>Creada: {new Date(key.createdAt).toLocaleDateString('es-CL')}</span>
                {key.lastUsedAt && (
                  <span>Ultimo uso: {new Date(key.lastUsedAt).toLocaleDateString('es-CL')}</span>
                )}
                {key.expiresAt && (
                  <span className={new Date(key.expiresAt) < new Date() ? 'text-red-500' : ''}>
                    Expira: {new Date(key.expiresAt).toLocaleDateString('es-CL')}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="font-medium text-gray-900 mb-2">Como usar:</h4>
        <p className="text-sm text-gray-600 mb-2">
          Incluye la API key en el header de tus requests:
        </p>
        <code className="block bg-gray-800 text-green-400 p-3 rounded-lg text-sm overflow-x-auto">
          X-API-Key: route_xxxxxxxxxxxxx
        </code>
      </div>
    </div>
  );

  return (
    <div className="h-full flex bg-gray-50">
      {/* Panel Izquierdo - Lista de configuraciones */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
        <div className="p-6 border-b border-gray-200">
          <h1 className="text-lg font-semibold text-gray-900">Configuracion</h1>
          <p className="text-sm text-gray-500">Gestiona tu sistema</p>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-auto">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                activeSection === item.id
                  ? 'bg-blue-50 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <item.icon className="w-5 h-5" />
              <div className="text-left">
                <div className="font-medium">{item.label}</div>
                <div className="text-xs text-gray-400">{item.description}</div>
              </div>
            </button>
          ))}
        </nav>
      </div>

      {/* Panel Derecho - Contenido */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto p-8">
          {activeSection === 'depots' && renderDepotsSection()}
          {activeSection === 'drivers' && renderDriversSection()}
          {activeSection === 'delivery' && renderDeliverySection()}
          {activeSection === 'notifications' && renderNotificationsSection()}
          {activeSection === 'webhook' && renderWebhookSection()}
          {activeSection === 'apikeys' && renderApiKeysSection()}
        </div>
      </div>

      {/* Add Depot Modal */}
      {showAddDepot && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold">Agregar Depot</h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nombre del depot
                </label>
                <input
                  type="text"
                  value={newDepotName}
                  onChange={(e) => setNewDepotName(e.target.value)}
                  placeholder="Ej: Bodega Central"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Direccion
                </label>
                <AddressSearch
                  apiKey={apiKey}
                  onSelect={(place) => setSelectedPlace({
                    address: place.address,
                    lat: place.lat,
                    lng: place.lng
                  })}
                  placeholder="Buscar direccion..."
                  minChars={4}
                  debounceMs={500}
                />
                {selectedPlace && (
                  <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm text-green-800">{selectedPlace.address}</p>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Hora de salida
                  </label>
                  <input
                    type="time"
                    value={departureTime}
                    onChange={(e) => setDepartureTime(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tiempo servicio (min)
                  </label>
                  <input
                    type="number"
                    value={serviceMinutes}
                    onChange={(e) => setServiceMinutes(parseInt(e.target.value) || 15)}
                    min={1}
                    max={120}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowAddDepot(false);
                  resetDepotForm();
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleAddDepot}
                disabled={!newDepotName || !selectedPlace || savingDepot}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {savingDepot && <Loader2 className="w-4 h-4 animate-spin" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Depot Modal */}
      {editingDepot && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold">Editar Depot</h3>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Nombre del depot
                </label>
                <input
                  type="text"
                  value={newDepotName}
                  onChange={(e) => setNewDepotName(e.target.value)}
                  placeholder="Ej: Bodega Central"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Direccion
                </label>
                <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
                  {editingDepot.address}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Hora de salida por defecto
                  </label>
                  <input
                    type="time"
                    value={departureTime}
                    onChange={(e) => setDepartureTime(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tiempo servicio (min)
                  </label>
                  <input
                    type="number"
                    value={serviceMinutes}
                    onChange={(e) => setServiceMinutes(parseInt(e.target.value) || 15)}
                    min={1}
                    max={120}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => {
                  setEditingDepot(null);
                  resetDepotForm();
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleEditDepot}
                disabled={savingDepot}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {savingDepot && <Loader2 className="w-4 h-4 animate-spin" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create API Key Modal */}
      {showCreateApiKey && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold">
                {createdApiKey ? 'API Key Creada' : 'Nueva API Key'}
              </h3>
            </div>

            {createdApiKey ? (
              // Show created key (only shown once)
              <div className="p-6 space-y-4">
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <p className="text-sm text-yellow-800 font-medium mb-2">
                    Guarda esta API key en un lugar seguro. No se mostrara de nuevo.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Tu API Key:
                  </label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-gray-100 px-4 py-3 rounded-lg font-mono text-sm break-all">
                      {createdApiKey}
                    </code>
                    <button
                      onClick={() => copyToClipboard(createdApiKey)}
                      className={`p-3 rounded-lg transition-colors ${
                        copiedKey
                          ? 'bg-green-100 text-green-600'
                          : 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                      }`}
                      title="Copiar"
                    >
                      {copiedKey ? <CheckCircle className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                    </button>
                  </div>
                  {copiedKey && (
                    <p className="text-sm text-green-600 mt-2">Copiado al portapapeles</p>
                  )}
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <p className="text-sm text-gray-600">
                    Usa esta key en el header <code className="bg-gray-200 px-1 rounded">X-API-Key</code> de tus requests.
                  </p>
                </div>
              </div>
            ) : (
              // Create form
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nombre
                  </label>
                  <input
                    type="text"
                    value={newApiKeyName}
                    onChange={(e) => setNewApiKeyName(e.target.value)}
                    placeholder="Ej: Integracion Intranet"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 mt-1">Un nombre descriptivo para identificar esta key</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Permisos
                  </label>
                  <div className="space-y-2">
                    {[
                      { value: 'addresses:read', label: 'Leer direcciones' },
                      { value: 'addresses:write', label: 'Crear/editar/eliminar direcciones' },
                      { value: 'routes:read', label: 'Leer rutas y paradas' },
                      { value: 'routes:write', label: 'Crear/editar/eliminar rutas' },
                      { value: 'users:read', label: 'Leer usuarios' },
                      { value: '*', label: 'Acceso completo (todos los permisos)' },
                    ].map((perm) => (
                      <label key={perm.value} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newApiKeyPermissions.includes(perm.value)}
                          onChange={(e) => {
                            if (perm.value === '*') {
                              // If selecting full access, clear others
                              setNewApiKeyPermissions(e.target.checked ? ['*'] : []);
                            } else {
                              // Remove * if selecting specific permissions
                              const withoutStar = newApiKeyPermissions.filter(p => p !== '*');
                              if (e.target.checked) {
                                setNewApiKeyPermissions([...withoutStar, perm.value]);
                              } else {
                                setNewApiKeyPermissions(withoutStar.filter(p => p !== perm.value));
                              }
                            }
                          }}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                        />
                        <span className="text-sm text-gray-700">{perm.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Expiracion (opcional)
                  </label>
                  <select
                    value={newApiKeyExpiresDays || ''}
                    onChange={(e) => setNewApiKeyExpiresDays(e.target.value ? parseInt(e.target.value) : null)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Sin expiracion</option>
                    <option value="30">30 dias</option>
                    <option value="90">90 dias</option>
                    <option value="180">6 meses</option>
                    <option value="365">1 ano</option>
                  </select>
                </div>
              </div>
            )}

            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              {createdApiKey ? (
                <button
                  onClick={closeCreateModal}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Cerrar
                </button>
              ) : (
                <>
                  <button
                    onClick={closeCreateModal}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleCreateApiKey}
                    disabled={!newApiKeyName || newApiKeyPermissions.length === 0 || creatingApiKey}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                  >
                    {creatingApiKey && <Loader2 className="w-4 h-4 animate-spin" />}
                    Crear API Key
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
