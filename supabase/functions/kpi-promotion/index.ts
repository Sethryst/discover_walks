import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const enc = new TextEncoder();
async function sha(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = request.headers.get('Authorization') || '';
    const publicClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: userError } = await publicClient.auth.getUser();
    if (userError || !user) throw new Error('Authentication required');
    const emailHash = await sha((user.email || '').trim().toLowerCase());
    const phoneHash = await sha((user.phone || '').replace(/\D/g, ''));
    const allowed = [Deno.env.get('KPI_MODERATOR_EMAIL_HASH'), Deno.env.get('KPI_MODERATOR_PHONE_HASH')].filter(Boolean);
    if (!allowed.includes(emailHash) && !allowed.includes(phoneHash)) throw new Error('Moderator access required');
    const body = await request.json();
    const status = body.status === 'BUILD_REQUESTED' ? 'BUILD_REQUESTED' : body.status === 'PUBLISH_REQUESTED' ? 'PUBLISH_REQUESTED' : null;
    if (!status || !body.packageId || !Array.isArray(body.selectedRecordIds) || !body.selectedRecordIds.length) throw new Error('Invalid promotion request');
    const action = status === 'BUILD_REQUESTED' ? 'validate' : 'promote';
    const reviewRunId = body.reviewRunId ? String(body.reviewRunId).trim() : '';
    const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const reference = String(body.approvalReference || `kpi-${new Date().toISOString()}`);
    const { error: saveError } = await service.from('kpi_package_promotions').upsert({ package_id: body.packageId, selected_record_ids: body.selectedRecordIds, status, approval_reference: reference, review_run_id: reviewRunId ? Number(reviewRunId) : null, requested_by: user.id, approved_by: user.id, updated_at: new Date().toISOString() }, { onConflict: 'package_id' });
    if (saveError) throw saveError;
    const token = Deno.env.get('GITHUB_WORKFLOW_TOKEN');
    const owner = Deno.env.get('GITHUB_OWNER');
    const repo = Deno.env.get('GITHUB_REPO');
    if (!token || !owner || !repo) throw new Error('Promotion worker is not configured');
    const dispatch = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/acquisition-frontend-promotion.yml/dispatches`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: Deno.env.get('GITHUB_REF') || 'main', inputs: { review_package: `promotion-artifacts/packages/${body.packageId}.json`, approval_reference: reference, selected_record_ids: body.selectedRecordIds.join(','), action, review_run_id: reviewRunId } }) });
    if (!dispatch.ok) throw new Error(`GitHub dispatch failed: ${dispatch.status}`);
    return new Response(JSON.stringify({ accepted: true, action, packageId: body.packageId, approvalReference: reference }), { headers: { ...cors, 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Promotion request failed' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
  }
});
