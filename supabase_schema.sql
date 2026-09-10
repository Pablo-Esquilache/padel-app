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
  admin_phone TEXT, -- Añadido para notificaciones de WhatsApp
  whatsapp_phone_id TEXT, -- Identificador de Meta para ruteo Multi-Tenant
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

-- CANDADO ANTI DOBLE RESERVA
CREATE UNIQUE INDEX IF NOT EXISTS prevent_double_booking 
ON bookings (court_id, booking_date, start_time) 
WHERE status = 'confirmed';

-- VISTA PÚBLICA DE RESERVAS (Para evitar exponer PII)
CREATE OR REPLACE VIEW bookings_public AS
SELECT id, court_id, booking_date, start_time, end_time, status, match_type
FROM bookings;

-- 4. Tabla de Tiempos Bloqueados (Blocked Times)
CREATE TABLE blocked_times (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  court_id UUID REFERENCES courts(id) ON DELETE CASCADE NOT NULL,
  day_of_week INTEGER NOT NULL, -- 0=Domingo, 1=Lunes, etc.
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Tabla de Historial de Chat (Chat History para IA)
CREATE TABLE chat_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT NOT NULL,
  role TEXT NOT NULL, -- 'user' o 'model'
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. Tabla de Clientes (Historial de Clientes)
CREATE TABLE customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id UUID REFERENCES clubs(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  last_booking_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(club_id, phone)
);

-- FUNCIÓN SEGURA PARA CANCELAR DESDE LA WEB
CREATE OR REPLACE FUNCTION cancel_booking_secure(b_id UUID, c_name TEXT, c_phone TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  found_booking RECORD;
BEGIN
  SELECT * INTO found_booking 
  FROM bookings 
  WHERE id = b_id 
    AND status = 'confirmed' 
    AND lower(trim(customer_name)) = lower(trim(c_name))
    AND trim(customer_phone) = trim(c_phone);
    
  IF FOUND THEN
    UPDATE bookings SET status = 'cancelled' WHERE id = b_id;
    RETURN TRUE;
  ELSE
    RETURN FALSE;
  END IF;
END;
$$;


-- CONFIGURACIÓN DE SEGURIDAD (Row Level Security - RLS)

ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE courts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_times ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;

-- Permisos sobre la vista pública
GRANT SELECT ON bookings_public TO anon;
GRANT SELECT ON bookings_public TO authenticated;

-- Políticas para CLUBS: 
CREATE POLICY "Public clubs are viewable by everyone." ON clubs FOR SELECT USING (true);
CREATE POLICY "Users can insert their own club." ON clubs FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Users can update their own club." ON clubs FOR UPDATE USING (auth.uid() = owner_id);

-- Políticas para COURTS:
CREATE POLICY "Courts are viewable by everyone." ON courts FOR SELECT USING (true);
CREATE POLICY "Owners can manage their courts." ON courts FOR ALL USING (
  EXISTS (SELECT 1 FROM clubs WHERE clubs.id = courts.club_id AND clubs.owner_id = auth.uid())
);

-- Políticas para BOOKINGS:
-- IMPORTANTE: No hay política pública de SELECT ni UPDATE. Todo acceso público va vía vista o RPC.
-- Cualquiera puede INSERTAR una reserva (sin estar logueado)
CREATE POLICY "Anyone can insert a booking." ON bookings FOR INSERT WITH CHECK (true);
-- El dueño del club puede ver y modificar todo
CREATE POLICY "Owners can manage their bookings." ON bookings FOR ALL USING (
  EXISTS (SELECT 1 FROM courts JOIN clubs ON courts.club_id = clubs.id WHERE courts.id = bookings.court_id AND clubs.owner_id = auth.uid())
);

-- Políticas para BLOCKED TIMES:
CREATE POLICY "Blocked times are viewable by everyone." ON blocked_times FOR SELECT USING (true);
CREATE POLICY "Owners can manage their blocked times." ON blocked_times FOR ALL USING (
  EXISTS (SELECT 1 FROM courts JOIN clubs ON courts.club_id = clubs.id WHERE courts.id = blocked_times.court_id AND clubs.owner_id = auth.uid())
);

-- Políticas para CHAT HISTORY:
-- CERRADO: Sin acceso público. Solo el backend con service_role key puede acceder.
DROP POLICY IF EXISTS "Service role and owners can access chat history." ON chat_history;

-- Políticas para CUSTOMERS:
CREATE POLICY "Owners can manage their customers." ON customers FOR ALL USING (
  EXISTS (SELECT 1 FROM clubs WHERE clubs.id = customers.club_id AND clubs.owner_id = auth.uid())
);
