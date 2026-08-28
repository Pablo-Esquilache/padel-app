import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { MapPin, User, Building2, Clock, CalendarDays, Phone } from 'lucide-react';

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    managerName: '',
    adminPhone: '',
    location: '',
    openingDays: [1,2,3,4,5,6,0] as number[],
    openingHours: '08:00 - 00:00',
    courtsCount: 1,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    setLoading(true);
    setError('');

    try {
      // 1. Crear el Club
      const { data: clubData, error: clubError } = await supabase
        .from('clubs')
        .insert([
          {
            owner_id: user.id,
            name: formData.name,
            manager_name: formData.managerName,
            admin_phone: formData.adminPhone,
            location: formData.location,
            opening_days: formData.openingDays.join(','),
            opening_hours: formData.openingHours,
            courts_count: formData.courtsCount,
          }
        ])
        .select()
        .single();

      if (clubError) throw clubError;

      // 2. Crear las canchas automáticamente
      const courtsToInsert = Array.from({ length: formData.courtsCount }).map((_, i) => ({
        club_id: clubData.id,
        name: `Cancha ${i + 1}`
      }));

      const { error: courtsError } = await supabase.from('courts').insert(courtsToInsert);
      
      if (courtsError) throw courtsError;

      // Todo listo, ir al dashboard
      navigate('/admin/dashboard');
    } catch (err: any) {
      setError(err.message || 'Error al guardar los datos');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8 flex flex-col items-center">
      <div className="max-w-2xl w-full bg-white p-8 rounded-xl shadow-sm border border-slate-200">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-extrabold text-slate-900">Configura tu Complejo</h2>
          <p className="mt-2 text-slate-600">Completa estos datos para empezar a gestionar tus turnos.</p>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 text-red-500 p-3 rounded text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nombre del Complejo</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Building2 className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="text"
                  name="name"
                  required
                  value={formData.name}
                  onChange={handleChange}
                  className="pl-10 block w-full rounded-md border border-slate-300 py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                  placeholder="Ej: Padel Center"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Nombre del Dueño/Encargado</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="text"
                  name="managerName"
                  required
                  value={formData.managerName}
                  onChange={handleChange}
                  className="pl-10 block w-full rounded-md border border-slate-300 py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                  placeholder="Ej: Juan Pérez"
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Ubicación</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <MapPin className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="text"
                  name="location"
                  required
                  value={formData.location}
                  onChange={handleChange}
                  className="pl-10 block w-full rounded-md border border-slate-300 py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                  placeholder="Ej: Av. Principal 123, Ciudad"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Teléfono para recibir avisos (WhatsApp)</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Phone className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="tel"
                  name="adminPhone"
                  required
                  value={formData.adminPhone}
                  onChange={handleChange}
                  className="pl-10 block w-full rounded-md border border-slate-300 py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                  placeholder="Ej: +54 9 11 1234 5678"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Días de Apertura</label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-slate-50 p-4 border rounded-md">
                {[
                  { id: 1, label: 'Lunes' }, { id: 2, label: 'Martes' }, { id: 3, label: 'Miércoles' },
                  { id: 4, label: 'Jueves' }, { id: 5, label: 'Viernes' }, { id: 6, label: 'Sábado' }, { id: 0, label: 'Domingo' }
                ].map(day => (
                  <label key={day.id} className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="checkbox" 
                      className="rounded text-primary focus:ring-primary w-4 h-4"
                      checked={formData.openingDays.includes(day.id)}
                      onChange={(e) => {
                        const newDays = e.target.checked 
                          ? [...formData.openingDays, day.id] 
                          : formData.openingDays.filter(d => d !== day.id);
                        setFormData({...formData, openingDays: newDays});
                      }}
                    />
                    <span className="text-sm text-slate-700">{day.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Horarios</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Clock className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="text"
                  name="openingHours"
                  required
                  value={formData.openingHours}
                  onChange={handleChange}
                  className="pl-10 block w-full rounded-md border border-slate-300 py-2 px-3 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm"
                  placeholder="Ej: 08:00 - 00:00"
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Cantidad de Canchas</label>
              <select
                name="courtsCount"
                value={formData.courtsCount}
                onChange={handleChange}
                className="mt-1 block w-full pl-3 pr-10 py-2 text-base border border-slate-300 focus:outline-none focus:ring-primary focus:border-primary sm:text-sm rounded-md"
              >
                {[1,2,3,4,5,6,7,8,9,10].map(num => (
                  <option key={num} value={num}>{num} {num === 1 ? 'cancha' : 'canchas'}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="pt-4">
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-primary hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50"
            >
              {loading ? 'Guardando configuración...' : 'Comenzar a usar el sistema'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
