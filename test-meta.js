const token = 'EAAQK3rhan3UBSVn7ZCZBFDZCeIIjPsqTpCALTWZAxfZAuhl8ctfwPGvu0BB3mmPDEQ761D3wgyQeW4UYSbgoEQ7XKfHETe9DmXBcIYDRLOCZA9cML9f9vcYSwqi73UZCZBrZAGByTpnXpZBVgM5d9V2GAU7fqTAIlH92wf1rzKfpfUuaenYNTLRqfw5X5UER5NDZCqhZCdaqB50FaFZCmMPOCZAgTiTeZBnfxUkjTtvb8eIH2AAkJMCuyTEN1yK9UZCFoTe3zIBYMdodok7wMvBEqfAVZCxGzcISX2fddbPSe5ZBoOCgZDZD';
const phoneId = '1266121099925217';
fetch('https://graph.facebook.com/v19.0/' + phoneId + '/messages', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    messaging_product: 'whatsapp',
    to: '5492355642628',
    type: 'text',
    text: { body: 'Mensaje de prueba de diagnóstico' }
  })
}).then(r => r.json()).then(console.log).catch(console.error);
