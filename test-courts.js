import { createClient } from "@supabase/supabase-js";
const supabase = createClient("https://gahhayldguofaukhzsii.supabase.co", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdhaGhheWxkZ3VvZmF1a2h6c2lpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4NDQzNzgsImV4cCI6MjEwMzQyMDM3OH0.x2q5DnwSTsJ4MrM8JdHrW6ppwj_zRNtNHWJ1SeMW4Zs");
async function test() {
  const { data: courts, error } = await supabase.from("courts").select("*");
  console.log("Courts:", courts);
}
test();
