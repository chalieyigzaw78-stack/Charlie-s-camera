(() => {
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

  let socket, pc, localStream;
  let facingMode = 'environment';
  let micOn = true;
  let startTime = null;
  let clockTimer = null;

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

  async function getLocalStream() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode },
      audio: true,
    });
    return stream;
  }

  async function startCamera() {
    localStream = await getLocalStream();
    localVideo.srcObject = localStream;
    startClock();
  }

  function createPeerConnection() {
    pc = new RTCPeerConnection(ICE_SERVERS);

    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('signal', { candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      connState.textContent = pc.connectionState.toUpperCase();
      if (pc.connectionState === 'connected') {
        hudStatus.textContent = '● LIVE';
        statusLine.textContent = 'Viewer connected.';
      } else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        hudStatus.textContent = '● STANDBY';
        statusLine.textContent = 'Waiting for viewer to reconnect...';
      }
    };
  }

  async function handleOffer(offer) {
    if (!pc) createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('signal', { answer });
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
        await startCamera();
      } catch (err) {
        statusLine.textContent = 'Camera/mic access denied. Check browser permissions.';
      }
    });

    socket.on('viewer-ready', () => {
      statusLine.textContent = 'Viewer is connecting...';
    });

    socket.on('signal', async (data) => {
      if (data.offer) {
        await handleOffer(data.offer);
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) { /* ignore */ }
      }
    });

    socket.on('viewer-disconnected', () => {
      connState.textContent = 'WAITING FOR VIEWER';
      hudStatus.textContent = '● STANDBY';
      statusLine.textContent = 'Viewer disconnected.';
      if (pc) { pc.close(); pc = null; }
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
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    const newStream = await getLocalStream();
    const newVideoTrack = newStream.getVideoTracks()[0];

    if (pc) {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === 'video');
      if (sender) sender.replaceTrack(newVideoTrack);
    }

    // Stop old video track, keep using old audio track to avoid re-negotiating audio
    const oldVideoTrack = localStream.getVideoTracks()[0];
    if (oldVideoTrack) oldVideoTrack.stop();
    localStream.removeTrack(oldVideoTrack);
    localStream.addTrack(newVideoTrack);
    localVideo.srcObject = localStream;

    // Stop the extra audio track from the new getUserMedia call since we keep the original
    newStream.getAudioTracks().forEach((t) => t.stop());
  });

  muteBtn.addEventListener('click', () => {
    micOn = !micOn;
    if (localStream) {
      localStream.getAudioTracks().forEach((t) => (t.enabled = micOn));
    }
    muteBtn.textContent = micOn ? '🎙️ Mic On' : '🔇 Mic Off';
    muteBtn.classList.toggle('active', micOn);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && localStream) {
      // Re-attach in case the browser paused the video element in the background
      localVideo.srcObject = localStream;
    }
  });
})();
