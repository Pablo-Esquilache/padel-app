const token = 'EAAQK3rhan3UBSWp8ZAH6fZB0UoZATuLO9Pi3fU21qCjzVMiUkhw0Wa8g2us7o7Vv0z3Y9q5rm9V6lS5MW2P17QOlwRd8ALSiZBZBrjw6UVu2uSc8zFFw0fCTQiuqPJLlixynqCiHKMmmuaw6tSJdNjMSGUtMqH0GZCJ1SjZCknnqwbQxfIQ4WD3qZC0Al6UCIyCSNvDinRqm6gRu3oMkJKVggLij2fZAhzW3VvL4axgBKVPtSt4YxEeGT7FxtUtGLn6gyM5PWTGPS8XIqAHJo97HcVN2ffiv5oNf5BB8M4QZDZD';
fetch('https://graph.facebook.com/v19.0/1054874627339788/phone_numbers', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer ' + token
  }
}).then(r => r.json()).then(console.log).catch(console.error);
