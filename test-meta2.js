const token = 'EAAQK3rhan3UBSWp8ZAH6fZB0UoZATuLO9Pi3fU21qCjzVMiUkhw0Wa8g2us7o7Vv0z3Y9q5rm9V6lS5MW2P17QOlwRd8ALSiZBZBrjw6UVu2uSc8zFFw0fCTQiuqPJLlixynqCiHKMmmuaw6tSJdNjMSGUtMqH0GZCJ1SjZCknnqwbQxfIQ4WD3qZC0Al6UCIyCSNvDinRqm6gRu3oMkJKVggLij2fZAhzW3VvL4axgBKVPtSt4YxEeGT7FxtUtGLn6gyM5PWTGPS8XIqAHJo97HcVN2ffiv5oNf5BB8M4QZDZD';
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
    text: { body: 'Mensaje de prueba de salida desde script' }
  })
}).then(r => r.json()).then(console.log).catch(console.error);
