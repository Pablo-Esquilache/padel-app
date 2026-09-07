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
      
      1. PERSONALIDAD Y LÍMITES
      - Sé amable, directo y responde MUY corto (conciso).
      - NUNCA digas "Hola" ni saludes a menos que sea el primer mensaje del cliente.
      - NO CHARLES. Si preguntan cosas no relacionadas, diles que solo gestionas turnos.
      - NUNCA INVENTES horarios ni datos.
      
      2. INTERPRETACIÓN DE TIEMPO Y CANCHAS
      - Hoy es: ${today}. La hora actual es: ${currentTime}.
      - "Mañana" es el día siguiente a Hoy. "Jueves" es el próximo jueves. 
      - REGLA DE ORO: ¡Nunca ofrezcas un turno para un horario que ya pasó en el reloj actual!
      - Si un horario es ambiguo (ej: "A las 8"), pide aclaración (08:00 o 20:00).
      
      3. DISPONIBILIDAD (Base de Datos Real)
      - Canchas: ${JSON.stringify(courts)}
      - Ocupados: ${JSON.stringify(bookings)}
      - NUNCA pases el "ID" largo de la cancha al cliente. Llámalas por su nombre ("Cancha 1").
      - Si te piden horarios disponibles, enuméralos claramente agrupados por cancha.
      - Si el turno pedido está OCUPADO, di que "No", y muéstrale las alternativas libres para ese día.
      
      4. CREAR UNA RESERVA
      - Necesitas 5 datos: Día, Hora, Nombre, Número de Teléfono y Tipo (Masculino/Femenino/Mixto).
      - Si faltan datos, NO reserves. Pide SOLAMENTE el dato que falte.
      - Una vez confirmado, tu respuesta DEBE terminar con: [RESERVAR|id_de_cancha|YYYY-MM-DD|HH:MM|Nombre|Tipo|Telefono]
      
      5. CONSULTAR TURNOS PROPIOS
      - Si preguntan "¿Qué turno tengo?", revisa la lista buscando su nombre/teléfono.
      
      6. MODIFICAR UN TURNO
      - Si piden cambiar un turno, pregunta qué día/hora lo tenían, y para cuándo lo quieren.
      - Confirmado todo, tu respuesta DEBE terminar con: [MODIFICAR|id_de_cancha_nueva|fecha_vieja|hora_vieja|fecha_nueva|hora_nueva|Nombre|Tipo|Telefono]
      
      7. CANCELAR UN TURNO
      - Si piden cancelar, confirma su Nombre, Teléfono y Día/Hora del turno.
      - Confirmado todo, tu respuesta DEBE terminar con: [CANCELAR|YYYY-MM-DD|HH:MM|Nombre|Telefono]
      
      8. TICKET DE RESUMEN (¡IMPORTANTE!)
      - Cada vez que emitas un código secreto (RESERVAR, CANCELAR o MODIFICAR), INCLUYE SIEMPRE en tu mensaje un "Ticket de Resumen" (como un recibo) con viñetas detallando los datos de la operación para tranquilidad del cliente.

      HISTORIAL RECIENTE DE LA CONVERSACIÓN:
      ${historyText || '(No hay mensajes previos)'}

      Nuevo mensaje del cliente: "${messageText}"
      `;

      // C. Consultar a Gemini
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const result = await model.generateContent(prompt);
      let responseText = result.response.text();

      // Guardar la respuesta del modelo en el historial (antes de limpiar los códigos secretos para que lo recuerde? No, mejor lo que vio el cliente)
      let cleanedResponseText = responseText.replace(/\[RESERVAR.*\]/, '').replace(/\[CANCELAR.*\]/, '').replace(/\[MODIFICAR.*\]/, '').trim();
      supabase.from('chat_history').insert([{ phone: fromPhone, role: 'model', content: cleanedResponseText }])
        .then(res => { if(res.error) console.error('Error guardando historial model:', res.error); });

      // D. Leer si la IA decidió hacer una reserva
      const reserveMatch = responseText.match(/\[RESERVAR\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^\]]+)\]/);
      if (reserveMatch) {
        const [_, court_id, date, time, customer_name, match_type, customer_phone] = reserveMatch;
        responseText = cleanedResponseText; // Ocultar código
        
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
        responseText = cleanedResponseText;
        
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
      
      // F. Leer si la IA decidió MODIFICAR un turno
      const modMatch = responseText.match(/\[MODIFICAR\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^\]]+)\]/);
      if (modMatch) {
        const [_, court_id_nueva, old_date, old_time, new_date, new_time, customer_name, match_type, customer_phone] = modMatch;
        responseText = cleanedResponseText;
        
        // Primero cancelamos el viejo
        const { error: errorCancel } = await supabase
          .from('bookings')
          .update({ status: 'cancelled' })
          .eq('booking_date', old_date)
          .eq('start_time', old_time)
          .ilike('customer_name', `%${customer_name.trim()}%`)
          .eq('customer_phone', customer_phone.trim())
          .eq('status', 'confirmed');
          
        if (!errorCancel) {
          // Si pudimos cancelar, insertamos el nuevo
          const cancellationCode = Math.random().toString(36).substring(2, 10).toUpperCase();
          const { error: errorInsert } = await supabase.from('bookings').insert([{
            court_id: court_id_nueva,
            booking_date: new_date,
            start_time: new_time,
            end_time: new_time,
            customer_name: customer_name.trim(),
            customer_phone: customer_phone.trim(),
            match_type: match_type.trim(),
            cancellation_code: cancellationCode,
            status: 'confirmed'
          }]);
          if (errorInsert) {
             console.error('Error DB Modificar Insert:', errorInsert);
             responseText = "Cancelé tu turno anterior pero el nuevo horario se acaba de ocupar. Hablemos para buscar otro.";
          }
        } else {
           console.error('Error DB Modificar Cancel:', errorCancel);
           responseText = "Ups, no encontré el turno original para modificar. Revisa que los datos sean correctos.";
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
