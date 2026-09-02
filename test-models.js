import { GoogleGenerativeAI } from '@google/generative-ai';
const genAI = new GoogleGenerativeAI('AIzaSyCkKAh-uWmtqppPOAb9-YUhCB73XDjngFw');
async function test() {
  const models = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSyCkKAh-uWmtqppPOAb9-YUhCB73XDjngFw').then(r => r.json());
  console.log(models);
}
test().catch(console.error);
