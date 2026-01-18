import { useState, useEffect } from 'react';
import {
  CreditCard,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Search,
  AlertCircle,
  DollarSign,
  User,
  MapPin,
  ChevronRight
} from 'lucide-react';
import { api } from '../../services/api';

interface PendingPayment {
  id: string;
  stopId: string;
  amount: string;
  customerRut: string | null;
  createdAt: string;
  stop: {
    id: string;
    recipientName: string | null;
    address: {
      customerName: string | null;
      customerPhone: string | null;
    } | null;
    route: {
      id: string;
      name: string;
      assignedToId: string | null;
    } | null;
  };
}

interface VerifyModalState {
  isOpen: boolean;
  payment: PendingPayment | null;
  alternativeRut: string;
  useAlternativeRut: boolean;
  loading: boolean;
  result: { success: boolean; verified: boolean; message: string } | null;
}

export function PaymentsPage() {
  const [payments, setPayments] = useState<PendingPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoursFilter, setHoursFilter] = useState('48');

  const [verifyModal, setVerifyModal] = useState<VerifyModalState>({
    isOpen: false,
    payment: null,
    alternativeRut: '',
    useAlternativeRut: false,
    loading: false,
    result: null
  });

  const fetchPendingPayments = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get(`/payments/pending?hoursAgo=${hoursFilter}`);
      setPayments(response.data.data);
    } catch (err: any) {
      console.error('Error fetching pending payments:', err);
      setError(err.response?.data?.error || 'Error al cargar pagos pendientes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPendingPayments();
  }, [hoursFilter]);

  const openVerifyModal = (payment: PendingPayment) => {
    setVerifyModal({
      isOpen: true,
      payment,
      alternativeRut: '',
      useAlternativeRut: false,
      loading: false,
      result: null
    });
  };

  const closeVerifyModal = () => {
    setVerifyModal({
      isOpen: false,
      payment: null,
      alternativeRut: '',
      useAlternativeRut: false,
      loading: false,
      result: null
    });
  };

  const handleVerify = async () => {
    if (!verifyModal.payment) return;

    setVerifyModal(prev => ({ ...prev, loading: true, result: null }));

    try {
      const body: { customerRut?: string } = {};
      if (verifyModal.useAlternativeRut && verifyModal.alternativeRut.trim()) {
        body.customerRut = verifyModal.alternativeRut.trim();
      }

      const response = await api.post(`/payments/${verifyModal.payment.id}/verify`, body);

      setVerifyModal(prev => ({
        ...prev,
        loading: false,
        result: {
          success: true,
          verified: response.data.verified,
          message: response.data.message
        }
      }));

      // If verified, refresh the list after a short delay
      if (response.data.verified) {
        setTimeout(() => {
          fetchPendingPayments();
          closeVerifyModal();
        }, 2000);
      }
    } catch (err: any) {
      setVerifyModal(prev => ({
        ...prev,
        loading: false,
        result: {
          success: false,
          verified: false,
          message: err.response?.data?.error || 'Error al verificar'
        }
      }));
    }
  };

  const formatCurrency = (amount: string) => {
    const num = parseFloat(amount);
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(num);
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('es-CL', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getHoursAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) return 'Hace menos de 1 hora';
    if (diffHours === 1) return 'Hace 1 hora';
    return `Hace ${diffHours} horas`;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
            <CreditCard className="w-5 h-5 text-yellow-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Pagos Pendientes</h1>
            <p className="text-sm text-gray-500">Transferencias esperando verificacion</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={hoursFilter}
            onChange={(e) => setHoursFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg bg-white text-sm"
          >
            <option value="24">Ultimas 24 horas</option>
            <option value="48">Ultimas 48 horas</option>
            <option value="72">Ultimas 72 horas</option>
            <option value="168">Ultima semana</option>
          </select>
          <button
            onClick={fetchPendingPayments}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <span className="text-red-700">{error}</span>
        </div>
      )}

      {/* Payments List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <Clock className="w-5 h-5 text-yellow-500" />
              Transferencias Pendientes
            </h2>
            <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-sm font-medium">
              {payments.length} pendientes
            </span>
          </div>
        </div>

        <div className="divide-y divide-gray-100">
          {loading && payments.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
              Cargando pagos pendientes...
            </div>
          ) : payments.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-400" />
              <p className="font-medium">No hay transferencias pendientes</p>
              <p className="text-sm mt-1">Todas las transferencias han sido verificadas</p>
            </div>
          ) : (
            payments.map(payment => (
              <div
                key={payment.id}
                className="p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-start gap-4">
                    {/* Amount Badge */}
                    <div className="flex-shrink-0 w-24 h-16 bg-yellow-50 rounded-lg flex flex-col items-center justify-center border border-yellow-200">
                      <DollarSign className="w-4 h-4 text-yellow-600 mb-1" />
                      <span className="text-sm font-bold text-yellow-700">
                        {formatCurrency(payment.amount)}
                      </span>
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <User className="w-4 h-4 text-gray-400" />
                        <span className="font-medium text-gray-900">
                          {payment.stop?.address?.customerName || payment.stop?.recipientName || 'Sin nombre'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
                        <MapPin className="w-4 h-4" />
                        <span>Ruta: {payment.stop?.route?.name || 'N/A'}</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-gray-500">
                          RUT: <span className="font-mono text-gray-700">{payment.customerRut || 'No especificado'}</span>
                        </span>
                        <span className="text-gray-400">|</span>
                        <span className="text-gray-500">{getHoursAgo(payment.createdAt)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Action Button */}
                  <button
                    onClick={() => openVerifyModal(payment)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Search className="w-4 h-4" />
                    Verificar
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Verify Modal */}
      {verifyModal.isOpen && verifyModal.payment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            {/* Modal Header */}
            <div className="p-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Verificar Transferencia</h3>
              <p className="text-sm text-gray-500">Buscar transferencia en el sistema bancario</p>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-4">
              {/* Payment Info */}
              <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">Monto:</span>
                  <span className="font-bold text-gray-900">{formatCurrency(verifyModal.payment.amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Cliente:</span>
                  <span className="text-gray-900">
                    {verifyModal.payment.stop?.address?.customerName || verifyModal.payment.stop?.recipientName || 'N/A'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">RUT original:</span>
                  <span className="font-mono text-gray-900">{verifyModal.payment.customerRut || 'No especificado'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Registrado:</span>
                  <span className="text-gray-900">{formatDate(verifyModal.payment.createdAt)}</span>
                </div>
              </div>

              {/* Alternative RUT Option */}
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={verifyModal.useAlternativeRut}
                    onChange={(e) => setVerifyModal(prev => ({
                      ...prev,
                      useAlternativeRut: e.target.checked
                    }))}
                    className="w-4 h-4 text-blue-600 border-gray-300 rounded"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-700">Transferencia desde otro RUT</span>
                    <p className="text-xs text-gray-500">Si la transferencia fue hecha por familiar o empresa</p>
                  </div>
                </label>

                {verifyModal.useAlternativeRut && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      RUT alternativo
                    </label>
                    <input
                      type="text"
                      value={verifyModal.alternativeRut}
                      onChange={(e) => setVerifyModal(prev => ({
                        ...prev,
                        alternativeRut: e.target.value
                      }))}
                      placeholder="Ej: 12345678-9"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                    />
                  </div>
                )}
              </div>

              {/* Result */}
              {verifyModal.result && (
                <div className={`p-3 rounded-lg flex items-start gap-3 ${
                  verifyModal.result.verified
                    ? 'bg-green-50 border border-green-200'
                    : verifyModal.result.success
                      ? 'bg-yellow-50 border border-yellow-200'
                      : 'bg-red-50 border border-red-200'
                }`}>
                  {verifyModal.result.verified ? (
                    <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className={`w-5 h-5 flex-shrink-0 mt-0.5 ${
                      verifyModal.result.success ? 'text-yellow-600' : 'text-red-600'
                    }`} />
                  )}
                  <div>
                    <p className={`font-medium ${
                      verifyModal.result.verified
                        ? 'text-green-700'
                        : verifyModal.result.success
                          ? 'text-yellow-700'
                          : 'text-red-700'
                    }`}>
                      {verifyModal.result.verified ? 'Transferencia Verificada' : 'No Verificada'}
                    </p>
                    <p className={`text-sm ${
                      verifyModal.result.verified
                        ? 'text-green-600'
                        : verifyModal.result.success
                          ? 'text-yellow-600'
                          : 'text-red-600'
                    }`}>
                      {verifyModal.result.message}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={closeVerifyModal}
                disabled={verifyModal.loading}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
              >
                {verifyModal.result?.verified ? 'Cerrar' : 'Cancelar'}
              </button>
              {!verifyModal.result?.verified && (
                <button
                  onClick={handleVerify}
                  disabled={verifyModal.loading || (verifyModal.useAlternativeRut && !verifyModal.alternativeRut.trim())}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {verifyModal.loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Verificando...
                    </>
                  ) : (
                    <>
                      <Search className="w-4 h-4" />
                      Verificar Transferencia
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Info Card */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="font-medium text-blue-900 mb-2">Como funciona la verificacion</h3>
        <ul className="text-sm text-blue-700 space-y-1">
          <li>1. Cuando un conductor registra pago por transferencia, queda como pendiente</li>
          <li>2. El sistema busca la transferencia usando el RUT y monto</li>
          <li>3. Si la transferencia fue desde otro RUT (familiar/empresa), marcar la opcion y especificar</li>
          <li>4. Al verificar, el pago se marca como completado y se notifica al conductor</li>
        </ul>
      </div>
    </div>
  );
}
