// WhatsApp call  <->  Kiki's Retell voice, with no browser and no Mac window.
//
// WhatsApp (through YCloud's calling API) hands us an SDP OFFER for each inbound call. We answer it
// with our own WebRTC endpoint (werift, pure JS), decode the caller's Opus audio, and feed it into a
// Retell web call that we join as a LiveKit participant (@livekit/rtc-node). Kiki's voice comes back
// out of that room, gets Opus-encoded, and goes down the WhatsApp leg. Audio is 48 kHz mono PCM in
// the middle; Opus frames are 20 ms (960 samples).
const { RTCPeerConnection, RTCRtpCodecParameters, MediaStreamTrack, RtpPacket, RtpHeader } = require('werift');
const OpusScript = require('opusscript');
const lk = require('@livekit/rtc-node');

const SR = 48000;
const FRAME = 960;                       // 20 ms at 48 kHz
const LK_URL = 'wss://retell-ai-4ihahnq7.livekit.cloud';

// ---------------------------------------------------------------- WhatsApp leg
async function createWaLeg(offerSdp, { onCallerPcm, log = () => {} } = {}) {
  const pc = new RTCPeerConnection({
    codecs: { audio: [new RTCRtpCodecParameters({ mimeType: 'audio/opus', clockRate: 48000, channels: 2, payloadType: 111 })] },
    iceUseIpv4: true, iceUseIpv6: false,
  });
  const dec = new OpusScript(SR, 1, OpusScript.Application.VOIP);
  const enc = new OpusScript(SR, 1, OpusScript.Application.VOIP);
  const out = new MediaStreamTrack({ kind: 'audio' });
  let seq = Math.floor(Math.random() * 30000), ts = Math.floor(Math.random() * 1e6), sent = 0, recv = 0, peak = 0;

  let _conn; const connected = new Promise(res => { _conn = res; });
  pc.connectionStateChange.subscribe(s => { log('wa leg: ' + s); if (s === 'connected') _conn(true); if (s === 'failed' || s === 'closed') _conn(false); });
  await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
  const tr = pc.getTransceivers()[0];
  tr.setDirection('sendrecv');
  await tr.sender.replaceTrack(out);
  const onT = (track) => {
    track.onReceiveRtp.subscribe(rtp => {
      if (rtp.header.payloadType !== 111 || !rtp.payload.length) return;   // skip DTMF/comfort noise
      try {
        const pcm = dec.decode(rtp.payload);                                // Buffer of int16 LE
        recv++; { let e = 0; const a = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2); for (const v of a) e += Math.abs(v); e /= a.length || 1; if (e > peak) peak = e; }
        // COPY into its own buffer: opusscript returns a view into a shared pool, and LiveKit reads the
        // frame's whole ArrayBuffer, so a view sends the wrong bytes (Retell heard nothing, 2026-10-14 test).
        onCallerPcm && onCallerPcm(Int16Array.from(new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2)));
      } catch (_) {}
    });
  };
  let hooked = false;
  const hook = (track) => { if (hooked || !track || track.kind !== 'audio') return; hooked = true; log('wa leg: caller track up'); onT(track); };
  tr.onTrack.subscribe(hook);
  pc.onTrack.subscribe(hook);
  if (tr.receiver && tr.receiver.track) hook(tr.receiver.track);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await new Promise(res => { if (pc.iceGatheringState === 'complete') return res(); const s = pc.iceGatheringStateChange.subscribe(st => { if (st === 'complete') { s.unSubscribe(); res(); } }); setTimeout(res, 3000); });

  let pend = new Int16Array(0);
  function sendPcm(samples) {                                              // any length; sent in 20 ms Opus frames
    const all = new Int16Array(pend.length + samples.length); all.set(pend); all.set(samples, pend.length);
    let off = 0;
    for (; off + FRAME <= all.length; off += FRAME) {
      const frame = Buffer.from(all.buffer, all.byteOffset + off * 2, FRAME * 2);
      const payload = enc.encode(frame, FRAME);
      out.writeRtp(new RtpPacket(new RtpHeader({ payloadType: 111, sequenceNumber: seq = (seq + 1) & 0xffff, timestamp: ts = (ts + FRAME) >>> 0, marker: sent === 0 }), payload));
      sent++;
    }
    pend = all.slice(off);
  }
  return {
    answerSdp: pc.localDescription.sdp, pc, sendPcm, connected,
    stats: () => ({ sent, recv, callerPeak: Math.round(peak), state: pc.connectionState }),
    close: async () => { try { await pc.close(); } catch (_) {} try { dec.delete(); enc.delete(); } catch (_) {} },
  };
}

// ---------------------------------------------------------------- Retell leg
async function createRetellLeg({ apiKey, agentId, metadata = {}, onAgentPcm, log = () => {} }) {
  const r = await fetch('https://api.retellai.com/v2/create-web-call', {
    method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: agentId, metadata }),
  });
  const call = await r.json();
  if (!call.access_token) throw new Error('retell create-web-call ' + r.status + ' ' + JSON.stringify(call).slice(0, 200));
  const room = new lk.Room();
  let heard = 0, spoke = 0, errs = 0;
  room.on(lk.RoomEvent.TrackSubscribed, async (track) => {
    if (track.kind !== lk.TrackKind.KIND_AUDIO) return;
    const stream = new lk.AudioStream(track, SR, 1);
    for await (const frame of stream) { spoke++; onAgentPcm && onAgentPcm(frame.data); }
  });
  await room.connect(LK_URL, call.access_token, { autoSubscribe: true, dynacast: false });
  const source = new lk.AudioSource(SR, 1);
  const track = lk.LocalAudioTrack.createAudioTrack('caller', source);
  const opts = new lk.TrackPublishOptions(); opts.source = lk.TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant.publishTrack(track, opts);
  log('retell leg: joined ' + call.call_id);
  return {
    callId: call.call_id,
    sendPcm: (samples) => { heard++; source.captureFrame(new lk.AudioFrame(samples, SR, 1, samples.length)).catch(e => { if (!errs++) log('retell leg: captureFrame failed: ' + (e && e.message)); }); },
    stats: () => ({ heard, spoke }),
    close: async () => { try { await room.disconnect(); } catch (_) {} },
  };
}

// ---------------------------------------------------------------- the whole call
async function bridgeCall(offerSdp, { apiKey, agentId, metadata, log = () => {} }) {
  let retell = null;
  const wa = await createWaLeg(offerSdp, { log, onCallerPcm: pcm => retell && retell.sendPcm(pcm) });
  retell = await createRetellLeg({ apiKey, agentId, metadata, log, onAgentPcm: pcm => wa.sendPcm(pcm) });
  return {
    answerSdp: wa.answerSdp, retellCallId: retell.callId,
    stats: () => ({ wa: wa.stats(), retell: retell.stats() }),
    close: async () => { await retell.close(); await wa.close(); },
  };
}

module.exports = { createWaLeg, createRetellLeg, bridgeCall };
