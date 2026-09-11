import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { LogOut, Calendar, Users, Share2, Trash2, Settings, Ban, PlusCircle } from 'lucide-react';

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'turnos' | 'agendar' | 'clientes' | 'bloqueos' | 'config'>('turnos');
  
  const [club, setClub] = useState<any>(null);
  const [courts, setCourts] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [blockedTimes, setBlockedTimes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // States para Formularios
  const [phoneForm, setPhoneForm] = useState('');
  
  // States para Agendar Turno (Admin)
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [selectedSlot, setSelectedSlot] = useState<any>(null);
  const [selectedCourt, setSelectedCourt] = useState<any>(null);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [adminFormData, setAdminFormData] = useState({ name: '', phone: '', matchType: 'Masculino' });
  const [adminSuccessMsg, setAdminSuccessMsg] = useState('');
  const [adminLoading, setAdminLoading] = useState(false);

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
      
      // Suscribirse a cambios en tiempo real en la tabla bookings para el Dashboard
      const channel = supabase
        .channel('admin-bookings-changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'bookings' },
          (payload) => {
            console.log('Cambio detectado en turnos (admin):', payload);
            loadDashboardData();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
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
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const currentTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const dayOfWeek = d.getDay();
    
    let text = `🎾 *¡Turnos disponibles para HOY en ${club?.name}!* 🎾%0A%0A`;
    let hayTurnos = false;

    const toMins = (timeStr: string) => {
      const [h, m] = timeStr.split(':').map(Number);
      return h * 60 + m;
    };
    const formatMins = (mins: number) => {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${(h === 24 ? 0 : h).toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    };

    courts.forEach(court => {
      const blocks = blockedTimes.filter(b => b.court_id === court.id && b.day_of_week === dayOfWeek);
      const courtBookings = bookings.filter(b => b.court_id === court.id && b.booking_date === today);
      
      let startH = 8, endH = 24;
      try {
        const parts = (club?.opening_hours || '').split('-');
        if (parts.length === 2) {
          startH = parseInt(parts[0].trim().split(':')[0]) || 8;
          let eH = parseInt(parts[1].trim().split(':')[0]) || 24;
          if (eH === 0) eH = 24;
          endH = eH;
        }
      } catch (e) {}

      let currentMin = startH * 60;
      const endMin = endH * 60;
      let freeSlots: string[] = [];

      while (currentMin + 90 <= endMin) {
        const slotEndMin = currentMin + 90;
        const overlappingBlock = blocks.find(b => {
          return toMins(b.start_time) < slotEndMin && toMins(b.end_time) > currentMin;
        });

        if (overlappingBlock) {
          currentMin = toMins(overlappingBlock.end_time);
        } else {
          const startStr = formatMins(currentMin);
          const isBooked = courtBookings.some(b => b.start_time.startsWith(startStr));
          const isPast = currentMin <= toMins(currentTime);
          
          if (!isBooked && !isPast) {
            freeSlots.push(startStr);
          }
          currentMin = slotEndMin;
        }
      }
      
      if (freeSlots.length > 0) {
        hayTurnos = true;
        text += `*${court.name}:* ${freeSlots.join(', ')}%0A`;
      }
    });

    if (!hayTurnos) {
      text += `_¡Ya estamos llenos por hoy!_ 😱%0A%0A`;
    } else {
      text += `%0A`;
    }

    // Usamos el origin real (localhost o netlify)
    const publicUrl = `${window.location.origin}/club/${club?.id}`;
    text += `👉 *Reserva online acá:*%0A${publicUrl}%0A%0A`;
    if (club?.bot_phone) {
      text += `\n💬 *O háblale a nuestro Bot:*\nwa.me/${club.bot_phone}`;
    }
    
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.from('clubs').update({ 
      name: club.name,
      manager_name: club.manager_name,
      location: club.location,
      opening_days: club.opening_days,
      opening_hours: club.opening_hours,
      admin_phone: phoneForm,
      bot_phone: club.bot_phone
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

  const toMins = (t: string) => parseInt(t.split(':')[0]) * 60 + parseInt(t.split(':')[1]);
  const formatMins = (m: number) => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;

  const getSlotsForCourt = (courtId: string) => {
    if (!club) return [];
    const dayOfWeek = new Date(selectedDate + 'T12:00:00').getDay();
    const blocks = blockedTimes.filter(b => b.court_id === courtId && b.day_of_week === dayOfWeek);
    
    let startH = 8, endH = 24;
    try {
      const parts = (club.opening_hours || '').split('-');
      if (parts.length === 2) {
        startH = parseInt(parts[0].trim().split(':')[0]) || 8;
        let eH = parseInt(parts[1].trim().split(':')[0]) || 24;
        if (eH === 0) eH = 24;
        endH = eH;
      }
    } catch (e) {}

    let currentMin = startH * 60;
    const endMin = endH * 60;
    const slots = [];

    while (currentMin + 90 <= endMin) {
      const slotEndMin = currentMin + 90;
      const overlappingBlock = blocks.find(b => {
        const bS = toMins(b.start_time);
        const bE = toMins(b.end_time);
        return (currentMin < bE && slotEndMin > bS);
      });

      if (overlappingBlock) {
        slots.push({ start: formatMins(currentMin), end: overlappingBlock.end_time, isBlocked: true, desc: overlappingBlock.description });
        currentMin = toMins(overlappingBlock.end_time);
      } else {
        slots.push({ start: formatMins(currentMin), end: formatMins(slotEndMin), isBlocked: false, desc: '' });
        currentMin = slotEndMin;
      }
    }
    return slots;
  };

  const handleAdminSlotClick = (court: any, slot: any) => {
    setSelectedCourt(court);
    setSelectedSlot(slot);
    setAdminFormData({ name: '', phone: '', matchType: 'Masculino' });
    setAdminSuccessMsg('');
    setShowBookingModal(true);
  };

  const adminHandleConfirmBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminLoading(true);
    try {
      const dummyCode = Math.random().toString(36).substring(2, 10).toUpperCase();
      const { error } = await supabase.from('bookings').insert([{
        court_id: selectedCourt.id,
        booking_date: selectedDate,
        start_time: selectedSlot.start,
        end_time: selectedSlot.end,
        customer_name: adminFormData.name.trim(),
        customer_phone: adminFormData.phone.trim(),
        match_type: adminFormData.matchType,
        cancellation_code: dummyCode,
        status: 'confirmed'
      }]);
      if (error) throw error;
      
      supabase.from('customers').upsert([{ club_id: club.id, name: adminFormData.name.trim(), phone: adminFormData.phone.trim(), last_booking_date: selectedDate }], { onConflict: 'club_id,phone' }).then(() => {});
      
      setAdminSuccessMsg('Turno registrado correctamente');
      loadDashboardData();
    } catch (err) {
      alert('Error al reservar. Puede que el turno ya esté ocupado.');
    } finally {
      setAdminLoading(false);
    }
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
            { id: 'agendar', label: 'Agendar Turno', icon: PlusCircle },
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
                    <th className="p-4 font-medium">Tipo</th>
                    <th className="p-4 font-medium">Estado</th>
                    <th className="p-4 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => {
                    const [y, m, d] = b.booking_date.split('-');
                    const isPast = new Date(`${b.booking_date}T${b.start_time}`) < new Date();
                    
                    return (
                      <tr key={b.id} className={`border-b last:border-0 hover:bg-slate-50 ${isPast && b.status === 'confirmed' ? 'opacity-50 grayscale bg-slate-50' : ''}`}>
                        <td className="p-4 text-sm font-medium">{`${d}/${m}/${y}`}</td>
                        <td className="p-4 text-sm">{b.start_time.slice(0,5)} - {b.end_time.slice(0,5)}</td>
                        <td className="p-4 text-sm">{courts.find(c => c.id === b.court_id)?.name}</td>
                        <td className="p-4 text-sm font-medium">{b.customer_name}</td>
                        <td className="p-4 text-sm">{b.customer_phone}</td>
                        <td className="p-4 text-sm">{b.match_type}</td>
                        <td className="p-4 text-sm">
                          {b.status === 'cancelled' ? (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">Cancelado</span>
                          ) : isPast ? (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-slate-200 text-slate-700">Finalizado</span>
                          ) : (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">Confirmado</span>
                          )}
                        </td>
                        <td className="p-4 text-sm">
                          {b.status === 'confirmed' && !isPast && (
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

        {/* CONTENIDO: Agendar Turno */}
        {activeTab === 'agendar' && (
          <div className="space-y-6">
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 flex flex-col sm:flex-row items-center gap-4">
              <div className="flex items-center gap-3 w-full sm:w-auto">
                <Calendar className="text-primary h-6 w-6" />
                <span className="font-medium text-slate-700">Elige la fecha:</span>
              </div>
              <input 
                type="date" 
                className="w-full sm:w-auto rounded-md border border-slate-300 focus:border-primary focus:ring-primary p-2 outline-none"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
              />
            </div>

            {club && (() => {
              const dayOfWeek = new Date(selectedDate + 'T12:00:00').getDay();
              const openDays = (club.opening_days || '1,2,3,4,5,6,0').split(',').map(Number);
              
              if (!openDays.includes(dayOfWeek)) {
                return (
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
                    <h3 className="text-xl font-bold text-slate-700 mb-2">Complejo Cerrado</h3>
                    <p className="text-slate-500">No abrimos los {getDayName(dayOfWeek)}s.</p>
                  </div>
                );
              }

              const activeCourts = courts.filter(c => c.is_active !== false);

              if (activeCourts.length === 0) {
                return (
                  <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
                    <h3 className="text-xl font-bold text-slate-700 mb-2">Sin canchas disponibles</h3>
                    <p className="text-slate-500">No hay canchas activas en este momento.</p>
                  </div>
                );
              }

              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {activeCourts.map(court => {
                    const slots = getSlotsForCourt(court.id);
                    return (
                      <div key={court.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                        <div className="bg-slate-100 p-4 border-b border-slate-200 text-center">
                          <h2 className="font-bold text-slate-800">{court.name}</h2>
                        </div>
                        <div className="p-4 flex flex-col gap-3">
                          {slots.length === 0 && <p className="text-sm text-slate-500 text-center">Sin horarios.</p>}
                          
                          {slots.map((slot, idx) => {
                            const booking = bookings.find(b => b.court_id === court.id && b.booking_date === selectedDate && b.start_time.startsWith(slot.start));
                            const isPast = new Date(`${selectedDate}T${slot.start}`) < new Date();

                            if (slot.isBlocked || isPast) {
                              let label = slot.desc || 'Clase / Bloqueado';
                              if (isPast && !slot.isBlocked) label = 'Horario Pasado';

                              return (
                                <div key={idx} className="w-full py-3 px-3 rounded-lg border bg-slate-200 border-slate-300 flex justify-between items-center opacity-70">
                                  <div className="text-left">
                                    <p className="font-bold text-slate-700 text-lg">{slot.start}</p>
                                    <p className="text-xs text-slate-500">a {slot.end}</p>
                                  </div>
                                  <span className="text-sm font-medium text-slate-600 truncate max-w-[100px]">{label}</span>
                                </div>
                              );
                            }

                            return (
                              <button
                                key={idx}
                                onClick={() => {
                                  if (!booking) handleAdminSlotClick(court, slot);
                                }}
                                className={`w-full py-3 px-3 rounded-lg border transition-all flex justify-between items-center ${
                                  booking 
                                    ? 'bg-red-50 border-red-200 cursor-default'
                                    : 'bg-white border-primary/30 hover:border-primary hover:bg-primary/5 hover:shadow-sm'
                                }`}
                              >
                                <div className="text-left">
                                  <p className={`font-bold text-lg ${booking ? 'text-red-800' : 'text-slate-800'}`}>{slot.start}</p>
                                  <p className={`text-xs ${booking ? 'text-red-500' : 'text-slate-500'}`}>a {slot.end}</p>
                                </div>
                                <span className={`text-sm font-medium ${booking ? 'text-red-600' : 'text-primary'}`}>
                                  {booking ? (booking.status === 'cancelled' ? 'Cancelado' : 'Ocupado') : 'Libre'}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
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
                                : selectedDays.filter((d: number) => d !== day.id);
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
                  <label className="block text-sm font-medium mb-1">Teléfono Personal del Administrador (Para Recibir Avisos)</label>
                  <input type="tel" required className="w-full border rounded-md p-2 focus:border-primary outline-none" value={phoneForm} onChange={e=>setPhoneForm(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Teléfono Público del Bot (Para que chateen los clientes)</label>
                  <input type="tel" placeholder="Ej: 5491123456789" className="w-full border rounded-md p-2 focus:border-primary outline-none" value={club.bot_phone || ''} onChange={e => setClub({...club, bot_phone: e.target.value})} />
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

        {/* Modal de Reserva (Admin) */}
        {showBookingModal && (
          <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
              {!adminSuccessMsg ? (
                <>
                  <h2 className="text-2xl font-bold mb-1">Agendar Turno Manual</h2>
                  <p className="text-slate-600 mb-6">{selectedCourt?.name} • {selectedSlot?.start} hs</p>
                  <form onSubmit={adminHandleConfirmBooking} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">Nombre y Apellido</label>
                      <input type="text" required className="w-full rounded-md border p-2 outline-none focus:border-primary" value={adminFormData.name} onChange={e => setAdminFormData({...adminFormData, name: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Teléfono (WhatsApp)</label>
                      <input type="tel" required className="w-full rounded-md border p-2 outline-none focus:border-primary" value={adminFormData.phone} onChange={e => setAdminFormData({...adminFormData, phone: e.target.value})} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">Tipo de Partido</label>
                      <select className="w-full rounded-md border p-2 outline-none focus:border-primary bg-white" value={adminFormData.matchType} onChange={e => setAdminFormData({...adminFormData, matchType: e.target.value})}>
                        <option>Masculino</option><option>Femenino</option><option>Mixto</option>
                      </select>
                    </div>
                    <div className="pt-4 flex gap-3">
                      <button type="button" onClick={() => setShowBookingModal(false)} className="flex-1 bg-slate-100 py-2 rounded-md font-medium hover:bg-slate-200">Cancelar</button>
                      <button type="submit" disabled={adminLoading} className="flex-1 bg-primary text-white py-2 rounded-md font-medium hover:bg-primary-hover disabled:opacity-50">
                        {adminLoading ? 'Guardando...' : 'Reservar'}
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <div className="text-center py-6">
                  <div className="text-5xl mb-4">✅</div>
                  <h2 className="text-2xl font-bold mb-2">{adminSuccessMsg}</h2>
                  <p className="text-slate-600 mb-6">El turno quedó agendado para el {selectedDate} a las {selectedSlot?.start} hs.</p>
                  <button onClick={() => setShowBookingModal(false)} className="w-full bg-primary text-white py-3 rounded-md font-medium">Volver a la grilla</button>
                </div>
              )}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
