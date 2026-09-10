import { Handler } from '@netlify/functions';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
// Inicializar Supabase usando la Service Role Key para permisos de administrador (bypassea RLS)
const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Claves de Meta
const META_TOKEN = process.env.META_ACCESS_TOKEN || '';
const META_PHONE_ID = process.env.META_PHONE_ID || '';
const META_APP_SECRET = process.env.META_APP_SECRET || '';
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
    
    // VALIDACIÓN DE FIRMA (PATOVICA DE SEGURIDAD)
    const signature = event.headers['x-hub-signature-256'] || event.headers['X-Hub-Signature-256'];
    const bodyRaw = event.body || '';
    
    if (META_APP_SECRET && signature) {
      const hmac = crypto.createHmac('sha256', META_APP_SECRET);
      const digest = 'sha256=' + hmac.update(bodyRaw).digest('hex');
      if (signature !== digest) {
        console.error('Firma de Meta inválida. Bloqueando petición maliciosa.');
        return { statusCode: 401, body: 'Invalid signature' };
      }
    }

    try {
      const bodyParams = JSON.parse(bodyRaw);
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

      // A. Obtener datos base
      const { data: courts } = await supabase.from('courts').select('id, name');
      const { data: club } = await supabase.from('clubs').select('opening_hours, admin_phone').limit(1).single();
      const { data: blockedTimes } = await supabase.from('blocked_times').select('*');
      
      // HISTORIAL DE CONVERSACIÓN
      const { data: historyData } = await supabase
        .from('chat_history')
        .select('role, content')
        .eq('phone', fromPhone)
        .order('created_at', { ascending: false })
        .limit(10);
      
      let historyText = "";
      if (historyData && historyData.length > 0) {
        const chronological = historyData.reverse();
        historyText = chronological.map(msg => `${msg.role === 'user' ? 'Cliente' : 'Tú'}: ${msg.content}`).join('\n');
      }

      supabase.from('chat_history').insert([{ phone: fromPhone, role: 'user', content: messageText }]).then();

      // Obtener fecha y hora actual en Argentina (GMT-3)
      const nowArg = new Date(new Date().getTime() - 3 * 3600 * 1000);
      const today = nowArg.toISOString().split('T')[0];
      const currentTime = nowArg.toISOString().split('T')[1].substring(0, 5); // "HH:MM"
      
      const nextWeekArg = new Date(nowArg.getTime() + 7 * 24 * 3600 * 1000);
      const nextWeek = nextWeekArg.toISOString().split('T')[0];

      const { data: bookings } = await supabase
        .from('bookings')
        .select('court_id, booking_date, start_time, end_time')
        .gte('booking_date', today)
        .lte('booking_date', nextWeek)
        .eq('status', 'confirmed');
        
      // ALGORITMO CLONADO DE LA WEB: Calcular turnos libres exactos
      const toMins = (timeStr: string) => {
        const [h, m] = timeStr.split(':').map(Number);
        return h * 60 + m;
      };

      const formatMins = (mins: number) => {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return `${(h === 24 ? 0 : h).toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      };

      let availableSlotsText = "";

      for (let i = 0; i <= 7; i++) {
        const targetDateObj = new Date(nowArg.getTime() + i * 24 * 3600 * 1000);
        const targetDate = targetDateObj.toISOString().split('T')[0];
        const dayOfWeek = targetDateObj.getUTCDay(); // 0 is Sunday, 1 is Monday
        
        availableSlotsText += `\n[ FECHA: ${targetDate} ]\n`;
        
        for (const court of (courts || [])) {
          let courtSlots = [];
          const blocks = (blockedTimes || []).filter(b => b.court_id === court.id && b.day_of_week === dayOfWeek);
          const courtBookings = (bookings || []).filter(b => b.court_id === court.id && b.booking_date === targetDate);
          
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
          
          while (currentMin + 90 <= endMin) {
            const slotEndMin = currentMin + 90;
            
            const overlappingBlock = blocks.find(b => {
              const bS = toMins(b.start_time);
              const bE = toMins(b.end_time);
              return bS < slotEndMin && bE > currentMin;
            });

            if (overlappingBlock) {
              currentMin = toMins(overlappingBlock.end_time);
            } else {
              const startStr = formatMins(currentMin);
              const isBooked = courtBookings.some(b => b.start_time.startsWith(startStr));
              let isPast = false;
              if (targetDate === today) {
                isPast = currentMin <= toMins(currentTime);
              }
              
              if (!isBooked && !isPast) {
                courtSlots.push(startStr);
              }
              currentMin = slotEndMin;
            }
          }
          if (courtSlots.length > 0) {
            availableSlotsText += `* ${court.name}: ${courtSlots.join(', ')}\n`;
          }
        }
      }
      
      // B. Prompt para Gemini
      const prompt = `
      Eres el recepcionista por WhatsApp de un complejo de pádel en Argentina. 
      
      1. PERSONALIDAD Y LÍMITES
      - Sé amable, directo y responde MUY corto (conciso).
      - NUNCA digas "Hola" ni saludes a menos que sea el primer mensaje del cliente.
      - NO CHARLES. Si preguntan cosas no relacionadas, diles que solo gestionas turnos.
      - NUNCA INVENTES horarios ni datos.
      
      2. INTERPRETACIÓN DE TIEMPO
      - Hoy es: ${today}. La hora actual es: ${currentTime}.
      - "Mañana" es el día siguiente a Hoy. "Jueves" es el próximo jueves. 
      
      3. DISPONIBILIDAD EXACTA (LEER ATENTAMENTE)
      Aquí tienes la lista EXACTA de turnos libres para los próximos 7 días, calculada matemáticamente (ya tiene restados los turnos ocupados, las clases y los turnos vencidos por la hora actual):
      
      ${availableSlotsText}
      
      - NUNCA ofrezcas un turno que no esté explícitamente en la lista de arriba para ese día. Si no está en la lista, significa que la cancha está OCUPADA o CERRADA.
      - Si el turno pedido está OCUPADO, di que "No", y muéstrale las alternativas libres que ves en la lista.
      - Canchas IDs (SOLO usar para el código secreto): ${JSON.stringify(courts)}
      
      4. CREAR UNA RESERVA
      - Necesitas 4 datos: Día, Hora exacta de la lista, Nombre y Tipo (Masculino/Femenino/Mixto).
      - EL TELÉFONO DEL CLIENTE ES: ${fromPhone}. Úsalo internamente, NUNCA se lo preguntes.
      - Si faltan datos, NO reserves. Pide SOLAMENTE el dato que falte.
      - Una vez confirmado, tu respuesta DEBE terminar con: [RESERVAR|id_de_cancha|YYYY-MM-DD|HH:MM|Nombre|Tipo|${fromPhone}]
      
      5. CONSULTAR TURNOS PROPIOS
      - Si preguntan "¿Qué turno tengo?", ya no puedes buscarlo tú mismo, indícales que no puedes revisar turnos pasados ni propios por ahora, solo agendar nuevos.
      
      6. MODIFICAR UN TURNO
      - Si piden cambiar un turno, pregunta qué día/hora lo tenían, y para cuándo lo quieren (revisando la lista). NO preguntes el teléfono.
      - Confirmado todo, tu respuesta DEBE terminar con: [MODIFICAR|id_de_cancha_nueva|fecha_vieja|hora_vieja|fecha_nueva|hora_nueva|Nombre|Tipo|${fromPhone}]
      
      7. CANCELAR UN TURNO
      - Si piden cancelar, confirma su Nombre y Día/Hora del turno. NO preguntes el teléfono.
      - Confirmado todo, tu respuesta DEBE terminar con: [CANCELAR|YYYY-MM-DD|HH:MM|Nombre|${fromPhone}]
      
      8. TICKET DE RESUMEN (¡IMPORTANTE!)
      - Cada vez que emitas un código secreto (RESERVAR, CANCELAR o MODIFICAR), INCLUYE SIEMPRE en tu mensaje un "Ticket de Resumen" con viñetas detallando los datos de la operación para tranquilidad del cliente.

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

      // Función helper para sumar 90 minutos
      const add90Mins = (timeStr: string) => {
        let [h, m] = timeStr.split(':').map(Number);
        m += 90;
        h += Math.floor(m / 60);
        m = m % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      };

      // Bandera para saber si notificamos al admin
      let actionSuccessful = false;

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
          end_time: add90Mins(time),
          customer_name: customer_name.trim(),
          customer_phone: customer_phone.trim(),
          match_type: match_type.trim(),
          cancellation_code: cancellationCode,
          status: 'confirmed'
        }]);

        if (error) {
          console.error('Error DB Reserva:', error);
          responseText = "Ups, hubo un choque en la base de datos y no pude guardar el turno.";
        } else {
          actionSuccessful = true;
        }
      }

      // E. Leer si la IA decidió CANCELAR un turno
      const cancelMatch = responseText.match(/\[CANCELAR\|([^|]+)\|([^|]+)\|([^|]+)\|([^\]]+)\]/);
      if (cancelMatch) {
        const [_, date, time, customer_name, customer_phone] = cancelMatch;
        responseText = cleanedResponseText;
        
        // Relajar el chequeo del teléfono buscando solo los últimos 8 dígitos (por si en la web lo escribieron sin prefijo)
        const phoneSuffix = customer_phone.trim().slice(-8);

        const { data, error } = await supabase
          .from('bookings')
          .update({ status: 'cancelled' })
          .eq('booking_date', date)
          .eq('start_time', time)
          .ilike('customer_name', `%${customer_name.trim()}%`)
          .ilike('customer_phone', `%${phoneSuffix}%`)
          .eq('status', 'confirmed')
          .select();
          
        if (error || !data || data.length === 0) {
           console.error('Error DB Cancelar:', error || '0 filas actualizadas');
           responseText = "Ups, no encontré ningún turno a tu nombre en ese horario para cancelar. Revisa los datos.";
        } else {
           actionSuccessful = true;
        }
      }
      
      // F. Leer si la IA decidió MODIFICAR un turno
      const modMatch = responseText.match(/\[MODIFICAR\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|([^\]]+)\]/);
      if (modMatch) {
        const [_, court_id_nueva, old_date, old_time, new_date, new_time, customer_name, match_type, customer_phone] = modMatch;
        responseText = cleanedResponseText;
        
        const phoneSuffix = customer_phone.trim().slice(-8);

        // Primero cancelamos el viejo
        const { data: cancelData, error: errorCancel } = await supabase
          .from('bookings')
          .update({ status: 'cancelled' })
          .eq('booking_date', old_date)
          .eq('start_time', old_time)
          .ilike('customer_name', `%${customer_name.trim()}%`)
          .ilike('customer_phone', `%${phoneSuffix}%`)
          .eq('status', 'confirmed')
          .select();
          
        if (!errorCancel && cancelData && cancelData.length > 0) {
          // Si pudimos cancelar, insertamos el nuevo
          const cancellationCode = Math.random().toString(36).substring(2, 10).toUpperCase();
          const { error: errorInsert } = await supabase.from('bookings').insert([{
            court_id: court_id_nueva,
            booking_date: new_date,
            start_time: new_time,
            end_time: add90Mins(new_time),
            customer_name: customer_name.trim(),
            customer_phone: customer_phone.trim(), // Guardamos el nuevo completo
            match_type: match_type.trim(),
            cancellation_code: cancellationCode,
            status: 'confirmed'
          }]);
          
          if (errorInsert) {
             console.error('Error DB Modificar Insert:', errorInsert);
             responseText = "Cancelé tu turno anterior pero el nuevo horario se acaba de ocupar. Hablemos para buscar otro.";
          } else {
             actionSuccessful = true;
          }
        } else {
           console.error('Error DB Modificar Cancel:', errorCancel || '0 filas canceladas');
           responseText = "Ups, no encontré el turno original a tu nombre para modificar. Revisa que el día y horario sean correctos.";
        }
      }

      // G. Enviar la respuesta vía Meta Cloud API
      const metaUrl = `https://graph.facebook.com/v19.0/${META_PHONE_ID}/messages`;
      
      const sendToMeta = async (phone: string, textOverride?: string) => {
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
            text: { body: textOverride || responseText }
          })
        });
      };

      const sendSafe = async (phone: string, text: string) => {
        let metaResponse = await sendToMeta(phone, text);
        if (!metaResponse.ok) {
          let errorText = await metaResponse.text();
          console.error('ERROR DE FACEBOOK AL RESPONDER A', phone, ':', errorText);
          if (errorText.includes('131030') && phone.startsWith('549')) {
            console.log('Detectado número de Argentina. Probando formatos alternativos...');
            let phoneAlt = phone.replace(/^549/, '54');
            if (phone === '5492355642628') phoneAlt = '54235515642628';
            await sendToMeta(phoneAlt, text);
          }
        }
      };

      // 1. Enviar respuesta final al cliente
      await sendSafe(fromPhone, responseText);
      
      // 2. Enviar notificación Push al Administrador si hubo movimiento
      if (actionSuccessful && club?.admin_phone) {
         const adminMsg = `🚨 *Alerta del Sistema* 🚨\nUn cliente acaba de actualizar la agenda. Aquí tienes su resumen:\n\n${cleanedResponseText}`;
         // El admin_phone guardado en la config ya debería incluir código de país, ej 549...
         await sendSafe(club.admin_phone, adminMsg);
      }

      return { statusCode: 200, body: 'EVENT_RECEIVED' };
    } catch (error) {
      console.error('Error en POST webhook:', error);
      // Meta requiere que siempre devolvamos 200
      return { statusCode: 200, body: 'EVENT_RECEIVED' };
    }
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};
