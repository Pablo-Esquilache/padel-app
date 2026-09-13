import { Handler } from '@netlify/functions';

const META_TOKEN = process.env.META_ACCESS_TOKEN;
const FALLBACK_SENDER_ID = process.env.META_PHONE_ID;

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
    const { phone, templateName, variables, senderPhoneId } = JSON.parse(event.body || '{}');

    if (!phone || !templateName || !variables) {
      return { statusCode: 400, body: 'Faltan parámetros requeridos (phone, templateName, variables)' };
    }

    const actualSenderId = senderPhoneId || FALLBACK_SENDER_ID;
    
    if (!META_TOKEN || !actualSenderId) {
      console.error('Faltan credenciales de Meta en el entorno');
      return { statusCode: 500, body: 'Error de configuración de servidor' };
    }

    const metaUrl = `https://graph.facebook.com/v19.0/${actualSenderId}/messages`;

    // Función helper para enviar a Meta con reintentos para números de Argentina (131030)
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

    let metaResponse = await sendTemplateToMeta(phone);
    
    if (!metaResponse.ok) {
      const errorText = await metaResponse.text();
      console.error('ERROR AL ENVIAR PLANTILLA META:', errorText);
      
      // Fallback para error de formato de número argentino
      if (errorText.includes('131030') && phone.startsWith('549')) {
        console.log('Detectado error 131030. Probando formato alternativo (sin 9)...');
        const phoneAlt = phone.replace(/^549/, '54');
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
