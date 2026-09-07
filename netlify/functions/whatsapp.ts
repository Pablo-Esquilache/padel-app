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
      
      // HISTORIAL DE CONVERSACIÓN
      const { data: historyData } = await supabase
        .from('chat_history')
        .select('role, content')
        .eq('phone', fromPhone)
        .order('created_at', { ascending: false })
        .limit(10);
      
      let historyText = "";
      if (historyData && historyData.length > 0) {
        // Ordenar cronológicamente (del más viejo al más nuevo de los últimos 10)
        const chronological = historyData.reverse();
        historyText = chronological.map(msg => `${msg.role === 'user' ? 'Cliente' : 'Tú'}: ${msg.content}`).join('\n');
      }

      // Guardar el nuevo mensaje del usuario en el historial
      supabase.from('chat_history').insert([{ phone: fromPhone, role: 'user', content: messageText }])
        .then(res => { if(res.error) console.error('Error guardando historial user:', res.error); });

      // Obtener fecha y hora actual en Argentina (GMT-3)
      const nowArg = new Date(new Date().getTime() - 3 * 3600 * 1000);
      const today = nowArg.toISOString().split('T')[0];
      const currentTime = nowArg.toISOString().split('T')[1].substring(0, 5); // "HH:MM"
      
      const { data: bookings } = await supabase
        .from('bookings')
        .select('court_id, booking_date, start_time, end_time')
        .gte('booking_date', today)
        .eq('status', 'confirmed');
      
      // B. Prompt para Gemini
      const prompt = `
      Eres el recepcionista por WhatsApp de un complejo de pádel en Argentina. 
      
      REGLAS DE PERSONALIDAD Y SALUDOS:
      - Sé amable, directo y responde MUY corto.
      - NUNCA digas "Hola", "Buenas" o saludes a menos que sea evidente que es el primer mensaje del cliente.
      
      REGLAS DE DISPONIBILIDAD Y CANCHAS:
      - ESTA ES LA BASE DE DATOS REAL:
        * Canchas existentes: ${JSON.stringify(courts)}
        * Turnos ya OCUPADOS a partir de hoy: ${JSON.stringify(bookings)}
      - ¡ATENCIÓN! NUNCA le digas al cliente el "id" de la cancha. Llámalas SOLO por su nombre (ej: "Cancha 1"). El "id" úsalo ÚNICAMENTE en el código secreto.
      - Si te piden horarios disponibles, DEBES listarlos claramente agrupados por cancha.
      
      Hoy es: ${today}. La hora actual es: ${currentTime}.
      REGLA DE ORO: ¡NUNCA ofrezcas un turno para hoy cuyo horario ya haya pasado de la hora actual!
      
      REGLA ESTRICTA DE RESERVA (¡MUUY IMPORTANTE!): 
      Para agendar, OBLIGATORIAMENTE necesitas 5 cosas: Día, Hora, Nombre, Número de Teléfono y Tipo de partido (Masculino, Femenino o Mixto).
      PASO 1: Si faltan datos, PÍDESELOS. NO RESERVES TODAVÍA.
      PASO 2: Solo cuando tengas TODOS los datos y haya lugar, tu respuesta DEBE contener al final este código secreto exacto: [RESERVAR|id_de_cancha|YYYY-MM-DD|HH:MM|Nombre|Tipo|Telefono].
      
      REGLA ESTRICTA DE CANCELACIÓN:
      Si el cliente quiere cancelar, pregúntale: Día, Hora, Nombre y Número de Teléfono.
      Solo cuando te confirme todo, tu respuesta DEBE contener al final: [CANCELAR|YYYY-MM-DD|HH:MM|Nombre|Telefono].

      HISTORIAL RECIENTE DE LA CONVERSACIÓN:
      ${historyText || '(No hay mensajes previos)'}

      Nuevo mensaje del cliente: "${messageText}"
      `;

      // C. Consultar a Gemini
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent(prompt);
      let responseText = result.response.text();

      // Guardar la respuesta del modelo en el historial (antes de limpiar los códigos secretos para que lo recuerde? No, mejor lo que vio el cliente)
      let cleanedResponseText = responseText.replace(/\[RESERVAR.*\]/, '').replace(/\[CANCELAR.*\]/, '').trim();
      supabase.from('chat_history').insert([{ phone: fromPhone, role: 'model', content: cleanedResponseText }])
        .then(res => { if(res.error) console.error('Error guardando historial model:', res.error); });

      // D. Leer si la IA decidió hacer una reserva
      const reserveMatch = responseText.match(/\[RESERVAR\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^\]]+)\]/);
      if (reserveMatch) {
        const [_, court_id, date, time, customer_name, match_type, customer_phone] = reserveMatch;
        responseText = responseText.replace(/\[RESERVAR.*\]/, '').trim(); // Ocultar código
        
        const cancellationCode = Math.random().toString(36).substring(2, 10).toUpperCase();

        const { error } = await supabase.from('bookings').insert([{
          court_id,
          booking_date: date,
          start_time: time,
          end_time: time, // Simplificado
          customer_name: customer_name.trim(),
          customer_phone: customer_phone.trim(),
          match_type: match_type.trim(),
          cancellation_code: cancellationCode,
          status: 'confirmed'
        }]);

        if (error) {
          console.error('Error DB Reserva:', error);
          responseText = "Ups, hubo un choque en la base de datos y no pude guardar el turno.";
        }
      }

      // E. Leer si la IA decidió CANCELAR un turno
      const cancelMatch = responseText.match(/\[CANCELAR\|([^|]+)\|([^|]+)\|([^|]+)\|([^\]]+)\]/);
      if (cancelMatch) {
        const [_, date, time, customer_name, customer_phone] = cancelMatch;
        responseText = responseText.replace(/\[CANCELAR.*\]/, '').trim();
        
        const { error } = await supabase
          .from('bookings')
          .update({ status: 'cancelled' })
          .eq('booking_date', date)
          .eq('start_time', time)
          .ilike('customer_name', `%${customer_name.trim()}%`)
          .eq('customer_phone', customer_phone.trim())
          .eq('status', 'confirmed');
          
        if (error) {
           console.error('Error DB Cancelar:', error);
           responseText = "Ups, hubo un problema y no pude cancelar el turno. Contacta al club.";
        }
      }

      // F. Enviar la respuesta de vuelta al cliente vía Meta Cloud API
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
