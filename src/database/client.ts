import { createClient } from "@supabase/supabase-js";
import { supabaseSecretKey, supabaseUrl } from "../config.js";

// Supabase への接続（2番）
// 秘密の鍵（secret キー）を使うので、ボットの中でだけ使う
export const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false },
});
