import { Handler } from '@netlify/functions';
import twilio from 'twilio';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

// Inicializar clientes
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const supabase = createClient(process.env.VITE_SUPABASE_URL || '', process.env.VITE_SUPABASE_ANON_KEY || '');

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Twilio envía los datos en formato URL-encoded
    const params = new URLSearchParams(event.body || '');
    const body = params.get('Body') || ''; // Lo que escribió el usuario
    const from = params.get('From') || ''; // Número del usuario (ej: whatsapp:+54911...)
    const to = params.get('To') || '';     // Número del Sandbox

    // 1. Obtener canchas activas para darle contexto a la IA
    const { data: courts } = await supabase.from('courts').select('id, name, club_id').eq('is_active', true);
    
    // 2. Armar el Prompt para la IA
    const prompt = `
    Eres el asistente virtual de un complejo de pádel.
    Tu objetivo es responder de forma amable y concisa.
    Si el cliente quiere reservar un turno, debes identificar la cancha, la fecha y la hora.
    Hoy es: ${new Date().toISOString().split('T')[0]}.
    Las canchas disponibles en la base de datos son: ${JSON.stringify(courts)}.
    
    REGLA ESTRICTA: 
    Si el cliente te confirma que quiere reservar (por ejemplo: "quiero turno mañana a las 18 en la cancha 1" o "reservame a las 20"), 
    tu respuesta DEBE contener al final este código secreto exacto: [RESERVAR|id_de_cancha|YYYY-MM-DD|HH:MM].
    Por ejemplo: "¡Perfecto! Turno reservado. [RESERVAR|1234-uuid|2026-08-30|18:00]".
    Usa los IDs reales de las canchas proporcionadas. Si no especifica cancha, elige la primera.
    Si solo está preguntando, responde normalmente sin el código.

    Mensaje del cliente: "${body}"
    `;

    // 3. Consultar a Gemini
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(prompt);
    let responseText = result.response.text();

    // 4. Leer si la IA decidió hacer una reserva
    const reserveMatch = responseText.match(/\[RESERVAR\|([^\|]+)\|([^\|]+)\|([^\]]+)\]/);
    if (reserveMatch) {
      const [_, court_id, date, time] = reserveMatch;
      
      // Limpiar el mensaje para que el usuario no vea el código raro
      responseText = responseText.replace(/\[RESERVAR.*\]/, '').trim();
      
      const phoneClean = from.replace('whatsapp:', '');
      const cancellationCode = Math.random().toString(36).substring(2, 10).toUpperCase();

      // Guardar reserva en Supabase
      const { error } = await supabase.from('bookings').insert([{
        court_id,
        booking_date: date,
        start_time: time,
        end_time: time, // Simplificado, idealmente +1.5h
        customer_name: 'Cliente WhatsApp',
        customer_phone: phoneClean,
        match_type: 'Masculino',
        cancellation_code: cancellationCode,
        status: 'confirmed'
      }]);

      if (error) {
        console.error('Error al guardar reserva:', error);
        responseText = "Lo siento, hubo un problema al guardar tu reserva o el turno ya está ocupado. Por favor intenta otro horario.";
      } else {
        // Opcional: avisar al administrador (aquí necesitaríamos buscar el admin_phone del club, pero para el MVP basta)
      }
    }

    // 5. Enviar la respuesta de vuelta por WhatsApp vía Twilio
    await twilioClient.messages.create({
      body: responseText,
      from: to,
      to: from
    });

    return { statusCode: 200, body: 'OK' };
  } catch (error) {
    console.error('Webhook Error:', error);
    return { statusCode: 500, body: 'Internal Server Error' };
  }
};
