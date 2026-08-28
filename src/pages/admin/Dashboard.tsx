import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { LogOut, Calendar, Users, Share2, Trash2, Settings, Ban } from 'lucide-react';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'turnos' | 'clientes' | 'bloqueos' | 'config'>('turnos');
  
  const [club, setClub] = useState<any>(null);
  const [courts, setCourts] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [blockedTimes, setBlockedTimes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // States para Formularios
  const [phoneForm, setPhoneForm] = useState('');
  const [blockForm, setBlockForm] = useState({
    courtId: '',
    dayOfWeek: 1, // 1=Lunes
    startTime: '12:00',
    endTime: '13:00',
    description: 'Clase Escuelita'
  });

  useEffect(() => {
    if (user) {
      loadDashboardData();
    }
  }, [user]);

  const loadDashboardData = async () => {
    try {
      const { data: clubData, error: clubError } = await supabase
        .from('clubs')
        .select('*')
        .eq('owner_id', user?.id)
        .maybeSingle();
      
      if (clubError) throw clubError;
      if (!clubData) {
        navigate('/admin/onboarding');
        return;
      }

      setClub(clubData);
      setPhoneForm(clubData.admin_phone || '');

      const { data: courtsData } = await supabase.from('courts').select('*').eq('club_id', clubData.id);
      const courtsList = courtsData || [];
      setCourts(courtsList);

      if (courtsList.length > 0) {
        const courtIds = courtsList.map(c => c.id);
        
        const getLocalDateString = () => {
          const d = new Date();
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };
        const today = getLocalDateString();

        // Turnos (Solo desde hoy en adelante)
        const { data: bookingsData } = await supabase
          .from('bookings')
          .select('*')
          .in('court_id', courtIds)
          .gte('booking_date', today)
          .order('booking_date', { ascending: true })
          .order('start_time', { ascending: true });
        setBookings(bookingsData || []);

        // Bloqueos
        const { data: blocksData } = await supabase
          .from('blocked_times')
          .select('*')
          .in('court_id', courtIds);
        setBlockedTimes(blocksData || []);
        
        if (courtsList[0]) {
          setBlockForm(prev => ({ ...prev, courtId: courtsList[0].id }));
        }
      }

      const { data: customersData } = await supabase
        .from('customers')
        .select('*')
        .eq('club_id', clubData.id)
        .order('last_booking_date', { ascending: false });
      setCustomers(customersData || []);

    } catch (error) {
      console.error('Error cargando el dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };

  const handleCancelBooking = async (bookingId: string) => {
    if (!window.confirm('¿Estás seguro de cancelar este turno?')) return;
    const { error } = await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', bookingId);
    if (!error) loadDashboardData();
  };

  const generateWhatsAppMessage = () => {
    let text = `🎾 *¡Turnos disponibles en ${club?.name}!* 🎾%0A%0A`;
    text += `👉 Reserva rápido ingresando a nuestra web:%0A`;
    text += `http://localhost:5173/ %0A%0A`;
    text += `¡Los esperamos!`;
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from('clubs').update({ 
      name: club.name,
      manager_name: club.manager_name,
      location: club.location,
      opening_days: club.opening_days,
      opening_hours: club.opening_hours,
      admin_phone: phoneForm 
    }).eq('id', club.id);
    if (error) alert('Error al guardar la configuración');
    else alert('Configuración actualizada correctamente.');
  };

  const handleAddBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from('blocked_times').insert([{
      court_id: blockForm.courtId,
      day_of_week: blockForm.dayOfWeek,
      start_time: blockForm.startTime,
      end_time: blockForm.endTime,
      description: blockForm.description
    }]);
    if (error) alert('Error al crear bloqueo');
    else {
      alert('Bloqueo registrado.');
      loadDashboardData();
    }
  };

  const handleDeleteBlock = async (id: string) => {
    if(!window.confirm('¿Eliminar este bloqueo?')) return;
    await supabase.from('blocked_times').delete().eq('id', id);
    loadDashboardData();
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center">Cargando panel...</div>;

  const getDayName = (num: number) => ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][num];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white shadow-sm border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold text-slate-900">{club?.name}</h1>
            <p className="text-sm text-slate-500">Panel de Administración</p>
          </div>
          <div className="flex gap-4">
            <button onClick={generateWhatsAppMessage} className="flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-md font-medium text-sm">
              <Share2 className="h-4 w-4" /> Compartir
            </button>
            <button onClick={handleLogout} className="flex items-center gap-2 text-slate-500 hover:text-red-600 font-medium text-sm">
              <LogOut className="h-4 w-4" /> Salir
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        
        {/* Tabs */}
        <div className="flex flex-wrap gap-2 bg-slate-200 p-1 rounded-lg w-fit mb-8">
          {[
            { id: 'turnos', label: 'Turnos', icon: Calendar },
            { id: 'clientes', label: 'Clientes', icon: Users },
            { id: 'bloqueos', label: 'Clases / Bloqueos', icon: Ban },
            { id: 'config', label: 'Configuración', icon: Settings },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-300'
              }`}
            >
              <tab.icon className="h-4 w-4" /> {tab.label}
            </button>
          ))}
        </div>

        {/* CONTENIDO: Turnos */}
        {activeTab === 'turnos' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-200"><h2 className="text-lg font-semibold">Próximos Turnos</h2></div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-500 text-sm border-b">
                  <tr>
                    <th className="p-4 font-medium">Fecha</th>
                    <th className="p-4 font-medium">Horario</th>
                    <th className="p-4 font-medium">Cancha</th>
                    <th className="p-4 font-medium">Titular</th>
                    <th className="p-4 font-medium">Teléfono</th>
                    <th className="p-4 font-medium">Estado</th>
                    <th className="p-4 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => {
                    const [y, m, d] = b.booking_date.split('-');
                    return (
                      <tr key={b.id} className="border-b last:border-0 hover:bg-slate-50">
                        <td className="p-4 text-sm font-medium">{`${d}/${m}/${y}`}</td>
                        <td className="p-4 text-sm">{b.start_time.slice(0,5)} - {b.end_time.slice(0,5)}</td>
                        <td className="p-4 text-sm">{courts.find(c => c.id === b.court_id)?.name}</td>
                        <td className="p-4 text-sm font-medium">{b.customer_name}</td>
                        <td className="p-4 text-sm">{b.customer_phone}</td>
                        <td className="p-4 text-sm">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${b.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {b.status === 'confirmed' ? 'Confirmado' : 'Cancelado'}
                          </span>
                        </td>
                        <td className="p-4 text-sm">
                          {b.status === 'confirmed' && (
                            <button onClick={() => handleCancelBooking(b.id)} className="text-red-500 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* CONTENIDO: Clases y Bloqueos */}
        {activeTab === 'bloqueos' && (
          <div className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-1 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <h2 className="text-lg font-semibold mb-4">Nuevo Bloqueo (Clase)</h2>
              <form onSubmit={handleAddBlock} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Cancha</label>
                  <select className="w-full border rounded-md p-2" value={blockForm.courtId} onChange={e=>setBlockForm({...blockForm, courtId: e.target.value})}>
                    {courts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Día de la semana</label>
                  <select className="w-full border rounded-md p-2" value={blockForm.dayOfWeek} onChange={e=>setBlockForm({...blockForm, dayOfWeek: parseInt(e.target.value)})}>
                    {[1,2,3,4,5,6,0].map(d => <option key={d} value={d}>{getDayName(d)}</option>)}
                  </select>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1"><label className="block text-sm font-medium mb-1">Inicio</label><input type="time" required className="w-full border rounded-md p-2" value={blockForm.startTime} onChange={e=>setBlockForm({...blockForm, startTime: e.target.value})}/></div>
                  <div className="flex-1"><label className="block text-sm font-medium mb-1">Fin</label><input type="time" required className="w-full border rounded-md p-2" value={blockForm.endTime} onChange={e=>setBlockForm({...blockForm, endTime: e.target.value})}/></div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Descripción</label>
                  <input type="text" className="w-full border rounded-md p-2" value={blockForm.description} onChange={e=>setBlockForm({...blockForm, description: e.target.value})} placeholder="Ej: Clase Escuelita" />
                </div>
                <button type="submit" className="w-full bg-primary text-white py-2 rounded-md font-medium">Guardar Bloqueo</button>
              </form>
            </div>
            
            <div className="md:col-span-2 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-6 border-b"><h2 className="text-lg font-semibold">Bloqueos Activos</h2></div>
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500">
                  <tr><th className="p-4">Día</th><th className="p-4">Horario</th><th className="p-4">Cancha</th><th className="p-4">Descripción</th><th className="p-4">Quitar</th></tr>
                </thead>
                <tbody>
                  {blockedTimes.map(bt => (
                    <tr key={bt.id} className="border-b hover:bg-slate-50">
                      <td className="p-4 font-medium">{getDayName(bt.day_of_week)}</td>
                      <td className="p-4">{bt.start_time.slice(0,5)} - {bt.end_time.slice(0,5)}</td>
                      <td className="p-4">{courts.find(c=>c.id === bt.court_id)?.name}</td>
                      <td className="p-4">{bt.description}</td>
                      <td className="p-4"><button onClick={()=>handleDeleteBlock(bt.id)} className="text-red-500"><Trash2 className="h-4 w-4"/></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* CONTENIDO: Configuración */}
        {activeTab === 'config' && (
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
              <h2 className="text-lg font-semibold mb-4">Datos del Complejo</h2>
              <form onSubmit={handleSaveConfig} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Nombre del Complejo</label>
                  <input type="text" required className="w-full border rounded-md p-2 focus:border-primary outline-none" value={club.name} onChange={e => setClub({...club, name: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Nombre del Encargado</label>
                  <input type="text" className="w-full border rounded-md p-2 focus:border-primary outline-none" value={club.manager_name || ''} onChange={e => setClub({...club, manager_name: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Ubicación</label>
                  <input type="text" className="w-full border rounded-md p-2 focus:border-primary outline-none" value={club.location || ''} onChange={e => setClub({...club, location: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Días de Apertura</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-slate-50 p-4 border rounded-md">
                    {[
                      { id: 1, label: 'Lunes' }, { id: 2, label: 'Martes' }, { id: 3, label: 'Miércoles' },
                      { id: 4, label: 'Jueves' }, { id: 5, label: 'Viernes' }, { id: 6, label: 'Sábado' }, { id: 0, label: 'Domingo' }
                    ].map(day => {
                      const selectedDays = (club.opening_days || '').split(',').map(Number);
                      const isChecked = selectedDays.includes(day.id);
                      return (
                        <label key={day.id} className="flex items-center gap-2 cursor-pointer">
                          <input 
                            type="checkbox" 
                            className="rounded text-primary focus:ring-primary w-4 h-4"
                            checked={isChecked}
                            onChange={(e) => {
                              const newDays = e.target.checked 
                                ? [...selectedDays, day.id] 
                                : selectedDays.filter(d => d !== day.id);
                              setClub({...club, opening_days: newDays.join(',')});
                            }}
                          />
                          <span className="text-sm text-slate-700">{day.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Horario de Apertura y Cierre (Ej: 08:00 - 00:00)</label>
                  <input type="text" className="w-full border rounded-md p-2 focus:border-primary outline-none" value={club.opening_hours || ''} onChange={e => setClub({...club, opening_hours: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Teléfono para Avisos (WhatsApp)</label>
                  <input type="tel" required className="w-full border rounded-md p-2 focus:border-primary outline-none" value={phoneForm} onChange={e=>setPhoneForm(e.target.value)} />
                </div>
                <button type="submit" className="w-full bg-primary text-white py-2 rounded-md font-medium hover:bg-primary-hover">Guardar Cambios Generales</button>
              </form>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 h-fit">
              <h2 className="text-lg font-semibold mb-4">Gestión de Canchas</h2>
              <p className="text-sm text-slate-500 mb-4">Apaga el interruptor si una cancha está en refacción para que no aparezca en la vista pública.</p>
              <div className="space-y-3">
                {courts.map(c => (
                  <div key={c.id} className="flex items-center justify-between p-3 border rounded-lg bg-slate-50">
                    <span className="font-medium text-slate-700">{c.name}</span>
                    <button 
                      onClick={async () => {
                        const newStatus = c.is_active === false ? true : false;
                        await supabase.from('courts').update({ is_active: newStatus }).eq('id', c.id);
                        loadDashboardData();
                      }}
                      className={`px-4 py-1.5 rounded-full text-xs font-bold transition-colors ${
                        c.is_active !== false ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'
                      }`}
                    >
                      {c.is_active !== false ? '✅ Activa' : '🛠️ En Reparación'}
                    </button>
                  </div>
                ))}
                
                <button 
                  type="button"
                  onClick={async () => {
                    const newName = window.prompt("Ingresa el nombre de la nueva cancha (Ej: Cancha 3):");
                    if (newName && newName.trim()) {
                      await supabase.from('courts').insert([{ club_id: club.id, name: newName.trim() }]);
                      loadDashboardData();
                    }
                  }}
                  className="w-full mt-4 bg-slate-100 text-slate-700 border border-slate-300 border-dashed py-2 rounded-md font-medium hover:bg-slate-200"
                >
                  + Agregar Nueva Cancha
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Clientes... */}
        {activeTab === 'clientes' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-200"><h2 className="text-lg font-semibold">Directorio de Clientes</h2></div>
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-slate-500 text-sm">
                <tr><th className="p-4">Nombre</th><th className="p-4">WhatsApp</th><th className="p-4">Última Reserva</th></tr>
              </thead>
              <tbody>
                {customers.map(c => (
                  <tr key={c.id} className="border-b hover:bg-slate-50 text-sm">
                    <td className="p-4 font-medium">{c.name}</td>
                    <td className="p-4"><a href={`https://wa.me/${c.phone}`} target="_blank" rel="noreferrer" className="text-green-600">{c.phone}</a></td>
                    <td className="p-4">{c.last_booking_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </main>
    </div>
  );
}
