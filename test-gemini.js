import { GoogleGenerativeAI } from '@google/generative-ai';
const genAI = new GoogleGenerativeAI('AIzaSyCkKAh-uWmtqppPOAb9-YUhCB73XDjngFw');
async function test() {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const result = await model.generateContent('hola');
  console.log(result.response.text());
}
test().catch(console.error);
