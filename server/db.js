const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://jdhqnhuykgagxoucxpxu.supabase.co';
const supabaseKey = 'YOUR_SERVICE_ROLE_KEY'; // backend only

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;