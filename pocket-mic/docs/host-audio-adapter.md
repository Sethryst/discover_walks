# Host audio adapter: VB-Audio Virtual Cable

The current Windows machine has `VB-Audio Virtual Cable` installed and its
endpoints are present and healthy:

```text
Playback/render: CABLE Input (VB-Audio Virtual Cable)
Recording/capture: CABLE Output (VB-Audio Virtual Cable)
```

The browser receiver uses `HTMLAudioElement.setSinkId()` when available and
auto-selects `CABLE Input`. The audio that the receiver plays for the phone
therefore appears to Windows as `CABLE Output` for desktop applications.

## Windows adapter contract

The remaining adapter should provide these two independent directions:

```text
WebRTC incoming phone audio  ->  virtual microphone/input endpoint
ChatGPT/browser output       ->  captured loopback audio -> WebRTC sender
```

For ChatGPT on the remote computer, select `CABLE Output` as the microphone
input. This is the capture side of the cable and receives the phone track from
the Pocket Mic receiver.

For a reliable return path, share the ChatGPT browser tab with audio enabled
when the receiver prompts. The receiver sends that captured audio track to the
phone. If the browser cannot share tab audio, route ChatGPT's playback to
`CABLE Input` and use a browser/OS loopback capture that can publish the
`CABLE Input` render stream; this is browser- and OS-specific and is not
assumed by the prototype.

One VB-CABLE instance is therefore sufficient for the phone-to-ChatGPT
direction. A second cable is optional rather than automatic: it is only useful
if the return path is being built as a separate OS-level loopback route rather
than using browser tab-audio capture.

## Safe manual bridge for this prototype

Use the receiver page with the installed cable as the audio endpoint:

- the phone microphone is audible from the receiver page;
- select the computer/tab audio share option to send remote audio back to the
  phone;
- select `CABLE Output` as ChatGPT's microphone/input;
- select the desired ChatGPT playback device, then share its tab audio to the
  receiver when possible.

The expected Windows endpoint pairing is:

```text
Receiver phone-audio sink  -> CABLE Input (Playback)
ChatGPT microphone         -> CABLE Output (Recording)
ChatGPT response return    -> shared ChatGPT tab audio, or an OS loopback
```

This confirms the network, permissions, and WebRTC behavior without changing
the computer's global audio routing.
