import { Handler } from '@netlify/functions';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const supabase = createClient(process.env.VITE_SUPABASE_URL || '', process.env.VITE_SUPABASE_ANON_KEY || '');

// Claves de Meta
const META_TOKEN = process.env.META_ACCESS_TOKEN || '';
const META_PHONE_ID = process.env.META_PHONE_ID || '';
const META_VERIFY_TOKEN = 'padelapp2026'; // Token inventado para verificar el webhook

export const handler: Handler = async (event) => {
  // 1. Verificación del Webhook de Meta (Petición GET)
  if (event.httpMethod === 'GET') {
    const params = event.queryStringParameters || {};
    const mode = params['hub.mode'];
    const token = params['hub.verify_token'];
    const challenge = params['hub.challenge'];

    if (mode === 'subscribe' && token === META_VERIFY_TOKEN) {
      console.log('Webhook verificado exitosamente');
      return { statusCode: 200, body: challenge };
    } else {
      return { statusCode: 403, body: 'Forbidden' };
    }
  }

  // 2. Recepción de mensajes de WhatsApp (Petición POST)
  if (event.httpMethod === 'POST') {
    console.log('🔥 WEBHOOK RECIBIDO EN NETLIFY!');
    try {
      const bodyParams = JSON.parse(event.body || '{}');
      console.log('Cuerpo del mensaje:', JSON.stringify(bodyParams, null, 2));
      
      // Validar que sea un mensaje de WhatsApp
      if (bodyParams.object !== 'whatsapp_business_account') {
        return { statusCode: 404, body: 'Not Found' };
      }

      // Navegar por el JSON asqueroso de Meta para extraer el mensaje
      const entry = bodyParams.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages;

      // Si no hay mensajes (ej: es solo un aviso de "entregado" o "leído"), ignoramos
      if (!messages || messages.length === 0) {
        return { statusCode: 200, body: 'EVENT_RECEIVED' };
      }

      const message = messages[0];
      const fromPhone = message.from; // Número del cliente
      const messageText = message.text?.body || '';

      if (!messageText) {
        return { statusCode: 200, body: 'EVENT_RECEIVED' };
      }

      // --- EMPIEZA LA MAGIA DE LA IA ---

      // A. Obtener canchas activas para la IA
      const { data: courts } = await supabase.from('courts').select('id, name').eq('is_active', true);
      
      // B. Prompt para Gemini
      const prompt = `
      Eres el asistente virtual de un complejo de pádel.
      Tu objetivo es responder de forma amable, corta y al grano, como si chatearas por WhatsApp.
      Si el cliente quiere reservar un turno, debes identificar la cancha, la fecha y la hora.
      Hoy es: ${new Date().toISOString().split('T')[0]}.
      Las canchas disponibles en la base de datos son: ${JSON.stringify(courts)}.
      
      REGLA ESTRICTA: 
      Si el cliente te confirma que quiere reservar (ej: "quiero turno mañana a las 18 en la cancha 1"), 
      tu respuesta DEBE contener al final este código secreto: [RESERVAR|id_de_cancha|YYYY-MM-DD|HH:MM].
      Ejemplo: "¡Perfecto! Te dejé agendado. [RESERVAR|1234-uuid|2026-08-30|18:00]".
      Usa los IDs reales de las canchas proporcionadas. Si no especifica, elige la primera.
      Si solo está preguntando horarios o cosas generales, responde normalmente sin el código.

      Mensaje del cliente: "${messageText}"
      `;

      // C. Consultar a Gemini
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent(prompt);
      let responseText = result.response.text();

      // D. Leer si la IA decidió hacer una reserva
      const reserveMatch = responseText.match(/\[RESERVAR\|([^\|]+)\|([^\|]+)\|([^\]]+)\]/);
      if (reserveMatch) {
        const [_, court_id, date, time] = reserveMatch;
        responseText = responseText.replace(/\[RESERVAR.*\]/, '').trim(); // Ocultar código al cliente
        
        const cancellationCode = Math.random().toString(36).substring(2, 10).toUpperCase();

        const { error } = await supabase.from('bookings').insert([{
          court_id,
          booking_date: date,
          start_time: time,
          end_time: time, // Simplificado
          customer_name: 'Cliente IA',
          customer_phone: fromPhone,
          match_type: 'Masculino',
          cancellation_code: cancellationCode,
          status: 'confirmed'
        }]);

        if (error) {
          console.error('Error DB:', error);
          responseText = "Ups, hubo un choque en la base de datos y no pude guardar el turno. ¿Podemos intentar con otro horario?";
        }
      }

      // E. Enviar la respuesta de vuelta al cliente vía Meta Cloud API
      const metaUrl = `https://graph.facebook.com/v19.0/${META_PHONE_ID}/messages`;
      await fetch(metaUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${META_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: fromPhone,
          type: 'text',
          text: { body: responseText }
        })
      });

      return { statusCode: 200, body: 'EVENT_RECEIVED' };
    } catch (error) {
      console.error('Error en POST webhook:', error);
      // Meta requiere que siempre devolvamos 200 para que no reintente locamente
      return { statusCode: 200, body: 'EVENT_RECEIVED' };
    }
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
