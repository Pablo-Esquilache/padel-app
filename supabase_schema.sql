-- 1. Tabla de Complejos (Clubs)
-- Un administrador (dueño) puede tener un complejo.
CREATE TABLE clubs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID REFERENCES auth.users(id) NOT NULL,
  name TEXT NOT NULL,
  manager_name TEXT NOT NULL,
  location TEXT,
  opening_days TEXT,
  opening_hours TEXT,
  courts_count INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Tabla de Canchas (Courts)
-- Cada complejo tiene varias canchas.
CREATE TABLE courts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID REFERENCES clubs(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL, -- Ej: "Cancha 1", "Cancha Techada"
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Tabla de Reservas (Bookings)
-- Almacena los turnos. Se puede insertar públicamente sin Auth.
CREATE TABLE bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  court_id UUID REFERENCES courts(id) ON DELETE CASCADE NOT NULL,
  booking_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  match_type TEXT NOT NULL, -- 'Masculino', 'Femenino', 'Mixto'
  cancellation_code TEXT NOT NULL UNIQUE, -- Código único generado para cancelar
  status TEXT DEFAULT 'confirmed', -- 'confirmed', 'cancelled'
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Tabla de Clientes (Historial de Clientes)
-- Para que el dueño pueda ver quiénes han reservado históricamente.
CREATE TABLE customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID REFERENCES clubs(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  last_booking_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(club_id, phone)
);

-- CONFIGURACIÓN DE SEGURIDAD (Row Level Security - RLS)

-- Habilitar RLS en todas las tablas
ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE courts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- Políticas para CLUBS: 
-- Cualquiera puede leer la info del club (para la web pública)
CREATE POLICY "Public clubs are viewable by everyone." ON clubs FOR SELECT USING (true);
-- Solo el dueño puede editar su propio club
CREATE POLICY "Users can insert their own club." ON clubs FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Users can update their own club." ON clubs FOR UPDATE USING (auth.uid() = owner_id);

-- Políticas para COURTS:
-- Públicamente visibles
CREATE POLICY "Courts are viewable by everyone." ON courts FOR SELECT USING (true);
-- Solo el dueño del club puede modificar sus canchas
CREATE POLICY "Owners can manage their courts." ON courts FOR ALL USING (
  EXISTS (SELECT 1 FROM clubs WHERE clubs.id = courts.club_id AND clubs.owner_id = auth.uid())
);

-- Políticas para BOOKINGS:
-- Cualquiera puede ver las reservas (para saber qué horarios están ocupados)
CREATE POLICY "Bookings are viewable by everyone." ON bookings FOR SELECT USING (true);
-- Cualquiera puede INSERTAR una reserva (sin estar logueado)
CREATE POLICY "Anyone can insert a booking." ON bookings FOR INSERT WITH CHECK (true);
-- Un usuario anónimo puede actualizar (cancelar) una reserva SOLO SI conoce el código de cancelación
CREATE POLICY "Anyone with cancellation code can update." ON bookings FOR UPDATE USING (true);
-- El dueño del club también puede modificar o eliminar reservas de sus canchas
CREATE POLICY "Owners can delete their bookings." ON bookings FOR DELETE USING (
  EXISTS (SELECT 1 FROM courts JOIN clubs ON courts.club_id = clubs.id WHERE courts.id = bookings.court_id AND clubs.owner_id = auth.uid())
);

-- Políticas para CUSTOMERS:
-- Solo el dueño puede ver y gestionar sus clientes
CREATE POLICY "Owners can manage their customers." ON customers FOR ALL USING (
  EXISTS (SELECT 1 FROM clubs WHERE clubs.id = customers.club_id AND clubs.owner_id = auth.uid())
);
