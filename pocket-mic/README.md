# Pocket Mic

Pocket Mic is a small, private-network WebRTC audio bridge for using an iPhone
as a nearby microphone and speaker while working on a remote computer.

It intentionally carries audio only. There is no transcription, captioning,
chat-text transport, or RustDesk audio dependency.

## What is included

- `index.html`, `app.js`, and `styles.css`: a phone/receiver browser client.
- `server.mjs`: a dependency-free static server and short-lived polling
  signaling relay. It can listen on a Tailscale interface or run behind an
  HTTPS proxy.
- `docs/host-audio-adapter.md`: the remaining platform-specific step for
  exposing the WebRTC audio to a computer's system input/output devices.

The browser slice is deliberately useful without a virtual audio driver:

1. Safari sends the iPhone microphone to the receiver browser.
2. The receiver browser plays that microphone audio.
3. The receiver can share selected computer/tab audio back to Safari.
4. The phone browser plays the returned audio.

On the current Windows machine, VB-Audio Virtual Cable is already installed.
The receiver automatically selects its `CABLE Input` playback endpoint when
the browser exposes output-device selection; Windows then presents the same
audio as the `CABLE Output` capture endpoint for desktop apps.

## Run it on a remote computer

From the repository root:

```powershell
node pocket-mic/server.mjs --host 0.0.0.0 --port 8787
```

Open the server through a private Tailscale HTTPS endpoint. `getUserMedia()`
requires a secure browser context on an iPhone; `localhost` is the exception,
but a Tailscale IP over plain HTTP is not. An existing Tailscale HTTPS/serve
setup or a local TLS certificate can front port `8787`.

On both devices, open the same URL and enter the same short room code. Choose
`Phone` on the iPhone and `Remote computer` on the computer. Start the phone
first and grant microphone permission. On the computer, choose whether to
share computer/tab audio when prompted; browser capture support varies by
browser and by the selected share surface.

On the remote computer, select `CABLE Output (VB-Audio Virtual Cable)` as
ChatGPT's microphone/input. Keep the Pocket Mic receiver's phone-audio sink
set to `CABLE Input (VB-Audio Virtual Cable)`. For the return direction, share
the ChatGPT tab and include its audio when the browser prompts; the receiver
then sends that captured track to Safari.

## Manual smoke checklist

1. Start the server on the remote computer and open its private HTTPS URL in
   both browsers.
2. Enter the same room code. Start `Phone` first and grant Safari microphone
   permission; start `Remote computer` second.
3. Confirm the receiver plays the phone microphone. Its output selector should
   show `CABLE Input (VB-Audio Virtual Cable)`; leave that selected.
4. In ChatGPT's voice/audio settings, select
   `CABLE Output (VB-Audio Virtual Cable)` as the microphone/input. Speak on
   the iPhone and confirm the ChatGPT input meter moves.
5. Start a ChatGPT voice response, share the ChatGPT tab from the receiver
   page, and include tab audio. Confirm the phone's returned-audio control
   plays the response.
6. Switch the iPhone to RustDesk and speak again. Confirm the receiver still
   receives audio during the local Safari background-behavior check. RustDesk
   is only the visual-control channel in this setup.

If tab audio capture is unavailable, one VB-CABLE direction is still enough
for phone → ChatGPT. The return direction then needs a browser/OS loopback
capture of the ChatGPT playback device; a second virtual cable may be useful
for that layout, but it is not required when browser tab-audio capture works.

For a local smoke test, use two browser windows at `http://localhost:8787/`.
The phone microphone permission prompt is expected to require HTTPS on a real
iPhone.

## Server options

```text
--host <address>       Bind address (default: 127.0.0.1)
--port <number>        HTTP/HTTPS port (default: 8787)
--tls-key <path>       Optional PEM private key; enables HTTPS with --tls-cert
--tls-cert <path>      Optional PEM certificate; enables HTTPS with --tls-key
```

The relay stores only in-memory signaling messages and removes inactive rooms
after ten minutes. It does not persist audio or signaling records.

## Current limitations

- The relay is intentionally a small single-process prototype. Put it behind
  Tailscale access controls and an HTTPS endpoint; do not expose it publicly.
- Browser audio capture is controlled by browser permission prompts and the
  selected share surface.
- VB-Audio Virtual Cable is the host adapter on the current machine; exact
  endpoint selection and browser support are documented in
  `docs/host-audio-adapter.md`.
- This prototype does not use RustDesk audio. RustDesk can remain the visual
  remote-control channel.

