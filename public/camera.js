(() => {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* ignore */ });
    });
  }

  const pinScreen = document.getElementById('pin-screen');
  const liveScreen = document.getElementById('live-screen');
  const pinInput = document.getElementById('pin');
  const joinBtn = document.getElementById('join-btn');
  const errorMsg = document.getElementById('error-msg');
  const localVideo = document.getElementById('local-video');
  const connState = document.getElementById('conn-state');
  const hudStatus = document.getElementById('hud-status');
  const hudClock = document.getElementById('hud-clock');
  const statusLine = document.getElementById('status-line');
  const flipBtn = document.getElementById('flip-btn');
  const muteBtn = document.getElementById('mute-btn');

  let socket, localStream;
  let iceServers = null;
  let facingMode = 'environment';
  let micOn = true;
  let startTime = null;
  let clockTimer = null;
  let wakeLock = null;

  // One RTCPeerConnection PER connected viewer, keyed by that viewer's socket id.
  // This is what lets several phones watch the same camera at once.
  const peerConnections = new Map();

  function fmtClock(ms) {
    const s = Math.floor(ms / 1000);
    const hh = String(Math.floor(s / 3600)).padStart(2, '0');
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  function startClock() {
    startTime = Date.now();
    clockTimer = setInterval(() => {
      hudClock.textContent = fmtClock(Date.now() - startTime);
    }, 1000);
  }

  function updateViewerStatus() {
    const connectedCount = [...peerConnections.values()].filter(
      (pc) => pc.connectionState === 'connected'
    ).length;

    if (connectedCount === 0) {
      connState.textContent = peerConnections.size > 0 ? 'CONNECTING' : 'WAITING FOR VIEWER';
      hudStatus.textContent = '● STANDBY';
    } else {
      connState.textContent = `${connectedCount} VIEWER${connectedCount > 1 ? 'S' : ''} LIVE`;
      hudStatus.textContent = '● LIVE';
    }
    statusLine.textContent = `${connectedCount} connected, ${peerConnections.size} connecting/known.`;
  }

  // Keeps the screen from auto-locking while this page is open and visible.
  // This is the only way a browser-based camera can be told to "not sleep" —
  // it can't run in the true background, so the screen has to stay on and
  // this tab has to stay in front for streaming to continue.
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (err) {
      // Not supported or denied — camera still works, screen just may sleep.
    }
  }

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      if (localStream) localVideo.srcObject = localStream;
      if (!wakeLock) await requestWakeLock();
    }
  });

  async function getLocalStream() {
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode },
      audio: true,
    });
  }

  async function startCamera() {
    localStream = await getLocalStream();
    localVideo.srcObject = localStream;
    startClock();
    await requestWakeLock();
  }

  function createPeerConnectionFor(viewerId) {
    const pc = new RTCPeerConnection(iceServers);
    peerConnections.set(viewerId, pc);

    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('signal', { to: viewerId, candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      updateViewerStatus();
      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        peerConnections.delete(viewerId);
        updateViewerStatus();
      }
    };

    return pc;
  }

  async function handleOffer(viewerId, offer) {
    let pc = peerConnections.get(viewerId);
    if (!pc) pc = createPeerConnectionFor(viewerId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('signal', { to: viewerId, answer });
    updateViewerStatus();
  }

  function connectSocket(pin) {
    socket = io();

    socket.on('connect', () => {
      socket.emit('join', { pin, role: 'camera' });
    });

    socket.on('join-error', (msg) => {
      errorMsg.textContent = msg;
    });

    socket.on('joined', async () => {
      pinScreen.style.display = 'none';
      liveScreen.style.display = 'block';
      try {
        iceServers = await getIceServers();
      } catch (err) {
        iceServers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
      }
      try {
        await startCamera();
      } catch (err) {
        statusLine.textContent = 'Camera/mic access denied. Check browser permissions.';
      }
    });

    socket.on('viewer-ready', ({ viewerId }) => {
      statusLine.textContent = 'A viewer is connecting...';
      // The viewer will send its offer shortly; the peer connection is created
      // lazily in handleOffer once that arrives.
    });

    socket.on('signal', async (data) => {
      const { from } = data;
      if (!from) return;
      if (data.offer) {
        await handleOffer(from, data.offer);
      } else if (data.candidate) {
        const pc = peerConnections.get(from);
        if (pc) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (e) { /* ignore */ }
        }
      }
    });

    socket.on('viewer-left', ({ viewerId }) => {
      const pc = peerConnections.get(viewerId);
      if (pc) {
        pc.close();
        peerConnections.delete(viewerId);
      }
      updateViewerStatus();
    });
  }

  joinBtn.addEventListener('click', () => {
    const pin = pinInput.value.trim();
    if (!pin) {
      errorMsg.textContent = 'Enter a PIN.';
      return;
    }
    errorMsg.textContent = '';
    connectSocket(pin);
  });

  flipBtn.addEventListener('click', async () => {
    const previousFacingMode = facingMode;
    facingMode = facingMode === 'environment' ? 'user' : 'environment';

    try {
      // Release the current camera FIRST — most phones can't run two camera
      // streams at once, so requesting a new one before this would silently fail.
      const oldVideoTrack = localStream.getVideoTracks()[0];
      if (oldVideoTrack) {
        oldVideoTrack.stop();
        localStream.removeTrack(oldVideoTrack);
      }

      const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } });
      const newVideoTrack = newStream.getVideoTracks()[0];
      localStream.addTrack(newVideoTrack);
      localVideo.srcObject = localStream;

      // Update every connected viewer's stream with the new camera, not just one.
      for (const pc of peerConnections.values()) {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
        if (sender) await sender.replaceTrack(newVideoTrack);
      }
    } catch (err) {
      facingMode = previousFacingMode;
      statusLine.textContent = 'Could not switch camera: ' + err.message;
    }
  });

  muteBtn.addEventListener('click', () => {
    micOn = !micOn;
    if (localStream) {
      // Toggling .enabled on the shared track affects every peer connection
      // sending it, so no per-viewer loop is needed here.
      localStream.getAudioTracks().forEach((t) => (t.enabled = micOn));
    }
    muteBtn.textContent = micOn ? '🎙️ Mic On' : '🔇 Mic Off';
    muteBtn.classList.toggle('active', micOn);
  });
})();
