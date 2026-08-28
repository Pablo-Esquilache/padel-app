import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { ArrowLeft, Calendar, AlertTriangle } from 'lucide-react';

export default function ClubBooking() {
  const { id } = useParams();
  const [club, setClub] = useState<any>(null);
  const [courts, setCourts] = useState<any[]>([]);
  const [existingBookings, setExistingBookings] = useState<any[]>([]);
  const [blockedTimes, setBlockedTimes] = useState<any[]>([]);
  
  // Helpers para fechas y horas locales
  const getLocalDateString = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const getCurrentTime = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const [selectedDate, setSelectedDate] = useState(() => getLocalDateString());
  
  // Modal states
  const [selectedSlot, setSelectedSlot] = useState<any>(null);
  const [selectedCourt, setSelectedCourt] = useState<any>(null);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [bookingToCancel, setBookingToCancel] = useState<any>(null);

  const [formData, setFormData] = useState({ name: '', phone: '', matchType: 'Masculino' });
  const [cancelData, setCancelData] = useState({ name: '', phone: '' });
  
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (id) loadClubData();
  }, [id]);

  useEffect(() => {
    if (courts.length > 0) loadBookings();
  }, [selectedDate, courts]);

  const loadClubData = async () => {
    const { data: clubData } = await supabase.from('clubs').select('*').eq('id', id).single();
    if (clubData) setClub(clubData);

    const { data: courtsData } = await supabase.from('courts').select('*').eq('club_id', id);
    if (courtsData) {
      setCourts(courtsData);
      const courtIds = courtsData.map((c: any) => c.id);
      const { data: blocks } = await supabase.from('blocked_times').select('*').in('court_id', courtIds);
      if (blocks) setBlockedTimes(blocks);
    }
  };

  const loadBookings = async () => {
    const courtIds = courts.map(c => c.id);
    const { data } = await supabase
      .from('bookings')
      .select('*')
      .eq('booking_date', selectedDate)
      .eq('status', 'confirmed')
      .in('court_id', courtIds);
    setExistingBookings(data || []);
  };

  const toMins = (timeStr: string) => {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  };

  const formatMins = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${(h === 24 ? 0 : h).toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };

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
        return bS < slotEndMin && bE > currentMin;
      });

      if (overlappingBlock) {
        slots.push({
          start: overlappingBlock.start_time.slice(0,5),
          end: overlappingBlock.end_time.slice(0,5),
          isBlocked: true,
          desc: overlappingBlock.description
        });
        currentMin = toMins(overlappingBlock.end_time);
      } else {
        slots.push({
          start: formatMins(currentMin),
          end: formatMins(slotEndMin),
          isBlocked: false,
          desc: ''
        });
        currentMin = slotEndMin;
      }
    }
    return slots;
  };

  const handleSlotClick = (court: any, slot: any) => {
    const booking = existingBookings.find(b => b.court_id === court.id && b.start_time.startsWith(slot.start));
    
    if (booking) {
      setBookingToCancel(booking);
      setCancelData({ name: '', phone: '' });
      setShowCancelModal(true);
    } else {
      setSelectedCourt(court);
      setSelectedSlot(slot);
      setFormData({ name: '', phone: '', matchType: 'Masculino' });
      setSuccessMsg('');
      setShowBookingModal(true);
    }
  };

  const handleConfirmBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Generamos un código al azar para que la base de datos no tire error 409 por el UNIQUE constraint
      const dummyCode = Math.random().toString(36).substring(2, 10).toUpperCase();

      const { error } = await supabase.from('bookings').insert([{
        court_id: selectedCourt.id,
        booking_date: selectedDate,
        start_time: selectedSlot.start,
        end_time: selectedSlot.end,
        customer_name: formData.name.trim(),
        customer_phone: formData.phone.trim(),
        match_type: formData.matchType,
        cancellation_code: dummyCode,
        status: 'confirmed'
      }]);
      
      if (error) {
        console.error("Booking error:", error);
        throw error;
      }

      // Intentar guardar en clientes, puede fallar por permisos pero no importa
      supabase.from('customers').upsert([{
        club_id: club.id, 
        name: formData.name.trim(), 
        phone: formData.phone.trim(), 
        last_booking_date: selectedDate
      }], { onConflict: 'club_id,phone' }).then(() => {});

      setSuccessMsg('¡Turno reservado exitosamente!');
      loadBookings();
    } catch (err) {
      alert('Error al reservar. Puede que el turno ya esté ocupado o haya un conflicto en la base de datos.');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const validName = bookingToCancel.customer_name.trim().toLowerCase() === cancelData.name.trim().toLowerCase();
    const validPhone = bookingToCancel.customer_phone.trim() === cancelData.phone.trim();
    if (!validName || !validPhone) {
      alert('Los datos no coinciden con los del titular de la reserva.');
      setLoading(false);
      return;
    }
    try {
      await supabase.from('bookings').update({ status: 'cancelled' }).eq('id', bookingToCancel.id);
      setShowCancelModal(false);
      alert('Reserva cancelada exitosamente.');
      loadBookings();
    } catch (err) {
      alert('Error al cancelar');
    } finally {
      setLoading(false);
    }
  };

  if (!club) return <div className="p-8 text-center">Cargando complejo...</div>;

  const isToday = selectedDate === getLocalDateString();
  const currentLocalTime = getCurrentTime();

  // Filtramos las canchas para que solo se muestren las activas
  const activeCourts = courts.filter(c => c.is_active !== false);

  return (
    <div className="min-h-screen bg-slate-300/50 backdrop-blur-sm flex flex-col items-center py-8 px-4">
      
      {/* Contenedor Principal (Tarjeta del 75%) */}
      <div className="w-full max-w-5xl bg-slate-50 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        
        <header className="bg-white shadow-sm border-b border-slate-200">
          <div className="px-6 py-4 flex items-center">
            <Link to="/" className="text-slate-500 hover:text-slate-900 mr-4"><ArrowLeft className="h-5 w-5" /></Link>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{club.name}</h1>
              <p className="text-sm text-slate-500">{club.location} • Horario: {club.opening_hours}</p>
            </div>
          </div>
        </header>

        <main className="w-full p-6 flex-1">
          <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-8 flex flex-col sm:flex-row items-center gap-4">
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <Calendar className="text-primary h-6 w-6" />
              <span className="font-medium text-slate-700">Elige la fecha:</span>
            </div>
            <input 
              type="date" 
              className="w-full sm:w-auto rounded-md border border-slate-300 focus:border-primary focus:ring-primary p-2 outline-none"
              value={selectedDate}
              min={getLocalDateString()}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>

          {club && (() => {
            const dayOfWeek = new Date(selectedDate + 'T12:00:00').getDay();
            const openDays = (club.opening_days || '1,2,3,4,5,6,0').split(',').map(Number);
            
            if (!openDays.includes(dayOfWeek)) {
              return (
                <div className="bg-white p-8 rounded-xl shadow-sm border border-slate-200 text-center">
                  <div className="text-4xl mb-2">😴</div>
                  <h2 className="text-xl font-bold text-slate-800">El complejo está cerrado hoy</h2>
                  <p className="text-slate-500">Por favor, elige otra fecha en el calendario.</p>
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
                          const booking = existingBookings.find(b => b.court_id === court.id && b.start_time.startsWith(slot.start));
                          
                          // Bloqueo por horario vencido
                          const isPast = isToday && currentLocalTime > slot.start;
                          const isDisabled = slot.isBlocked || isPast;

                          if (isDisabled) {
                            let label = slot.desc || 'Clase';
                            if (isPast && !slot.isBlocked) label = 'Horario Vencido';

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
                              onClick={() => handleSlotClick(court, slot)}
                              className={`w-full py-3 px-3 rounded-lg border transition-all flex justify-between items-center ${
                                booking 
                                  ? 'bg-red-50 border-red-200 hover:bg-red-100'
                                  : 'bg-white border-primary/30 hover:border-primary hover:bg-primary/5 hover:shadow-sm'
                              }`}
                            >
                              <div className="text-left">
                                <p className={`font-bold text-lg ${booking ? 'text-red-800' : 'text-slate-800'}`}>{slot.start}</p>
                                <p className={`text-xs ${booking ? 'text-red-500' : 'text-slate-500'}`}>a {slot.end}</p>
                              </div>
                              <span className={`text-sm font-medium ${booking ? 'text-red-600' : 'text-primary'}`}>
                                {booking ? 'Ocupado' : 'Libre'}
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
        </main>
      </div>

      {/* Modal de Reserva */}
      {showBookingModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            {!successMsg ? (
              <>
                <h2 className="text-2xl font-bold mb-1">Confirmar Turno</h2>
                <p className="text-slate-600 mb-6">{selectedCourt?.name} • {selectedSlot?.start} hs</p>
                <form onSubmit={handleConfirmBooking} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Nombre y Apellido</label>
                    <input type="text" required className="w-full rounded-md border p-2 outline-none focus:border-primary" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Teléfono (WhatsApp)</label>
                    <input type="tel" required className="w-full rounded-md border p-2 outline-none focus:border-primary" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Tipo de Partido</label>
                    <select className="w-full rounded-md border p-2 outline-none focus:border-primary bg-white" value={formData.matchType} onChange={e => setFormData({...formData, matchType: e.target.value})}>
                      <option>Masculino</option><option>Femenino</option><option>Mixto</option>
                    </select>
                  </div>
                  <div className="pt-4 flex gap-3">
                    <button type="button" onClick={() => setShowBookingModal(false)} className="flex-1 bg-slate-100 py-2 rounded-md font-medium hover:bg-slate-200">Cancelar</button>
                    <button type="submit" disabled={loading} className="flex-1 bg-primary text-white py-2 rounded-md font-medium hover:bg-primary-hover disabled:opacity-50">
                      {loading ? 'Guardando...' : 'Reservar'}
                    </button>
                  </div>
                </form>
              </>
            ) : (
              <div className="text-center py-6">
                <div className="text-5xl mb-4">✅</div>
                <h2 className="text-2xl font-bold mb-2">{successMsg}</h2>
                <p className="text-slate-600 mb-6">Te esperamos el {selectedDate} a las {selectedSlot?.start} hs.</p>
                <button onClick={() => setShowBookingModal(false)} className="w-full bg-primary text-white py-3 rounded-md font-medium">Volver a la grilla</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal de Cancelación */}
      {showCancelModal && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border-t-4 border-red-500">
            <div className="flex items-center gap-2 mb-2 text-red-600">
              <AlertTriangle className="h-6 w-6" />
              <h2 className="text-xl font-bold">Cancelar Reserva</h2>
            </div>
            <p className="text-slate-600 mb-6 text-sm">
              Para liberar este turno, ingresa los datos de la reserva original.
            </p>
            <form onSubmit={handleCancelBooking} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Nombre registrado</label>
                <input type="text" required className="w-full rounded-md border p-2 outline-none focus:border-red-500" value={cancelData.name} onChange={e => setCancelData({...cancelData, name: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Teléfono registrado</label>
                <input type="tel" required className="w-full rounded-md border p-2 outline-none focus:border-red-500" value={cancelData.phone} onChange={e => setCancelData({...cancelData, phone: e.target.value})} />
              </div>
              <div className="pt-4 flex gap-3">
                <button type="button" onClick={() => setShowCancelModal(false)} className="flex-1 bg-slate-100 py-2 rounded-md font-medium hover:bg-slate-200">Volver</button>
                <button type="submit" disabled={loading} className="flex-1 bg-red-600 text-white py-2 rounded-md font-medium hover:bg-red-700 disabled:opacity-50">
                  {loading ? 'Verificando...' : 'Liberar Cancha'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
