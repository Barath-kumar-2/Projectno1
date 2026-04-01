const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://jdhqnhuykgagxoucxpxu.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpkaHFuaHV5a2dhZ3hvdWN4cHh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTA1MDI4MiwiZXhwIjoyMDkwNjI2MjgyfQ.0a4rVXJReop5mOrAB8jIHWxDbVL-1di2-zCGAHC0PZk'; // backend only

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;