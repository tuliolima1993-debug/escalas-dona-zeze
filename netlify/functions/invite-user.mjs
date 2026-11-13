// Função serverless (Netlify) para convidar usuários.
// Usa a service_role key APENAS no servidor (variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY na Netlify).
import { createClient } from '@supabase/supabase-js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json(500, { error: 'Função não configurada: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY na Netlify.' });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Não autenticado.' });

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data: who, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !who?.user) return json(401, { error: 'Sessão inválida.' });
  const { data: profile } = await admin.from('profiles').select('role').eq('id', who.user.id).maybeSingle();
  if (profile?.role !== 'admin') return json(403, { error: 'Apenas administradores podem convidar usuários.' });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: 'Requisição inválida.' }); }
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim();
  const role = ['admin', 'supervisor', 'viewer'].includes(body.role) ? body.role : 'viewer';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'E-mail inválido.' });

  const origin = req.headers.get('origin') || undefined;
  const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, { data: { name }, redirectTo: origin });
  if (error) return json(400, { error: error.message });
  const { error: roleErr } = await admin.from('profiles').update({ role, name: name || undefined }).eq('id', invited.user.id);
  if (roleErr) return json(500, { error: 'Convite enviado, mas não foi possível definir o perfil: ' + roleErr.message });
  return json(200, { ok: true });
};
