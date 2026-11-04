const $ = (id) => document.getElementById(id);
const roleEl = $('role');
const roomEl = $('room');
const shareEl = $('share-audio');
const audioSinkEl = $('audio-sink');
const startEl = $('start');
const stopEl = $('stop');
const statusEl = $('status');
const phoneAudioEl = $('phone-audio');
const returnAudioEl = $('return-audio');
const phoneDot = $('phone-dot');
const returnDot = $('return-dot');

let peer;
let localStream;
let outgoingAudioTrack;
let polling = false;
let pollTimer;
let signalCursor = 0;
let pendingCandidates = [];
let room;
let activeRole;

function setStatus(message) { statusEl.textContent = message; }
function apiPath(path) { return `./api/rooms/${encodeURIComponent(room)}${path}`; }

function updateRoleControls() {
  const receiver = roleEl.value === 'receiver';
  document.querySelectorAll('.receiver-only').forEach((node) => { node.hidden = !receiver; });
}

async function signal(type, payload, to) {
  const response = await fetch(apiPath('/signal'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: activeRole, to, type, payload }),
  });
  if (!response.ok) throw new Error(`Signaling failed (${response.status})`);
}

async function flushCandidates() {
  if (!peer?.remoteDescription) return;
  const candidates = pendingCandidates.splice(0);
  for (const candidate of candidates) await peer.addIceCandidate(candidate);
}

async function handleSignal(message) {
  if (message.type === 'ice') {
    const candidate = new RTCIceCandidate(message.payload);
    if (peer?.remoteDescription) await peer.addIceCandidate(candidate);
    else pendingCandidates.push(candidate);
    return;
  }

  if (activeRole === 'phone' && message.type === 'answer') {
    await peer.setRemoteDescription(message.payload);
    await flushCandidates();
    setStatus('Connected. The receiver is getting the phone microphone.');
    return;
  }

  if (activeRole === 'receiver' && message.type === 'offer') {
    await peer.setRemoteDescription(message.payload);
    const transceiver = peer.getTransceivers().find((item) => item.receiver?.track?.kind === 'audio');
    if (transceiver) {
      transceiver.direction = 'sendrecv';
      if (outgoingAudioTrack) await transceiver.sender.replaceTrack(outgoingAudioTrack);
    }
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    await signal('answer', peer.localDescription, 'phone');
    await flushCandidates();
    setStatus(outgoingAudioTrack ? 'Connected in both directions.' : 'Connected. Phone audio is playing here.');
  }
}

async function pollSignals() {
  if (!polling) return;
  try {
    const response = await fetch(apiPath(`/signals?for=${activeRole}&after=${signalCursor}`), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Polling failed (${response.status})`);
    const data = await response.json();
    signalCursor = data.nextCursor ?? signalCursor;
    for (const message of data.messages || []) await handleSignal(message);
  } catch (error) {
    if (polling) setStatus(error.message || 'The signaling connection failed.');
  } finally {
    if (polling) pollTimer = window.setTimeout(pollSignals, 700);
  }
}

async function captureComputerAudio() {
  if (!shareEl.checked) return null;
  if (!navigator.mediaDevices?.getDisplayMedia) {
    setStatus('This browser cannot capture computer audio; continuing one-way.');
    return null;
  }
  const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  const track = displayStream.getAudioTracks()[0] || null;
  displayStream.getVideoTracks().forEach((videoTrack) => videoTrack.stop());
  if (!track) {
    setStatus('No shared audio track was selected; continuing one-way.');
    return null;
  }
  track.addEventListener('ended', () => setStatus('Computer audio sharing ended.'));
  return track;
}

async function refreshAudioSinks() {
  if (!navigator.mediaDevices?.enumerateDevices || typeof phoneAudioEl.setSinkId !== 'function') {
    audioSinkEl.innerHTML = '<option value="default">Default computer speakers (browser cannot select an output)</option>';
    return;
  }
  const outputs = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audiooutput');
  audioSinkEl.innerHTML = '';
  for (const device of outputs) {
    const option = document.createElement('option');
    option.value = device.deviceId || 'default';
    option.textContent = device.label || (device.deviceId ? 'Audio output' : 'Default computer speakers');
    audioSinkEl.append(option);
  }
  const cable = outputs.find((device) => /CABLE Input/i.test(device.label));
  if (cable) {
    audioSinkEl.value = cable.deviceId;
    await phoneAudioEl.setSinkId(cable.deviceId);
    setStatus('VB-CABLE detected. Phone microphone will feed CABLE Output for desktop apps.');
  }
}

async function startPhone() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not expose microphone access.');
  localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  const transceiver = peer.addTransceiver('audio', { direction: 'sendrecv' });
  await transceiver.sender.replaceTrack(localStream.getAudioTracks()[0]);
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  await signal('offer', peer.localDescription, 'receiver');
  setStatus('Microphone permission granted. Waiting for the remote computer…');
}

async function startReceiver() {
  setStatus('Choose the browser tab or screen whose audio should return to the phone.');
  outgoingAudioTrack = await captureComputerAudio();
  setStatus('Waiting for the phone microphone…');
}

async function start() {
  if (polling) return;
  room = roomEl.value.trim().toLowerCase();
  activeRole = roleEl.value;
  if (!room) throw new Error('Enter a room code first.');
  if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(room)) throw new Error('Use 2–32 letters, numbers, or hyphens for the room code.');

  peer = new RTCPeerConnection({ iceServers: [] });
  peer.onicecandidate = (event) => {
    if (event.candidate) signal('ice', event.candidate.toJSON(), activeRole === 'phone' ? 'receiver' : 'phone').catch((error) => setStatus(error.message));
  };
  peer.onconnectionstatechange = () => {
    if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) setStatus(`Connection ${peer.connectionState}.`);
  };
  peer.ontrack = (event) => {
    const stream = event.streams[0] || new MediaStream([event.track]);
    if (activeRole === 'receiver') {
      phoneAudioEl.srcObject = stream;
      phoneAudioEl.play().catch(() => setStatus('Press play on the receiver audio control to hear the phone microphone.'));
      phoneDot.classList.add('live');
    } else {
      returnAudioEl.srcObject = stream;
      returnAudioEl.play().catch(() => setStatus('Press play on the phone audio control to hear returned computer audio.'));
      returnDot.classList.add('live');
    }
  };

  polling = true;
  startEl.disabled = true;
  stopEl.disabled = false;
  roleEl.disabled = true;
  roomEl.disabled = true;
  pollSignals();
  if (activeRole === 'phone') await startPhone();
  else {
    await refreshAudioSinks();
    await startReceiver();
  }
}

function stop() {
  polling = false;
  window.clearTimeout(pollTimer);
  localStream?.getTracks().forEach((track) => track.stop());
  outgoingAudioTrack?.stop();
  peer?.close();
  localStream = null;
  outgoingAudioTrack = null;
  phoneAudioEl.srcObject = null;
  returnAudioEl.srcObject = null;
  phoneDot.classList.remove('live');
  returnDot.classList.remove('live');
  startEl.disabled = false;
  stopEl.disabled = true;
  roleEl.disabled = false;
  roomEl.disabled = false;
  setStatus('Stopped.');
}

audioSinkEl.addEventListener('change', () => {
  if (typeof phoneAudioEl.setSinkId !== 'function') return;
  phoneAudioEl.setSinkId(audioSinkEl.value).catch((error) => setStatus(`Could not select audio output: ${error.message}`));
});

roleEl.addEventListener('change', updateRoleControls);
startEl.addEventListener('click', () => start().catch((error) => { stop(); setStatus(error.message || 'Could not start the bridge.'); }));
stopEl.addEventListener('click', stop);
updateRoleControls();
