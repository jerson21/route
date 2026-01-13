import { useState, useEffect, useRef } from 'react';
import { Upload, MapPin, Search, RefreshCw, CheckCircle, XCircle, Clock, Plus, X } from 'lucide-react';
import { RouteMap } from '../../components/map/RouteMap';
import { api } from '../../services/api';

interface Address {
  id: string;
  street: string;
  number?: string;
  unit?: string; // Depto, Casa, Oficina, Local, etc.
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
  fullAddress: string;
  latitude?: number;
  longitude?: number;
  geocodeStatus: 'PENDING' | 'SUCCESS' | 'FAILED' | 'MANUAL';
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  createdAt: string;
}

export function AddressesPage() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedAddress, setSelectedAddress] = useState<Address | null>(null);
  const [uploading, setUploading] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [showNewAddressModal, setShowNewAddressModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newAddress, setNewAddress] = useState({
    street: '',
    number: '',
    unit: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'México',
    customerName: '',
    customerPhone: '',
    notes: ''
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchAddresses = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (statusFilter) params.append('status', statusFilter);
      params.append('limit', '100');

      const response = await api.get(`/addresses?${params.toString()}`);
      setAddresses(response.data.data);
    } catch (error) {
      console.error('Error fetching addresses:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAddresses();
  }, [search, statusFilter]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);
      const formData = new FormData();
      formData.append('file', file);

      const response = await api.post('/addresses/import-excel', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      alert(`Se importaron ${response.data.count} direcciones correctamente`);
      fetchAddresses();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error al importar archivo');
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleGeocodePending = async () => {
    try {
      setGeocoding(true);
      const response = await api.post('/addresses/geocode-pending');
      alert(`Geocodificación completada: ${response.data.data.success} exitosas, ${response.data.data.failed} fallidas`);
      fetchAddresses();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error al geocodificar');
    } finally {
      setGeocoding(false);
    }
  };

  const handleGeocodeOne = async (id: string) => {
    try {
      await api.post(`/addresses/${id}/geocode`);
      fetchAddresses();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error al geocodificar');
    }
  };

  const handleCreateAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAddress.street || !newAddress.city) {
      alert('Calle y Ciudad son requeridos');
      return;
    }

    try {
      setSaving(true);
      await api.post('/addresses', newAddress);
      setShowNewAddressModal(false);
      setNewAddress({
        street: '',
        number: '',
        unit: '',
        city: '',
        state: '',
        postalCode: '',
        country: 'México',
        customerName: '',
        customerPhone: '',
        notes: ''
      });
      fetchAddresses();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error al crear dirección');
    } finally {
      setSaving(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'SUCCESS':
      case 'MANUAL':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'FAILED':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'PENDING':
      default:
        return <Clock className="w-4 h-4 text-yellow-500" />;
    }
  };

  const mapLocations = addresses
    .filter(a => a.latitude && a.longitude)
    .map(a => ({
      id: a.id,
      lat: a.latitude!,
      lng: a.longitude!,
      label: a.customerName || a.fullAddress.substring(0, 20)
    }));

  const pendingCount = addresses.filter(a => a.geocodeStatus === 'PENDING').length;

  return (
    <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Direcciones</h1>
            <p className="text-gray-500">Gestiona las direcciones de entrega</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowNewAddressModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus className="w-4 h-4" />
              Nueva Dirección
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              {uploading ? 'Importando...' : 'Importar Excel'}
            </button>
            {pendingCount > 0 && (
              <button
                onClick={handleGeocodePending}
                disabled={geocoding}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${geocoding ? 'animate-spin' : ''}`} />
                Geocodificar ({pendingCount})
              </button>
            )}
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Buscar por dirección o cliente..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Todos los estados</option>
            <option value="PENDING">Pendientes</option>
            <option value="SUCCESS">Geocodificadas</option>
            <option value="FAILED">Fallidas</option>
            <option value="MANUAL">Manual</option>
          </select>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Map */}
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <MapPin className="w-5 h-5" />
              Mapa de direcciones
            </h2>
            <RouteMap
              apiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''}
              locations={mapLocations}
              onMarkerClick={(loc) => {
                const addr = addresses.find(a => a.id === loc.id);
                if (addr) setSelectedAddress(addr);
              }}
            />
          </div>

          {/* Address List */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b">
              <h2 className="text-lg font-semibold">Lista de direcciones</h2>
              <p className="text-sm text-gray-500">{addresses.length} direcciones encontradas</p>
            </div>
            <div className="max-h-[500px] overflow-y-auto">
              {loading ? (
                <div className="p-8 text-center text-gray-500">Cargando...</div>
              ) : addresses.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  No hay direcciones. Importa un archivo Excel para comenzar.
                </div>
              ) : (
                <div className="divide-y">
                  {addresses.map((address) => (
                    <div
                      key={address.id}
                      onClick={() => setSelectedAddress(address)}
                      className={`p-4 cursor-pointer hover:bg-gray-50 ${
                        selectedAddress?.id === address.id ? 'bg-blue-50' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            {getStatusIcon(address.geocodeStatus)}
                            <span className="font-medium">{address.fullAddress}</span>
                          </div>
                          {address.customerName && (
                            <p className="text-sm text-gray-600 mt-1">
                              Cliente: {address.customerName}
                            </p>
                          )}
                          {address.customerPhone && (
                            <p className="text-sm text-gray-500">
                              Tel: {address.customerPhone}
                            </p>
                          )}
                        </div>
                        {address.geocodeStatus === 'PENDING' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleGeocodeOne(address.id);
                            }}
                            className="text-blue-600 hover:text-blue-800 text-sm"
                          >
                            Geocodificar
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Selected Address Detail */}
        {selectedAddress && (
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">Detalle de dirección</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <label className="text-sm text-gray-500">Calle</label>
                <p className="font-medium">{selectedAddress.street} {selectedAddress.number}</p>
              </div>
              <div>
                <label className="text-sm text-gray-500">Depto/Unidad</label>
                <p className="font-medium">{selectedAddress.unit || '-'}</p>
              </div>
              <div>
                <label className="text-sm text-gray-500">Ciudad</label>
                <p className="font-medium">{selectedAddress.city}</p>
              </div>
              <div>
                <label className="text-sm text-gray-500">Estado</label>
                <p className="font-medium">{selectedAddress.state || '-'}</p>
              </div>
              <div>
                <label className="text-sm text-gray-500">CP</label>
                <p className="font-medium">{selectedAddress.postalCode || '-'}</p>
              </div>
              <div>
                <label className="text-sm text-gray-500">Cliente</label>
                <p className="font-medium">{selectedAddress.customerName || '-'}</p>
              </div>
              <div>
                <label className="text-sm text-gray-500">Teléfono</label>
                <p className="font-medium">{selectedAddress.customerPhone || '-'}</p>
              </div>
              <div>
                <label className="text-sm text-gray-500">Coordenadas</label>
                <p className="font-medium">
                  {selectedAddress.latitude && selectedAddress.longitude
                    ? `${selectedAddress.latitude.toFixed(6)}, ${selectedAddress.longitude.toFixed(6)}`
                    : 'Sin geocodificar'}
                </p>
              </div>
              <div>
                <label className="text-sm text-gray-500">Estado Geo</label>
                <p className="font-medium flex items-center gap-2">
                  {getStatusIcon(selectedAddress.geocodeStatus)}
                  {selectedAddress.geocodeStatus}
                </p>
              </div>
            </div>
            {selectedAddress.notes && (
              <div className="mt-4">
                <label className="text-sm text-gray-500">Notas</label>
                <p className="font-medium">{selectedAddress.notes}</p>
              </div>
            )}
          </div>
        )}

        {/* New Address Modal */}
        {showNewAddressModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900">Nueva Dirección</h3>
                <button
                  onClick={() => setShowNewAddressModal(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <X className="w-5 h-5 text-gray-400" />
                </button>
              </div>
              <form onSubmit={handleCreateAddress} className="p-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Calle / Dirección *
                    </label>
                    <input
                      type="text"
                      value={newAddress.street}
                      onChange={(e) => setNewAddress({ ...newAddress, street: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Av. Providencia"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Número
                    </label>
                    <input
                      type="text"
                      value={newAddress.number}
                      onChange={(e) => setNewAddress({ ...newAddress, number: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="1234"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Depto / Unidad
                    </label>
                    <input
                      type="text"
                      value={newAddress.unit}
                      onChange={(e) => setNewAddress({ ...newAddress, unit: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Depto 501, Of. 204, Casa 3..."
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Ciudad *
                    </label>
                    <input
                      type="text"
                      value={newAddress.city}
                      onChange={(e) => setNewAddress({ ...newAddress, city: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Santiago"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Estado / Región
                    </label>
                    <input
                      type="text"
                      value={newAddress.state}
                      onChange={(e) => setNewAddress({ ...newAddress, state: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Región Metropolitana"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Código Postal
                    </label>
                    <input
                      type="text"
                      value={newAddress.postalCode}
                      onChange={(e) => setNewAddress({ ...newAddress, postalCode: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="7500000"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      País
                    </label>
                    <input
                      type="text"
                      value={newAddress.country}
                      onChange={(e) => setNewAddress({ ...newAddress, country: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="México"
                    />
                  </div>
                </div>

                <div className="border-t pt-4 mt-4">
                  <h4 className="text-sm font-medium text-gray-700 mb-3">Información del Cliente (Opcional)</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Nombre del Cliente
                      </label>
                      <input
                        type="text"
                        value={newAddress.customerName}
                        onChange={(e) => setNewAddress({ ...newAddress, customerName: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Juan Pérez"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Teléfono
                      </label>
                      <input
                        type="text"
                        value={newAddress.customerPhone}
                        onChange={(e) => setNewAddress({ ...newAddress, customerPhone: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="+52 55 1234 5678"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Notas
                      </label>
                      <textarea
                        value={newAddress.notes}
                        onChange={(e) => setNewAddress({ ...newAddress, notes: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        rows={2}
                        placeholder="Instrucciones especiales de entrega..."
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t">
                  <button
                    type="button"
                    onClick={() => setShowNewAddressModal(false)}
                    className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? 'Guardando...' : 'Crear Dirección'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
    </div>
  );
}
