import {
  el,
  escapeHtml,
  shortDate,
  totalSitesDiscovered
} from './utils.js';

import { state } from './state.js';

import db from './storage.js';
import {
  openSheet,
  renderIncomingRequests,
  renderLeaderboard,
  toast
} from './ui.js';
import { renderProfile } from './profile.js';

export async function setupOnline() {
  if (!onlineConfigured() || state.online.client) return;
  const config = onlineConfig();
  state.online.client = window.supabase.createClient(config.url, config.anonKey);
  const { data } = await state.online.client.auth.getSession();
  state.online.session = data.session;
  if (state.online.session) await loadRemoteProfile();
  state.online.client.auth.onAuthStateChange((_event, session) => {
    state.online.session = session;
    setTimeout(() => { if (session) void loadRemoteProfile(); else { state.online.remoteProfile = null; renderProfile(); } }, 0);
  });
}
  export async function openOnline() {
  await setupOnline();
  openSheet('onlineSheet');
  await renderOnline();
}
export async function loadRemoteProfile() {
  if (!state.online.client || !state.online.session) return null;
  const { data, error } = await state.online.client.from('profiles').select('id,username,total_points,miles_total,sites_discovered,updated_at').eq('id', state.online.session.user.id).maybeSingle();
  if (error) {
    if (/total_points|miles_total|sites_discovered|updated_at/.test(error.message || '')) throw new Error('Online profile schema needs migration: run supabase-migration-profiles.sql in the Supabase SQL Editor.');
    throw error;
  }
  state.online.remoteProfile = data || null;
  renderProfile();
  return data;
}
export async function syncProfile() {
  if (!state.online.client || !state.online.session || !state.online.remoteProfile?.username) return false;
  const payload = {
    id: state.online.session.user.id, username: state.online.remoteProfile.username,
    total_points: Math.round(state.profile.totalPoints), miles_total: Number(state.profile.milesTotal.toFixed(3)),
    sites_discovered: totalSitesDiscovered(state.profile), updated_at: new Date().toISOString()
  };
  const { data, error } = await state.online.client.from('profiles').upsert(payload).select().single();
  if (error) throw error;
  state.online.remoteProfile = data;
  state.settings.lastSyncedAt = new Date().toISOString();
  await db.put('settings', state.settings);
  renderProfile();
  return true;
}
export async function renderOnline() {
  const setup = el('onlineSetupPanel'), magic = el('magicLinkForm'), username = el('usernameForm'), dashboard = el('onlineDashboard');
  [setup, magic, username, dashboard].forEach((panel) => panel.classList.add('hidden'));
  if (!onlineConfigured()) { setup.classList.remove('hidden'); return; }
  if (!state.online.session) { magic.classList.remove('hidden'); return; }
  if (!state.online.remoteProfile?.username) { username.classList.remove('hidden'); return; }
  dashboard.classList.remove('hidden');
  el('onlineStatusText').textContent = state.settings.lastSyncedAt ? `Last synced ${shortDate(state.settings.lastSyncedAt)}` : 'Online — aggregate stats ready to sync';
  await refreshFriends();
  await refreshCohorts();
}
export async function signIn() {
  if (!onlineConfigured()) return;
  const email = el('onlineEmail').value.trim();
  const password = el('onlinePassword').value;
  if (!email || !password) { toast('Enter your email and password.'); return; }

  const { error } = await state.online.client.auth.signInWithPassword({ email, password });
  if (error) { toast(error.message); return; }

  await loadRemoteProfile();
  await renderOnline();
}

export async function signUp() {
  if (!onlineConfigured()) return;
  const email = el('onlineEmail').value.trim();
  const password = el('onlinePassword').value;
  if (!email || !password) { toast('Enter your email and password.'); return; }

  const { data, error } = await state.online.client.auth.signUp({ email, password });
  if (error) { toast(error.message); return; }
  if (!data.session) { toast('Account created — check your email to confirm before continuing.'); return; }

  await loadRemoteProfile();
  await renderOnline();
}
export async function createOnlineProfile(event) {
  event.preventDefault();
  if (!onlineConfigured()) return;
  const username = el('usernameInput').value.trim();
  if (!username) { toast('Enter a username.'); return; }
  const payload = {
    id: state.online.session.user.id,
    username,
    total_points: Math.round(state.profile.totalPoints),
    miles_total: Number(state.profile.milesTotal.toFixed(3)),
    sites_discovered: totalSitesDiscovered(state.profile),
    updated_at: new Date().toISOString()
  };
  const { data, error } = await state.online.client.from('profiles').upsert(payload).select().single();
  if (error) { toast(error.message.includes('unique') ? 'That username is already in use.' : error.message); return; }
  state.online.remoteProfile = data;
  state.settings.lastSyncedAt = new Date().toISOString();
  await db.put('settings', state.settings);
  renderProfile();
  await renderOnline();
  toast('Online profile created. Only aggregate stats can sync.');
}
export async function updateAccountUsername(event) {
  event.preventDefault();
  const username = el('accountUsernameInput').value.trim();
  if (!username) { toast('Enter a username.'); return; }
  const { data, error } = await state.online.client.from('profiles').update({ username, updated_at: new Date().toISOString() }).eq('id', state.online.session.user.id).select().single();
  if (error) { toast(error.message.includes('unique') ? 'That username is already in use.' : error.message); return; }
  state.online.remoteProfile = data;
  renderProfile();
  toast('Username updated.');
}
export async function updateAccountPhone(event) {
  event.preventDefault();
  toast('Phone numbers are not stored by this app.');
}
export async function updateAccountEmail(event) {
  event.preventDefault();
  const email = el('accountEmailInput').value.trim();
  const { error } = await state.online.client.auth.updateUser({ email });
  if (error) { toast(error.message); return; }
  toast('Check your new email inbox to confirm the change.');
}
export async function updateAccountPassword(event) {
  event.preventDefault();
  const password = el('accountPasswordInput').value;
  if (!password || password.length < 6) { toast('Password must be at least 6 characters.'); return; }
  const { error } = await state.online.client.auth.updateUser({ password });
  if (error) { toast(error.message); return; }
  el('accountPasswordInput').value = '';
  toast('Password updated.');
}
export async function acceptFriend(friendId) {
  const { error } = await state.online.client.from('friendships').update({ status: 'accepted' }).eq('user_id', friendId).eq('friend_id', state.online.session.user.id);
  if (error) { toast(error.message); return; }
  toast('Friend added to your leaderboard.'); await refreshFriends();
}
export async function refreshFriends() {
  if (!state.online.client || !state.online.session || !state.online.remoteProfile) return;
  const me = state.online.session.user.id;
  const { data: friendships, error } = await state.online.client.from('friendships').select('user_id,friend_id,status').or(`user_id.eq.${me},friend_id.eq.${me}`);
  if (error) { console.warn('Could not refresh friendships:', error.message); return; }
  const rows = friendships || [];
  const incoming = rows.filter((row) => row.friend_id === me && row.status === 'pending');
  const acceptedIds = rows.filter((row) => row.status === 'accepted').map((row) => row.user_id === me ? row.friend_id : row.user_id);
  let people = [state.online.remoteProfile];
  if (acceptedIds.length) {
    const { data: friends, error: friendsError } = await state.online.client.from('profiles').select('id,username,total_points,miles_total,sites_discovered,updated_at').in('id', acceptedIds);
    if (!friendsError) people = [...people, ...(friends || [])];
  }
  const incomingIds = incoming.map((row) => row.user_id);
  let requestProfiles = [];
  if (incomingIds.length) {
    const { data } = await state.online.client.from('profiles').select('id,username').in('id', incomingIds);
    requestProfiles = data || [];
  }
  state.online.leaderboard = people.sort((a, b) => (b.total_points || 0) - (a.total_points || 0));
  state.online.incoming = incoming.map((row) => ({ ...row, username: requestProfiles.find((profile) => profile.id === row.user_id)?.username || 'Friend' }));
  renderLeaderboard();
  renderIncomingRequests();
}
export async function findFriend(event) {
  event.preventDefault();
  const username = el('friendUsernameInput').value.trim();
  const { data, error } = await state.online.client.rpc('find_profile_by_username', { query_username: username });
  if (error) { toast(error.message); return; }
  const candidate = data?.[0];
  if (!candidate) { el('friendSearchResult').classList.add('hidden'); toast('No user found with that username.'); return; }
  if (candidate.id === state.online.session.user.id) { toast('That is your own profile.'); return; }
  state.online.candidate = candidate;
  el('friendSearchResult').innerHTML = `<div><strong>@${escapeHtml(candidate.username)}</strong><span>Send a private friend request</span></div><button class="secondary-button" id="sendFriendRequestButton">Add</button>`;
  el('friendSearchResult').classList.remove('hidden');
  el('sendFriendRequestButton').addEventListener('click', sendFriendRequest, { once: true });
}
export async function sendFriendRequest() {
  const candidate = state.online.candidate; if (!candidate) return;
  const { error } = await state.online.client.from('friendships').insert({ user_id: state.online.session.user.id, friend_id: candidate.id, status: 'pending' });
  if (error) { toast(error.code === '23505' ? 'A request already exists for this friend.' : error.message); return; }
  state.online.candidate = null; el('friendSearchResult').classList.add('hidden'); toast(`Friend request sent to @${candidate.username}.`);
}

export async function refreshCohorts() {
  const target = el('cohortList'); const choices = el('cohortIssueChoices');
  if (!target || !choices || !state.online.client || !state.online.session || !state.online.remoteProfile?.username) return;
  const [issuesResult, cohortsResult, membershipResult, requestsResult, messagesResult] = await Promise.all([
    state.online.client.from('issues').select('id,label').eq('is_active', true).order('label'),
    state.online.client.from('cohorts').select('id,name,neighborhood_id,cadence,organizer_discovery_opt_in,civic_neighborhoods(name,region_id),cohort_priorities(issue_id,issues(label))').order('created_at'),
    state.online.client.from('cohort_members').select('cohort_id,role').eq('user_id', state.online.session.user.id),
    state.online.client.from('organizer_interest_requests').select('id,neighborhood_id,issue_id,title,summary,official_url,expires_at,organizer_profiles(affiliation,profile_link)').eq('status', 'published').gt('expires_at', new Date().toISOString()),
    state.online.client.from('cohort_messages').select('cohort_id,author_id,body,created_at').order('created_at', { ascending: false }).limit(100)
  ]);
  if (issuesResult.error || cohortsResult.error || membershipResult.error || requestsResult.error) { target.innerHTML = '<p class="sheet-intro">Cohorts are not available yet. Confirm the cohort migration was run.</p>'; return; }
  state.online.cohortIssues = issuesResult.data || [];
  state.online.cohorts = cohortsResult.data || [];
  state.online.cohortRoles = new Map((membershipResult.data || []).map((membership) => [membership.cohort_id, membership.role]));
  state.online.organizerRequests = requestsResult.data || [];
  // Chat is an optional, separately migrated convenience. Its absence must
  // never make cohorts, invitations, or the rest of the app look unavailable.
  state.online.cohortMessages = messagesResult.error ? null : (messagesResult.data || []);
  choices.innerHTML = state.online.cohortIssues.map((issue) => `<label class="poi-chip"><input type="checkbox" name="cohortIssue" value="${escapeHtml(issue.id)}" /> ${escapeHtml(issue.label)}</label>`).join('');
  target.innerHTML = state.online.cohorts.length ? state.online.cohorts.map((cohort) => cohortCard(cohort)).join('') : '<p class="sheet-intro">No cohort yet. Create one for the issues your group chooses.</p>';
  const { data: invites } = await state.online.client.from('cohort_invites').select('id,cohort_id,cohorts(name,civic_neighborhoods(name))').eq('invited_user_id', state.online.session.user.id).eq('status', 'pending');
  const inviteTarget = el('cohortInviteList');
  inviteTarget.innerHTML = (invites || []).map((invite) => `<article class="route-card"><strong>Join ${escapeHtml(invite.cohorts?.name || 'a cohort')}</strong><p>${escapeHtml(invite.cohorts?.civic_neighborhoods?.name || 'Neighborhood cohort')}</p><button class="text-button" data-cohort-invite="accept" data-invite-id="${invite.id}">Accept</button><button class="text-button" data-cohort-invite="decline" data-invite-id="${invite.id}">Decline</button></article>`).join('');
  await refreshOrganizer();
}

function cohortCard(cohort) {
  const priorities = cohort.cohort_priorities || [];
  const issueIds = new Set(priorities.map((item) => item.issue_id));
  const matches = (state.online.organizerRequests || []).filter((request) => request.neighborhood_id === cohort.neighborhood_id && issueIds.has(request.issue_id));
  const friends = (state.online.leaderboard || []).filter((person) => person.id !== state.online.session.user.id);
  const facilitator = state.online.cohortRoles?.get(cohort.id) === 'facilitator';
  const invite = facilitator ? (friends.length ? `<form data-cohort-invite-form data-cohort-id="${cohort.id}" class="inline-form"><select aria-label="Friend to invite">${friends.map((friend) => `<option value="${friend.id}">@${escapeHtml(friend.username)}</option>`).join('')}</select><button class="secondary-button" type="submit">Invite friend</button></form>` : '<p class="sheet-intro">Add an accepted friend before inviting someone.</p>') : '';
  const controls = facilitator ? `<form data-cohort-settings-form data-cohort-id="${cohort.id}"><fieldset><legend>Facilitator controls</legend><label><input type="checkbox" name="cohortDiscoverable" ${cohort.organizer_discovery_opt_in ? 'checked' : ''} /> Allow matching organizer discovery</label><div class="poi-chips">${(state.online.cohortIssues || []).map((issue) => `<label class="poi-chip"><input type="checkbox" name="cohortPriority" value="${escapeHtml(issue.id)}" ${issueIds.has(issue.id) ? 'checked' : ''} /> ${escapeHtml(issue.label)}</label>`).join('')}</div><button class="text-button" type="submit">Save group priorities</button></fieldset></form>` : '';
  const requestCards = matches.map((request) => { const organizer = request.organizer_profiles; return `<div class="friend-result"><strong>${escapeHtml(request.title)}</strong><span>${organizer?.affiliation ? `${escapeHtml(organizer.affiliation)} — ` : ''}${escapeHtml(request.summary)}</span>${organizer?.profile_link ? `<a class="text-button" href="${escapeHtml(organizer.profile_link)}" target="_blank" rel="noreferrer">Organizer profile ↗</a>` : ''}<a class="text-button" href="${escapeHtml(request.official_url)}" target="_blank" rel="noreferrer">Learn more ↗</a>${facilitator ? `<button class="text-button" data-cohort-response="interested" data-cohort-id="${cohort.id}" data-request-id="${request.id}">Group is interested</button><button class="text-button" data-cohort-response="not_now" data-cohort-id="${cohort.id}" data-request-id="${request.id}">Not now</button>` : ''}</div>`; }).join('');
  const chatReady = Array.isArray(state.online.cohortMessages);
  const messages = (state.online.cohortMessages || []).filter((message) => message.cohort_id === cohort.id).slice(0, 8).reverse();
  const chat = `<section class="friend-result"><strong>Shared walk chat</strong><span>Visible only to cohort members. Keep locations and personal details out.</span>${chatReady ? (messages.map((message) => `<p><b>${message.author_id === state.online.session.user.id ? 'You' : 'A member'}:</b> ${escapeHtml(message.body)}</p>`).join('') || '<p>No messages yet.</p>') : '<p>Chat is not enabled for this cohort yet.</p>'}${chatReady ? `<form data-cohort-chat-form data-cohort-id="${cohort.id}" class="inline-form"><input maxlength="500" required aria-label="Message your cohort" placeholder="Share a walk detail…" /><button class="secondary-button" type="submit">Send</button></form>` : ''}</section>`;
  return `<article class="route-card"><p class="eyebrow">${escapeHtml(cohort.civic_neighborhoods?.name || 'Your neighborhood')}</p><strong>${escapeHtml(cohort.name)}</strong><p>${escapeHtml(cohort.cadence || 'Cadence not set')} · ${priorities.map((item) => escapeHtml(item.issues?.label || item.issue_id)).join(', ')}</p><p>Neighborhood code: <code>${escapeHtml(cohort.neighborhood_id)}</code></p><p>${cohort.organizer_discovery_opt_in ? 'Discoverable only to organizers with matching local requests.' : 'Private to your cohort.'}</p>${controls}${invite}${requestCards || '<p class="sheet-intro">No matching organizer requests right now.</p>'}${chat}</article>`;
}

export async function createCohort(event) {
  event.preventDefault();
  const name = el('cohortNameInput').value.trim(); const neighborhood = el('cohortNeighborhoodInput').value.trim();
  const issueIds = [...document.querySelectorAll('input[name="cohortIssue"]:checked')].map((input) => input.value);
  if (!name || !neighborhood || !issueIds.length) { toast('Name the group and neighborhood, then choose at least one issue.'); return; }
  const client = state.online.client;
  const { data: neighborhoodId, error: neighborhoodError } = await client.rpc('create_member_neighborhood', { neighborhood_name: neighborhood, selected_region_id: state.activeCity });
  if (neighborhoodError) { toast(neighborhoodError.message); return; }
  const { data: cohortId, error: cohortError } = await client.rpc('create_cohort', { cohort_name: name, cohort_neighborhood_id: neighborhoodId, cohort_cadence: el('cohortCadenceInput').value.trim() || null });
  if (cohortError) { toast(cohortError.message); return; }
  const priorities = issueIds.map((issue_id) => ({ cohort_id: cohortId, issue_id, set_by: state.online.session.user.id }));
  const { error: prioritiesError } = await client.from('cohort_priorities').insert(priorities);
  if (prioritiesError) { toast(`Cohort created, but priorities need retrying: ${prioritiesError.message}`); return; }
  const { error: discoveryError } = await client.from('cohorts').update({ organizer_discovery_opt_in: el('cohortDiscoveryOptIn').checked }).eq('id', cohortId);
  if (discoveryError) { toast(`Cohort created privately: ${discoveryError.message}`); }
  event.target.reset(); await refreshCohorts(); toast('Cohort created. Invite people privately; no route or civic witness data is shared.');
}

export async function respondToOrganizerRequest(button) {
  const { cohortId, requestId, cohortResponse } = button.dataset;
  const { error } = await state.online.client.from('cohort_interest_responses').upsert({ cohort_id: cohortId, request_id: requestId, response: cohortResponse, updated_by: state.online.session.user.id, updated_at: new Date().toISOString() });
  if (error) { toast(error.message); return; }
  toast(cohortResponse === 'interested' ? 'Saved as a cohort-level interest response.' : 'Saved as not now.');
}

export async function saveCohortSettings(form) {
  const cohortId = form.dataset.cohortId;
  const issueIds = [...form.querySelectorAll('input[name="cohortPriority"]:checked')].map((input) => input.value);
  if (!issueIds.length) { toast('Keep at least one cohort priority.'); return; }
  const client = state.online.client;
  const { error: updateError } = await client.from('cohorts').update({ organizer_discovery_opt_in: form.querySelector('input[name="cohortDiscoverable"]').checked }).eq('id', cohortId);
  if (updateError) { toast(updateError.message); return; }
  const { error: deleteError } = await client.from('cohort_priorities').delete().eq('cohort_id', cohortId);
  if (deleteError) { toast(deleteError.message); return; }
  const { error: insertError } = await client.from('cohort_priorities').insert(issueIds.map((issue_id) => ({ cohort_id: cohortId, issue_id, set_by: state.online.session.user.id })));
  if (insertError) { toast(insertError.message); return; }
  await refreshCohorts(); toast('Cohort priorities saved.');
}

export async function sendCohortMessage(form) {
  const input = form.querySelector('input');
  const { error } = await state.online.client.rpc('send_cohort_message', { target_cohort: form.dataset.cohortId, message_body: input.value });
  if (error) { toast(error.message); return; }
  input.value = ''; await refreshCohorts();
}

export async function inviteFriendToCohort(form) {
  const targetUser = form.querySelector('select').value;
  const { error } = await state.online.client.rpc('invite_friend_to_cohort', { target_cohort: form.dataset.cohortId, target_user: targetUser });
  toast(error ? error.message : 'Cohort invitation sent. Your friend chooses whether to join.');
}

export async function respondToCohortInvite(button) {
  const { error } = await state.online.client.rpc('respond_to_cohort_invite', { invite_id: button.dataset.inviteId, accept_invite: button.dataset.cohortInvite === 'accept' });
  if (error) { toast(error.message); return; }
  toast(button.dataset.cohortInvite === 'accept' ? 'You joined the cohort.' : 'Invitation declined.'); await refreshCohorts();
}

export async function refreshOrganizer() {
  const issueSelect = el('organizerIssueSelect'); const requestList = el('organizerRequestList');
  if (!issueSelect || !requestList || !state.online.client || !state.online.session) return;
  issueSelect.innerHTML = (state.online.cohortIssues || []).map((issue) => `<option value="${escapeHtml(issue.id)}">${escapeHtml(issue.label)}</option>`).join('');
  const [{ data: profile }, { data: requests, error }] = await Promise.all([
    state.online.client.from('organizer_profiles').select('affiliation,profile_link').eq('user_id', state.online.session.user.id).maybeSingle(),
    state.online.client.from('organizer_interest_requests').select('id,title,summary,official_url,expires_at,status').eq('organizer_id', state.online.session.user.id).order('created_at', { ascending: false })
  ]);
  if (profile) { el('organizerAffiliationInput').value = profile.affiliation || ''; el('organizerProfileLinkInput').value = profile.profile_link || ''; }
  requestList.innerHTML = error ? '' : (requests || []).map((request) => `<article class="route-card"><strong>${escapeHtml(request.title)}</strong><p>${escapeHtml(request.summary)}</p><p class="eyebrow">${escapeHtml(request.status)} · expires ${escapeHtml(shortDate(request.expires_at))}</p></article>`).join('');
}

export async function saveOrganizerProfile(event) {
  event.preventDefault();
  const affiliation = el('organizerAffiliationInput').value.trim(); const profile_link = el('organizerProfileLinkInput').value.trim();
  if (!affiliation || !/^https:\/\//i.test(profile_link)) { toast('Add an affiliation and a secure public profile link.'); return; }
  const { error } = await state.online.client.from('organizer_profiles').upsert({ user_id: state.online.session.user.id, affiliation, profile_link }, { onConflict: 'user_id' });
  if (error) { toast(error.message); return; }
  toast('Organizer profile saved. Cohorts decide whether to trust or respond.');
}

export async function createOrganizerRequest(event) {
  event.preventDefault();
  const payload = {
    organizer_id: state.online.session.user.id,
    neighborhood_id: el('organizerNeighborhoodInput').value.trim(), issue_id: el('organizerIssueSelect').value,
    title: el('organizerRequestTitleInput').value.trim(), summary: el('organizerRequestSummaryInput').value.trim(),
    official_url: el('organizerRequestLinkInput').value.trim(), expires_at: new Date(el('organizerRequestExpiryInput').value).toISOString(), status: 'published'
  };
  if (!payload.neighborhood_id || !payload.issue_id || !payload.title || !payload.summary || !/^https:\/\//i.test(payload.official_url) || Number.isNaN(Date.parse(payload.expires_at))) { toast('Complete every request field with an official HTTPS link and future expiry.'); return; }
  const { error } = await state.online.client.from('organizer_interest_requests').insert(payload);
  if (error) { toast(error.message); return; }
  event.target.reset(); await refreshOrganizer(); toast('Organizer request published for matching cohorts.');
}


export function onlineConfig() { return window.WALK_WILDLIFE_SUPABASE || {}; }
export function onlineConfigured() {
  const config = onlineConfig();
  return Boolean(config.url && config.anonKey && window.supabase?.createClient);
}
