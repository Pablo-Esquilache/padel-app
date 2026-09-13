import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const META_TOKEN = process.env.META_ACCESS_TOKEN;
const FALLBACK_SENDER_ID = process.env.META_PHONE_ID;
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

const ALLOWED_TEMPLATES = ['aviso_cliente', 'aviso_admin'];

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { phone, templateName, variables, senderPhoneId, validation } = JSON.parse(event.body || '{}');

    if (!phone || !templateName || !variables || !validation) {
      return { statusCode: 400, body: 'Faltan parámetros requeridos (phone, templateName, variables, validation)' };
    }

    // 1. Validar lista blanca de plantillas
    if (!ALLOWED_TEMPLATES.includes(templateName)) {
      return { statusCode: 403, body: 'Plantilla no permitida' };
    }

    // 2. Validar que exista la reserva en Supabase (Rate-limit implícito)
    const { clubId, customerPhone, bookingDate, bookingTime } = validation;
    if (!clubId || !customerPhone || !bookingDate || !bookingTime) {
      return { statusCode: 400, body: 'Faltan parámetros de validación' };
    }

    // Obtenemos las canchas del club para poder filtrar las reservas
    const { data: courts } = await supabase
      .from('courts')
      .select('id')
      .eq('club_id', clubId);

    if (!courts || courts.length === 0) {
      return { statusCode: 403, body: 'Club no encontrado o sin canchas' };
    }
    const courtIds = courts.map(c => c.id);

    // Buscar una reserva que coincida (puede estar confirmada o cancelada)
    const { data: bookings, error: bookingError } = await supabase
      .from('bookings')
      .select('id')
      .in('court_id', courtIds)
      .eq('booking_date', bookingDate)
      .like('start_time', `${bookingTime}%`)
      .in('status', ['confirmed', 'cancelled'])
      .limit(1);

    if (bookingError || !bookings || bookings.length === 0) {
      console.warn('Bloqueado intento de envío sin reserva válida:', validation);
      return { statusCode: 403, body: 'Acceso denegado: No existe una reserva válida para autorizar este envío' };
    }

    const actualSenderId = senderPhoneId || FALLBACK_SENDER_ID;
    
    if (!META_TOKEN || !actualSenderId) {
      console.error('Faltan credenciales de Meta en el entorno');
      return { statusCode: 500, body: 'Error de configuración de servidor' };
    }

    const metaUrl = `https://graph.facebook.com/v19.0/${actualSenderId}/messages`;

    // Función helper para enviar a Meta con reintentos
    const sendTemplateToMeta = async (targetPhone: string) => {
      return fetch(metaUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${META_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: targetPhone,
          type: 'template',
          template: {
            name: templateName,
            language: { code: 'es_AR' },
            components: [
              {
                type: 'body',
                parameters: variables.map((v: string) => ({
                  type: 'text',
                  text: String(v)
                }))
              }
            ]
          }
        })
      });
    };

    let cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone.startsWith('54')) {
      cleanPhone = '549' + cleanPhone;
    }
    let metaResponse = await sendTemplateToMeta(cleanPhone);
    
    if (!metaResponse.ok) {
      const errorText = await metaResponse.text();
      console.error('ERROR AL ENVIAR PLANTILLA META:', errorText);
      // Fallback para error de formato de número argentino
      if (errorText.includes('131030') && cleanPhone.startsWith('549')) {
        console.log('Detectado error 131030. Probando formato alternativo (sin 9)...');
        const phoneAlt = cleanPhone.replace(/^549/, '54');
        metaResponse = await sendTemplateToMeta(phoneAlt);
        
        if (!metaResponse.ok) {
          const finalError = await metaResponse.text();
          console.error('ERROR AL ENVIAR PLANTILLA (INTENTO 2):', finalError);
          return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'Error enviando mensaje: ' + finalError };
        }
      } else {
        return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'Error enviando mensaje: ' + errorText };
      }
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ success: true, message: 'Notificación enviada' })
    };

  } catch (error: any) {
    console.error('Error interno en notify.ts:', error);
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'Error interno del servidor' };
  }
};
