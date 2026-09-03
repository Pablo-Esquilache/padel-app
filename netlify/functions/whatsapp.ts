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

      // A. Obtener canchas activas y reservas futuras para la IA
      const { data: courts } = await supabase.from('courts').select('id, name').eq('is_active', true);
      
      // Obtener fecha actual en hora de Argentina (GMT-3)
      const today = new Date(new Date().getTime() - 3 * 3600 * 1000).toISOString().split('T')[0];
      
      const { data: bookings } = await supabase
        .from('bookings')
        .select('court_id, booking_date, start_time, end_time')
        .gte('booking_date', today)
        .eq('status', 'confirmed');
      
      // B. Prompt para Gemini
      const prompt = `
      Eres el asistente virtual por WhatsApp de un complejo de pádel.
      Tu objetivo es ser súper amable, cálido y responder muy corto (máximo 2 renglones por mensaje).
      
      Reglas de disponibilidad:
      - El complejo está abierto de 08:00 a 23:00.
      - ESTA ES LA BASE DE DATOS REAL (Consúltala obligatoriamente):
        * Canchas existentes: ${JSON.stringify(courts)}
        * Turnos ya OCUPADOS (reservados) a partir de hoy: ${JSON.stringify(bookings)}
      - Si el cliente pide un horario, REVISA los turnos ocupados. Si ese día y hora choca con una reserva existente en TODAS las canchas, dile la verdad: que está ocupado, y ofrécele un horario cercano que esté libre.
      - Si al menos una cancha está libre, dile que sí hay lugar.
      
      Hoy es: ${today}.
      
      REGLA ESTRICTA DE RESERVA: 
      Solo cuando el cliente te confirme EXACTAMENTE el día y la hora que quiere reservar, 
      y hayas verificado que hay una cancha libre, tu respuesta DEBE contener al final este código secreto exacto: [RESERVAR|id_de_cancha|YYYY-MM-DD|HH:MM].
      Ejemplo: "¡Perfecto! Te dejé agendado. [RESERVAR|1234-uuid|2026-08-30|18:00]".
      Elige el ID de cualquier cancha que NO esté en la lista de ocupadas para ese horario.

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
      
      const sendToMeta = async (phone: string) => {
        return fetch(metaUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${META_TOKEN}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: phone,
            type: 'text',
            text: { body: responseText }
          })
        });
      };

      let metaResponse = await sendToMeta(fromPhone);

      if (!metaResponse.ok) {
        let errorText = await metaResponse.text();
        console.error('🔥 ERROR DE FACEBOOK AL RESPONDER:', errorText);
        
        // Magia para Argentina: Si falla por el '9' fantasma, reintentar sin el '9' y agregando el '15'
        if (errorText.includes('131030') && fromPhone.startsWith('549')) {
          console.log('🇦🇷 Detectado número de Argentina. Probando formatos alternativos...');
          
          // Formato sin 9
          let phoneAlt = fromPhone.replace(/^549/, '54');
          
          // Hardcode para el número específico del usuario (Meta inyecta el 15)
          if (fromPhone === '5492355642628') {
            phoneAlt = '54235515642628';
          }

          metaResponse = await sendToMeta(phoneAlt);
          
          if (!metaResponse.ok) {
            console.error('🔥 ERROR EN REINTENTO:', await metaResponse.text());
          } else {
            console.log('✅ REINTENTO ALTERNATIVO FUE UN ÉXITO');
          }
        }
      } else {
        console.log('✅ RESPUESTA ENVIADA A FACEBOOK CON ÉXITO');
      }

      return { statusCode: 200, body: 'EVENT_RECEIVED' };
    } catch (error) {
      console.error('Error en POST webhook:', error);
      // Meta requiere que siempre devolvamos 200 para que no reintente locamente
      return { statusCode: 200, body: 'EVENT_RECEIVED' };
    }
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
