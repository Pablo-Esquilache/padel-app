import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';

export default function Home() {
  const [clubs, setClubs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchClubs = async () => {
      const { data } = await supabase.from('clubs').select('*');
      setClubs(data || []);
      setLoading(false);
    };
    fetchClubs();
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">


      <main className="flex-1 flex flex-col items-center p-4 py-12 text-center">
        <div className="max-w-md w-full">
          <h2 className="text-3xl font-extrabold mb-2 text-slate-900">Reserva tu Cancha</h2>
          <p className="text-slate-600 mb-8">Selecciona el complejo deportivo para ver los turnos disponibles.</p>
          
          {loading ? (
            <p className="text-slate-500">Cargando complejos...</p>
          ) : clubs.length === 0 ? (
            <p className="text-slate-500 bg-white p-6 rounded-xl border border-slate-200">No hay complejos registrados aún.</p>
          ) : (
            <div className="space-y-4">
              {clubs.map((club) => (
                <Link 
                  key={club.id} 
                  to={`/reserva/${club.id}`}
                  className="bg-white p-5 rounded-xl border border-slate-200 flex flex-col items-start hover:border-primary hover:shadow-md transition-all cursor-pointer group text-left block"
                >
                  <h3 className="font-bold text-xl text-slate-900 group-hover:text-primary transition-colors">{club.name}</h3>
                  <div className="flex items-center text-sm text-slate-500 mt-2">
                    <MapPin className="h-4 w-4 mr-1" />
                    {club.location}
                  </div>
                  <div className="mt-4 flex items-center justify-between w-full">
                    <span className="text-xs font-medium bg-slate-100 text-slate-600 px-2 py-1 rounded">
                      {club.courts_count} canchas
                    </span>
                    <span className="text-sm font-medium text-primary bg-primary/10 px-3 py-1 rounded-full group-hover:bg-primary group-hover:text-white transition-colors">
                      Ver Turnos →
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
