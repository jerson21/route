import { useState, useEffect } from 'react';
import {
  X, MapPin, Clock, User, Phone, Mail, Package, Barcode,
  FileText, CheckSquare, Camera, PenTool, Save, Loader2,
  Truck, ArrowDownToLine, Settings2, Timer, CheckCircle2, XCircle, SkipForward,
  Image, ZoomIn, DollarSign
} from 'lucide-react';
import { api } from '../../services/api';

interface StopDetailPanelProps {
  routeId: string;
  stopId: string;
  stopIndex: number;
  onClose: () => void;
  onUpdate: () => void;
  canEdit: boolean;
}

interface StopDetail {
  id: string;
  sequenceOrder: number;
  status: string;
  stopType: string;
  estimatedMinutes: number;
  priority: number;
  timeWindowStart?: string;
  timeWindowEnd?: string;
  recipientName?: string;
  recipientPhone?: string;
  recipientEmail?: string;
  requireSignature: boolean;
  requirePhoto: boolean;
  proofEnabled: boolean;
  clientName?: string;
  packageCount: number;
  products?: string;
  externalId?: string;
  barcodeIds?: string;
  sellerName?: string;
  orderNotes?: string;
  notes?: string;
  // Evidence fields
  photoUrl?: string;
  signatureUrl?: string;
  failureReason?: string;
  completedAt?: string;
  arrivedAt?: string;
  // Payment fields
  isPaid?: boolean;
  paymentStatus?: string;
  paymentMethod?: string;
  paymentAmount?: number;
  collectionAmount?: number;
  paymentNotes?: string;
  paidAt?: string;
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

const stopTypes = [
  { value: 'DELIVERY', label: 'Entrega', icon: Truck },
  { value: 'PICKUP', label: 'Recogida', icon: ArrowDownToLine },
  { value: 'SERVICE', label: 'Servicio', icon: Settings2 },
  { value: 'CHECKPOINT', label: 'Punto de Control', icon: MapPin }
];

export function StopDetailPanel({ routeId, stopId, stopIndex, onClose, onUpdate, canEdit }: StopDetailPanelProps) {
  const [stop, setStop] = useState<StopDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'config' | 'recipient' | 'order' | 'evidence'>('config');
  const [completing, setCompleting] = useState<'complete' | 'fail' | 'skip' | null>(null);
  const [imageModal, setImageModal] = useState<{ url: string; title: string } | null>(null);

  // R2 public URL for photos
  const R2_PUBLIC_URL = 'https://pub-4b62daba31aa43b392c7937bb84bc325.r2.dev';

  // Form state
  const [formData, setFormData] = useState({
    stopType: 'DELIVERY',
    estimatedMinutes: 15,
    priority: 0,
    timeWindowStart: '',
    timeWindowEnd: '',
    recipientName: '',
    recipientPhone: '',
    recipientEmail: '',
    requireSignature: false,
    requirePhoto: false,
    proofEnabled: true,
    clientName: '',
    packageCount: 1,
    products: '',
    externalId: '',
    barcodeIds: '',
    sellerName: '',
    orderNotes: '',
    notes: ''
  });

  useEffect(() => {
    fetchStopDetails();
  }, [routeId, stopId]);

  // ESC key handler to close panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const fetchStopDetails = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/routes/${routeId}/stops/${stopId}`);
      const stopData = response.data.data;
      setStop(stopData);

      // Update form data
      setFormData({
        stopType: stopData.stopType || 'DELIVERY',
        estimatedMinutes: stopData.estimatedMinutes || 15,
        priority: stopData.priority || 0,
        timeWindowStart: stopData.timeWindowStart ? formatTimeForInput(stopData.timeWindowStart) : '',
        timeWindowEnd: stopData.timeWindowEnd ? formatTimeForInput(stopData.timeWindowEnd) : '',
        recipientName: stopData.recipientName || stopData.address?.customerName || '',
        recipientPhone: stopData.recipientPhone || stopData.address?.customerPhone || '',
        recipientEmail: stopData.recipientEmail || '',
        requireSignature: stopData.requireSignature || false,
        requirePhoto: stopData.requirePhoto || false,
        proofEnabled: stopData.proofEnabled ?? true,
        clientName: stopData.clientName || '',
        packageCount: stopData.packageCount || 1,
        products: stopData.products || '',
        externalId: stopData.externalId || '',
        barcodeIds: stopData.barcodeIds || '',
        sellerName: stopData.sellerName || '',
        orderNotes: stopData.orderNotes || '',
        notes: stopData.notes || ''
      });
    } catch (err: any) {
      setError(err.response?.data?.error || 'Error al cargar los detalles');
    } finally {
      setLoading(false);
    }
  };

  const formatTimeForInput = (dateString: string) => {
    const date = new Date(dateString);
    return date.toTimeString().slice(0, 5);
  };

  const handleChange = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      const payload = {
        ...formData,
        timeWindowStart: formData.timeWindowStart ? `1970-01-01T${formData.timeWindowStart}:00.000Z` : null,
        timeWindowEnd: formData.timeWindowEnd ? `1970-01-01T${formData.timeWindowEnd}:00.000Z` : null
      };

      await api.put(`/routes/${routeId}/stops/${stopId}`, payload);
      onUpdate();
      onClose();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleStopAction = async (action: 'complete' | 'fail' | 'skip') => {
    try {
      setCompleting(action);
      await api.post(`/routes/${routeId}/stops/${stopId}/complete`, {
        status: action === 'complete' ? 'COMPLETED' : action === 'fail' ? 'FAILED' : 'SKIPPED',
        notes: action === 'fail' ? 'Marcado como fallido desde web' : action === 'skip' ? 'Omitido desde web' : undefined
      });
      onUpdate();
      onClose();
    } catch (err: any) {
      alert(err.response?.data?.error || `Error al ${action === 'complete' ? 'completar' : action === 'fail' ? 'marcar como fallido' : 'omitir'} la parada`);
    } finally {
      setCompleting(null);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; color: string }> = {
      PENDING: { label: 'Pendiente', color: 'bg-gray-100 text-gray-700' },
      IN_TRANSIT: { label: 'En camino', color: 'bg-blue-100 text-blue-700' },
      ARRIVED: { label: 'Llegó', color: 'bg-purple-100 text-purple-700' },
      COMPLETED: { label: 'Completada', color: 'bg-green-100 text-green-700' },
      FAILED: { label: 'Fallida', color: 'bg-red-100 text-red-700' },
      SKIPPED: { label: 'Omitida', color: 'bg-yellow-100 text-yellow-700' }
    };
    const config = statusConfig[status] || statusConfig.PENDING;
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${config.color}`}>
        {config.label}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-8">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto" />
        </div>
      </div>
    );
  }

  if (error || !stop) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-8 max-w-md">
          <p className="text-red-600">{error || 'Parada no encontrada'}</p>
          <button onClick={onClose} className="mt-4 px-4 py-2 bg-gray-100 rounded-lg">
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-end z-50">
      <div className="w-[450px] bg-white h-full flex flex-col shadow-2xl animate-slide-in-right">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-start gap-4">
          <div className="flex-shrink-0">
            <svg width="40" height="50" viewBox="0 0 32 40" className="drop-shadow-lg">
              <path
                d="M16 0C7.163 0 0 7.163 0 16c0 8.837 16 24 16 24s16-15.163 16-24C32 7.163 24.837 0 16 0z"
                fill="#4285F4"
              />
              <circle cx="16" cy="14" r="10" fill="white" />
              <text
                x="16"
                y="18"
                textAnchor="middle"
                fontSize="12"
                fontWeight="bold"
                fill="#4285F4"
                fontFamily="Arial, sans-serif"
              >
                {stopIndex + 1}
              </text>
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900 truncate">
                {stop.address.fullAddress}
              </h2>
              {getStatusBadge(stop.status)}
            </div>
            <p className="text-sm text-gray-500">
              Parada #{stopIndex + 1} - {stopTypes.find(t => t.value === formData.stopType)?.label}
              {stop.address.unit && <span className="ml-2 text-blue-600">({stop.address.unit})</span>}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-400"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setActiveTab('config')}
            className={`flex-1 px-4 py-3 text-sm font-medium ${
              activeTab === 'config'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Configuracion
          </button>
          <button
            onClick={() => setActiveTab('recipient')}
            className={`flex-1 px-4 py-3 text-sm font-medium ${
              activeTab === 'recipient'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Destinatario
          </button>
          <button
            onClick={() => setActiveTab('order')}
            className={`flex-1 px-4 py-3 text-sm font-medium ${
              activeTab === 'order'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Pedido
          </button>
          {/* Evidence tab - show for completed/failed/skipped stops */}
          {['COMPLETED', 'FAILED', 'SKIPPED'].includes(stop.status) && (
            <button
              onClick={() => setActiveTab('evidence')}
              className={`flex-1 px-4 py-3 text-sm font-medium ${
                activeTab === 'evidence'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Evidencia
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Config Tab */}
          {activeTab === 'config' && (
            <div className="p-6 space-y-6">
              {/* Stop Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tipo de parada
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {stopTypes.map(type => (
                    <button
                      key={type.value}
                      onClick={() => canEdit && handleChange('stopType', type.value)}
                      disabled={!canEdit}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                        formData.stopType === type.value
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                      } ${!canEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
                    >
                      <type.icon className="w-4 h-4" />
                      <span className="text-sm">{type.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Estimated Time */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Timer className="w-4 h-4 inline mr-1" />
                  Tiempo estimado en parada
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={formData.estimatedMinutes}
                    onChange={(e) => handleChange('estimatedMinutes', parseInt(e.target.value) || 0)}
                    disabled={!canEdit}
                    className="w-20 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    min="1"
                    max="480"
                  />
                  <span className="text-gray-500">minutos</span>
                </div>
              </div>

              {/* Time Window */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Clock className="w-4 h-4 inline mr-1" />
                  Ventana de tiempo
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={formData.timeWindowStart}
                    onChange={(e) => handleChange('timeWindowStart', e.target.value)}
                    disabled={!canEdit}
                    placeholder="Desde"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                  />
                  <span className="text-gray-400">-</span>
                  <input
                    type="time"
                    value={formData.timeWindowEnd}
                    onChange={(e) => handleChange('timeWindowEnd', e.target.value)}
                    disabled={!canEdit}
                    placeholder="Hasta"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Deja vacio para "cualquier hora"
                </p>
              </div>

              {/* Proof of Delivery */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  <CheckSquare className="w-4 h-4 inline mr-1" />
                  Prueba de entrega
                </label>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.proofEnabled}
                      onChange={(e) => handleChange('proofEnabled', e.target.checked)}
                      disabled={!canEdit}
                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Habilitar prueba de entrega</span>
                  </label>
                  {formData.proofEnabled && (
                    <>
                      <label className="flex items-center gap-3 cursor-pointer ml-6">
                        <input
                          type="checkbox"
                          checked={formData.requireSignature}
                          onChange={(e) => handleChange('requireSignature', e.target.checked)}
                          disabled={!canEdit}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <PenTool className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-700">Requiere firma</span>
                      </label>
                      <label className="flex items-center gap-3 cursor-pointer ml-6">
                        <input
                          type="checkbox"
                          checked={formData.requirePhoto}
                          onChange={(e) => handleChange('requirePhoto', e.target.checked)}
                          disabled={!canEdit}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <Camera className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-700">Requiere foto</span>
                      </label>
                    </>
                  )}
                </div>
              </div>

              {/* Priority */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Prioridad
                </label>
                <select
                  value={formData.priority}
                  onChange={(e) => handleChange('priority', parseInt(e.target.value))}
                  disabled={!canEdit}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                >
                  <option value={0}>Normal</option>
                  <option value={1}>Alta</option>
                  <option value={2}>Urgente</option>
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <FileText className="w-4 h-4 inline mr-1" />
                  Notas de entrega
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => handleChange('notes', e.target.value)}
                  disabled={!canEdit}
                  rows={3}
                  placeholder="Instrucciones especiales..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 resize-none"
                />
              </div>
            </div>
          )}

          {/* Recipient Tab */}
          {activeTab === 'recipient' && (
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <User className="w-4 h-4 inline mr-1" />
                  Nombre del destinatario
                </label>
                <input
                  type="text"
                  value={formData.recipientName}
                  onChange={(e) => handleChange('recipientName', e.target.value)}
                  disabled={!canEdit}
                  placeholder="Nombre completo"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Phone className="w-4 h-4 inline mr-1" />
                  Telefono
                </label>
                <input
                  type="tel"
                  value={formData.recipientPhone}
                  onChange={(e) => handleChange('recipientPhone', e.target.value)}
                  disabled={!canEdit}
                  placeholder="+56 9 1234 5678"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Mail className="w-4 h-4 inline mr-1" />
                  Email
                </label>
                <input
                  type="email"
                  value={formData.recipientEmail}
                  onChange={(e) => handleChange('recipientEmail', e.target.value)}
                  disabled={!canEdit}
                  placeholder="email@ejemplo.com"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                />
              </div>

              <div className="pt-4 border-t border-gray-200">
                <h4 className="text-sm font-medium text-gray-700 mb-3">Informacion del cliente</h4>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Nombre del cliente</label>
                    <input
                      type="text"
                      value={formData.clientName}
                      onChange={(e) => handleChange('clientName', e.target.value)}
                      disabled={!canEdit}
                      placeholder="Empresa o cliente"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    />
                  </div>

                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Vendedor</label>
                    <input
                      type="text"
                      value={formData.sellerName}
                      onChange={(e) => handleChange('sellerName', e.target.value)}
                      disabled={!canEdit}
                      placeholder="Nombre del vendedor"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Order Tab */}
          {activeTab === 'order' && (
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Package className="w-4 h-4 inline mr-1" />
                  Cantidad de paquetes
                </label>
                <input
                  type="number"
                  value={formData.packageCount}
                  onChange={(e) => handleChange('packageCount', parseInt(e.target.value) || 1)}
                  disabled={!canEdit}
                  min="1"
                  className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Barcode className="w-4 h-4 inline mr-1" />
                  Codigos de barras
                </label>
                <input
                  type="text"
                  value={formData.barcodeIds}
                  onChange={(e) => handleChange('barcodeIds', e.target.value)}
                  disabled={!canEdit}
                  placeholder="ABC123, DEF456"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                />
                <p className="text-xs text-gray-500 mt-1">Separar multiples codigos con coma</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  ID externo
                </label>
                <input
                  type="text"
                  value={formData.externalId}
                  onChange={(e) => handleChange('externalId', e.target.value)}
                  disabled={!canEdit}
                  placeholder="Referencia externa"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Productos
                </label>
                <textarea
                  value={formData.products}
                  onChange={(e) => handleChange('products', e.target.value)}
                  disabled={!canEdit}
                  rows={3}
                  placeholder="Descripcion de productos..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Notas del pedido
                </label>
                <textarea
                  value={formData.orderNotes}
                  onChange={(e) => handleChange('orderNotes', e.target.value)}
                  disabled={!canEdit}
                  rows={3}
                  placeholder="Notas adicionales del pedido..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 resize-none"
                />
              </div>
            </div>
          )}

          {/* Evidence Tab */}
          {activeTab === 'evidence' && (
            <div className="p-6 space-y-6">
              {/* Completion Status */}
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center gap-3 mb-3">
                  {stop.status === 'COMPLETED' && <CheckCircle2 className="w-6 h-6 text-green-600" />}
                  {stop.status === 'FAILED' && <XCircle className="w-6 h-6 text-red-600" />}
                  {stop.status === 'SKIPPED' && <SkipForward className="w-6 h-6 text-yellow-600" />}
                  <div>
                    <p className="font-medium text-gray-900">
                      {stop.status === 'COMPLETED' && 'Entrega completada'}
                      {stop.status === 'FAILED' && 'Entrega fallida'}
                      {stop.status === 'SKIPPED' && 'Entrega omitida'}
                    </p>
                    {stop.completedAt && (
                      <p className="text-sm text-gray-500">
                        {new Date(stop.completedAt).toLocaleString('es-CL', {
                          dateStyle: 'medium',
                          timeStyle: 'short'
                        })}
                      </p>
                    )}
                  </div>
                </div>

                {/* Failure reason */}
                {stop.status === 'FAILED' && stop.failureReason && (
                  <div className="mt-3 p-3 bg-red-50 rounded-lg">
                    <p className="text-sm font-medium text-red-800">Motivo de falla:</p>
                    <p className="text-sm text-red-700">{stop.failureReason}</p>
                  </div>
                )}

                {/* Notes */}
                {stop.notes && (
                  <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                    <p className="text-sm font-medium text-blue-800">Notas:</p>
                    <p className="text-sm text-blue-700">{stop.notes}</p>
                  </div>
                )}
              </div>

              {/* Photo Evidence */}
              <div>
                <h4 className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                  <Camera className="w-4 h-4" />
                  Foto de entrega
                </h4>
                {stop.photoUrl ? (
                  <div
                    className="relative group cursor-pointer rounded-lg overflow-hidden border border-gray-200"
                    onClick={() => setImageModal({
                      url: stop.photoUrl!.startsWith('http') ? stop.photoUrl! : `${R2_PUBLIC_URL}/${stop.photoUrl}`,
                      title: 'Foto de entrega'
                    })}
                  >
                    <img
                      src={stop.photoUrl.startsWith('http') ? stop.photoUrl : `${R2_PUBLIC_URL}/${stop.photoUrl}`}
                      alt="Foto de entrega"
                      className="w-full h-48 object-cover"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                      <ZoomIn className="w-8 h-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                    <Image className="w-10 h-10 text-gray-300 mb-2" />
                    <p className="text-sm text-gray-500">Sin foto de entrega</p>
                  </div>
                )}
              </div>

              {/* Signature Evidence */}
              <div>
                <h4 className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                  <PenTool className="w-4 h-4" />
                  Firma
                </h4>
                {stop.signatureUrl ? (
                  <div
                    className="relative group cursor-pointer rounded-lg overflow-hidden border border-gray-200 bg-white"
                    onClick={() => setImageModal({
                      url: stop.signatureUrl!.startsWith('http') ? stop.signatureUrl! : `${R2_PUBLIC_URL}/${stop.signatureUrl}`,
                      title: 'Firma del destinatario'
                    })}
                  >
                    <img
                      src={stop.signatureUrl.startsWith('http') ? stop.signatureUrl : `${R2_PUBLIC_URL}/${stop.signatureUrl}`}
                      alt="Firma"
                      className="w-full h-32 object-contain p-4"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all flex items-center justify-center">
                      <ZoomIn className="w-8 h-8 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-300">
                    <PenTool className="w-10 h-10 text-gray-300 mb-2" />
                    <p className="text-sm text-gray-500">Sin firma</p>
                  </div>
                )}
              </div>

              {/* Payment Info */}
              {(stop.isPaid || stop.paymentAmount) && (
                <div>
                  <h4 className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
                    <DollarSign className="w-4 h-4" />
                    Informacion de pago
                  </h4>
                  <div className="bg-gray-50 rounded-lg p-4 space-y-2">
                    {stop.paymentAmount && (
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Monto esperado:</span>
                        <span className="text-sm font-medium">${stop.paymentAmount.toLocaleString('es-CL')}</span>
                      </div>
                    )}
                    {stop.collectionAmount && (
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Monto cobrado:</span>
                        <span className="text-sm font-medium text-green-600">${stop.collectionAmount.toLocaleString('es-CL')}</span>
                      </div>
                    )}
                    {stop.paymentMethod && (
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Metodo:</span>
                        <span className="text-sm font-medium">
                          {stop.paymentMethod === 'CASH' && 'Efectivo'}
                          {stop.paymentMethod === 'CARD' && 'Tarjeta'}
                          {stop.paymentMethod === 'TRANSFER' && 'Transferencia'}
                          {stop.paymentMethod === 'ONLINE' && 'Pago online'}
                        </span>
                      </div>
                    )}
                    {stop.paymentStatus && (
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-600">Estado:</span>
                        <span className={`text-sm font-medium ${
                          stop.paymentStatus === 'PAID' ? 'text-green-600' :
                          stop.paymentStatus === 'PARTIAL' ? 'text-yellow-600' :
                          'text-gray-600'
                        }`}>
                          {stop.paymentStatus === 'PAID' && 'Pagado'}
                          {stop.paymentStatus === 'PARTIAL' && 'Pago parcial'}
                          {stop.paymentStatus === 'PENDING' && 'Pendiente'}
                          {stop.paymentStatus === 'CANCELLED' && 'Cancelado'}
                        </span>
                      </div>
                    )}
                    {stop.paymentNotes && (
                      <div className="pt-2 border-t border-gray-200">
                        <p className="text-sm text-gray-600">Notas: {stop.paymentNotes}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 space-y-3">
          {/* Action buttons - only for PENDING or IN_TRANSIT stops */}
          {(stop.status === 'PENDING' || stop.status === 'IN_TRANSIT' || stop.status === 'ARRIVED') && (
            <div className="flex gap-2">
              <button
                onClick={() => handleStopAction('complete')}
                disabled={completing !== null}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {completing === 'complete' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                Completar
              </button>
              <button
                onClick={() => handleStopAction('fail')}
                disabled={completing !== null}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {completing === 'fail' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <XCircle className="w-4 h-4" />
                )}
                Fallida
              </button>
              <button
                onClick={() => handleStopAction('skip')}
                disabled={completing !== null}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 disabled:opacity-50"
              >
                {completing === 'skip' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <SkipForward className="w-4 h-4" />
                )}
                Omitir
              </button>
            </div>
          )}

          {/* Edit/Save buttons */}
          {canEdit && (
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-100 text-gray-700"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Guardar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Image Modal */}
      {imageModal && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60]"
          onClick={() => setImageModal(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] w-full mx-4">
            <button
              onClick={() => setImageModal(null)}
              className="absolute -top-10 right-0 text-white hover:text-gray-300 transition-colors"
            >
              <X className="w-8 h-8" />
            </button>
            <p className="text-white text-center mb-4 font-medium">{imageModal.title}</p>
            <img
              src={imageModal.url}
              alt={imageModal.title}
              className="w-full h-auto max-h-[80vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
}
