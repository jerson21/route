import { useState, useEffect } from 'react';
import {
  Users,
  Send,
  RefreshCw,
  Smartphone,
  CheckCircle,
  XCircle,
  MessageCircle,
  Loader2,
  Wifi,
  WifiOff
} from 'lucide-react';
import { api } from '../../services/api';

interface ConnectedUser {
  id: string;
  name: string;
  email: string;
  role: string;
  hasToken: boolean;
  tokenPreview: string | null;
  lastActivity: string;
}

const MESSAGE_TEMPLATES = [
  { value: 'test', label: 'Mensaje de prueba', body: 'Este es un mensaje de prueba del sistema FCM' },
  { value: 'cambio_direccion', label: 'Cambio de direccion', body: '' },
  { value: 'espera_pago', label: 'Espera de pago', body: '' },
  { value: 'mensaje_cliente', label: 'Mensaje de cliente', body: '' },
  { value: 'aviso', label: 'Aviso importante', body: '' },
  { value: 'custom', label: 'Personalizado', body: '' },
];

export function ConnectionsPage() {
  const [users, setUsers] = useState<ConnectedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<ConnectedUser | null>(null);
  const [messageType, setMessageType] = useState('test');
  const [messageBody, setMessageBody] = useState('Este es un mensaje de prueba del sistema FCM');
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<{ success: boolean; message: string } | null>(null);

  const fetchConnectedUsers = async () => {
    try {
      setLoading(true);
      const response = await api.get('/users/connected');
      setUsers(response.data.data);
    } catch (error) {
      console.error('Error fetching connected users:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConnectedUsers();
    // Refresh every 30 seconds
    const interval = setInterval(fetchConnectedUsers, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleTemplateChange = (value: string) => {
    setMessageType(value);
    const template = MESSAGE_TEMPLATES.find(t => t.value === value);
    if (template && template.body) {
      setMessageBody(template.body);
    } else if (value !== 'custom') {
      setMessageBody('');
    }
  };

  const handleSendMessage = async () => {
    if (!selectedUser || !messageBody.trim()) return;

    try {
      setSending(true);
      setLastResult(null);

      const template = MESSAGE_TEMPLATES.find(t => t.value === messageType);
      const title = template?.label || 'Mensaje';

      await api.post(`/users/${selectedUser.id}/notify`, {
        title,
        body: messageBody.trim(),
        data: {
          type: 'message',
          testMessage: 'true'
        }
      });

      setLastResult({ success: true, message: `Mensaje enviado a ${selectedUser.name}` });
      setMessageBody('');
      setMessageType('test');
      handleTemplateChange('test');
    } catch (error: any) {
      setLastResult({
        success: false,
        message: error.response?.data?.error || 'Error al enviar mensaje'
      });
    } finally {
      setSending(false);
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'ADMIN': return 'bg-purple-100 text-purple-700';
      case 'OPERATOR': return 'bg-blue-100 text-blue-700';
      case 'DRIVER': return 'bg-green-100 text-green-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
            <Wifi className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Conexiones FCM</h1>
            <p className="text-sm text-gray-500">Usuarios conectados con notificaciones push</p>
          </div>
        </div>
        <button
          onClick={fetchConnectedUsers}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Connected Users List */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-gray-500" />
                Usuarios Conectados
              </h2>
              <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                {users.length} online
              </span>
            </div>
          </div>

          <div className="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
            {loading && users.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
                Cargando...
              </div>
            ) : users.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <WifiOff className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                <p>No hay usuarios conectados</p>
                <p className="text-sm mt-1">Los usuarios aparecen cuando abren la app</p>
              </div>
            ) : (
              users.map(user => (
                <div
                  key={user.id}
                  onClick={() => setSelectedUser(user)}
                  className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                    selectedUser?.id === user.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                        <Smartphone className="w-5 h-5 text-gray-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{user.name}</p>
                        <p className="text-sm text-gray-500">{user.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getRoleColor(user.role)}`}>
                        {user.role}
                      </span>
                      {user.hasToken ? (
                        <CheckCircle className="w-5 h-5 text-green-500" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-500" />
                      )}
                    </div>
                  </div>
                  {user.tokenPreview && (
                    <p className="mt-2 text-xs text-gray-400 font-mono truncate">
                      Token: {user.tokenPreview}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Send Message Panel */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          <div className="p-4 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-gray-500" />
              Enviar Mensaje de Prueba
            </h2>
          </div>

          <div className="p-4 space-y-4">
            {/* Selected User */}
            {selectedUser ? (
              <div className="p-3 bg-blue-50 rounded-lg flex items-center gap-3">
                <Smartphone className="w-5 h-5 text-blue-600" />
                <div>
                  <p className="font-medium text-blue-900">{selectedUser.name}</p>
                  <p className="text-sm text-blue-700">{selectedUser.email}</p>
                </div>
              </div>
            ) : (
              <div className="p-3 bg-gray-50 rounded-lg text-center text-gray-500">
                Selecciona un usuario de la lista
              </div>
            )}

            {/* Message Type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tipo de mensaje
              </label>
              <select
                value={messageType}
                onChange={(e) => handleTemplateChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                disabled={!selectedUser}
              >
                {MESSAGE_TEMPLATES.map(template => (
                  <option key={template.value} value={template.value}>
                    {template.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Message Body */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mensaje
              </label>
              <textarea
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                placeholder="Escribe el mensaje..."
                rows={4}
                maxLength={500}
                disabled={!selectedUser}
              />
              <p className="mt-1 text-xs text-gray-400 text-right">{messageBody.length}/500</p>
            </div>

            {/* Result Message */}
            {lastResult && (
              <div className={`p-3 rounded-lg flex items-center gap-2 ${
                lastResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}>
                {lastResult.success ? (
                  <CheckCircle className="w-5 h-5" />
                ) : (
                  <XCircle className="w-5 h-5" />
                )}
                {lastResult.message}
              </div>
            )}

            {/* Send Button */}
            <button
              onClick={handleSendMessage}
              disabled={!selectedUser || !messageBody.trim() || sending}
              className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-medium"
            >
              {sending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
              {sending ? 'Enviando...' : 'Enviar Mensaje FCM'}
            </button>
          </div>

          {/* Info */}
          <div className="p-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
            <p className="text-xs text-gray-500">
              <strong>Nota:</strong> Los mensajes se envian via Firebase Cloud Messaging.
              El conductor debe tener la app abierta o en background para recibirlos.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
