import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ChevronLeft, ChevronRight, MapPin, User, Loader2 } from 'lucide-react';
import { api } from '../../services/api';

interface Route {
  id: string;
  name: string;
  status: string;
  scheduledDate?: string;
  assignedTo?: { id: string; firstName: string; lastName: string };
  depot?: { id: string; name: string };
  _count?: { stops: number };
}

interface Depot {
  id: string;
  name: string;
  isDefault: boolean;
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
  IN_PROGRESS: 'En progreso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada'
};

const DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function RoutesPage() {
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [routes, setRoutes] = useState<Route[]>([]);
  const [depot, setDepot] = useState<Depot | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const fetchDefaultDepot = async () => {
    try {
      const response = await api.get('/depots/default');
      setDepot(response.data.data);
    } catch (error) {
      console.error('Error fetching depot:', error);
    }
  };

  const fetchRoutes = async () => {
    try {
      setLoading(true);
      const dateStr = selectedDate.toISOString().split('T')[0];
      const response = await api.get(`/routes?date=${dateStr}`);
      setRoutes(response.data.data);
    } catch (error) {
      console.error('Error fetching routes:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDefaultDepot();
  }, []);

  useEffect(() => {
    fetchRoutes();
  }, [selectedDate]);

  const handleCreateRoute = async () => {
    if (!depot) {
      alert('Configura un depot primero en Configuración');
      navigate('/settings');
      return;
    }

    try {
      setCreating(true);
      const dateOptions: Intl.DateTimeFormatOptions = {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
      };
      const dateName = selectedDate.toLocaleDateString('es-CL', dateOptions);

      const response = await api.post('/routes', {
        name: `${dateName} Route`,
        scheduledDate: selectedDate.toISOString(),
        depotId: depot.id,
        originAddress: depot.name,
        originLatitude: 0, // Se actualizará del depot
        originLongitude: 0
      });

      navigate(`/routes/${response.data.data.id}`);
    } catch (error: any) {
      alert(error.response?.data?.error || 'Error al crear ruta');
      setCreating(false);
    }
  };

  // Calendar helpers
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = (firstDay.getDay() + 6) % 7; // Monday = 0

    const days: (number | null)[] = [];
    for (let i = 0; i < startingDay; i++) {
      days.push(null);
    }
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }
    return days;
  };

  const isToday = (day: number) => {
    const today = new Date();
    return (
      day === today.getDate() &&
      currentMonth.getMonth() === today.getMonth() &&
      currentMonth.getFullYear() === today.getFullYear()
    );
  };

  const isSelected = (day: number) => {
    return (
      day === selectedDate.getDate() &&
      currentMonth.getMonth() === selectedDate.getMonth() &&
      currentMonth.getFullYear() === selectedDate.getFullYear()
    );
  };

  const selectDay = (day: number) => {
    const newDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day);
    setSelectedDate(newDate);
  };

  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
  };

  const goToToday = () => {
    const today = new Date();
    setCurrentMonth(today);
    setSelectedDate(today);
  };

  const totalStops = routes.reduce((acc, r) => acc + (r._count?.stops || 0), 0);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-16 px-6 border-b border-gray-200 flex items-center justify-between bg-white">
        <h1 className="text-xl font-semibold text-gray-900">Rutas</h1>
        <button
          onClick={handleCreateRoute}
          disabled={creating}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Crear nueva ruta
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="flex gap-6">
          {/* Left: Calendar + Overview */}
          <div className="w-80 space-y-6">
            {/* Calendar */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">
                  {MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}
                </h3>
                <div className="flex items-center gap-1">
                  <button
                    onClick={goToToday}
                    className="px-2 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded"
                  >
                    Hoy
                  </button>
                  <button onClick={prevMonth} className="p-1 hover:bg-gray-100 rounded">
                    <ChevronLeft className="w-5 h-5 text-gray-500" />
                  </button>
                  <button onClick={nextMonth} className="p-1 hover:bg-gray-100 rounded">
                    <ChevronRight className="w-5 h-5 text-gray-500" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1 mb-2">
                {DAYS.map((day) => (
                  <div key={day} className="text-center text-xs font-medium text-gray-500 py-1">
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {getDaysInMonth(currentMonth).map((day, index) => (
                  <button
                    key={index}
                    onClick={() => day && selectDay(day)}
                    disabled={!day}
                    className={`aspect-square flex items-center justify-center text-sm rounded-lg transition-colors ${
                      !day
                        ? ''
                        : isSelected(day)
                        ? 'bg-blue-600 text-white font-medium'
                        : isToday(day)
                        ? 'bg-blue-100 text-blue-700 font-medium'
                        : 'hover:bg-gray-100 text-gray-700'
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>

            {/* Overview */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center gap-2 mb-4">
                <MapPin className="w-5 h-5 text-gray-400" />
                <span className="font-medium text-gray-900">{depot?.name || 'Sin depot'}</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-2xl font-bold text-gray-900">{routes.length}</p>
                  <p className="text-sm text-gray-500">Rutas</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{totalStops}</p>
                  <p className="text-sm text-gray-500">Paradas</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Routes list */}
          <div className="flex-1">
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="font-semibold text-gray-900">
                  Rutas - {selectedDate.toLocaleDateString('es-CL', {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long'
                  })}
                </h2>
              </div>

              {loading ? (
                <div className="p-8 text-center">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" />
                </div>
              ) : routes.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <MapPin className="w-8 h-8 text-gray-400" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No hay rutas</h3>
                  <p className="text-gray-500 mb-4">Crea una ruta para este día</p>
                  <button
                    onClick={handleCreateRoute}
                    disabled={creating}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Crear ruta
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {routes.map((route) => (
                    <div
                      key={route.id}
                      onClick={() => navigate(`/routes/${route.id}`)}
                      className="px-6 py-4 hover:bg-gray-50 cursor-pointer"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-medium text-gray-900">{route.name}</h3>
                        <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${statusColors[route.status]}`}>
                          {statusLabels[route.status]}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <MapPin className="w-4 h-4" />
                          {route._count?.stops || 0} paradas
                        </span>
                        {route.assignedTo && (
                          <span className="flex items-center gap-1">
                            <User className="w-4 h-4" />
                            {route.assignedTo.firstName} {route.assignedTo.lastName}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
