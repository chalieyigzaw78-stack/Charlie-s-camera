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
  const remoteVideo = document.getElementById('remote-video');
  const connState = document.getElementById('conn-state');
  const hudStatus = document.getElementById('hud-status');
  const hudClock = document.getElementById('hud-clock');
  const statusLine = document.getElementById('status-line');
  const muteBtn = document.getElementById('mute-btn');
  const recordBtn = document.getElementById('record-btn');
  const retryBtn = document.getElementById('retry-btn');

  let socket, pc, localStream, remoteStream;
  let iceServers = null;
  let micOn = true;
  let startTime = null;
  let clockTimer = null;
  let mediaRecorder, recordedChunks = [];
  let isRecording = false;

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
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }

  function createPeerConnection() {
    pc = new RTCPeerConnection(iceServers);

    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    // Explicitly reserve a slot to receive video — without this, the offer only
    // contains an audio line (from our mic track) and the camera's video has
    // nowhere to go, even though it's being sent.
    pc.addTransceiver('video', { direction: 'recvonly' });

    remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    pc.ontrack = (event) => {
      remoteStream.addTrack(event.track);
      remoteVideo.play().catch(() => { /* will resume on next track/gesture */ });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('signal', { candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      connState.textContent = pc.connectionState.toUpperCase();
      if (pc.connectionState === 'connected') {
        hudStatus.textContent = '● LIVE';
        statusLine.textContent = 'Connected to camera.';
        if (!startTime) startClock();
      } else if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        hudStatus.textContent = '● OFFLINE';
        statusLine.textContent = 'Camera disconnected.';
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.connectionState !== 'connected') {
        statusLine.textContent = `Connecting... (ICE: ${pc.iceConnectionState}, gathering: ${pc.iceGatheringState})`;
      }
    };
  }

  async function startCall() {
    if (!pc) createPeerConnection();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { offer });
  }

  function connectSocket(pin) {
    socket = io();

    socket.on('connect', () => {
      socket.emit('join', { pin, role: 'viewer' });
    });

    socket.on('join-error', (msg) => {
      errorMsg.textContent = msg;
    });

    socket.on('joined', async () => {
      pinScreen.style.display = 'none';
      liveScreen.style.display = 'block';
      iceServers = await getIceServers();
      try {
        localStream = await getLocalStream();
      } catch (err) {
        statusLine.textContent = 'Mic access denied — you can still watch, but two-way talk is off.';
        localStream = new MediaStream();
      }
      statusLine.textContent = 'Waiting for camera...';
    });

    socket.on('camera-ready', () => {
      statusLine.textContent = 'Camera found. Connecting...';
      startCall();
    });

    socket.on('signal', async (data) => {
      if (data.answer) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) { /* ignore */ }
      }
    });

    socket.on('camera-disconnected', () => {
      connState.textContent = 'CAMERA OFFLINE';
      hudStatus.textContent = '● OFFLINE';
      statusLine.textContent = 'Camera disconnected. Waiting...';
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

  muteBtn.addEventListener('click', () => {
    micOn = !micOn;
    if (localStream) {
      localStream.getAudioTracks().forEach((t) => (t.enabled = micOn));
    }
    muteBtn.textContent = micOn ? '🎙️ Mic On' : '🔇 Mic Off';
    muteBtn.classList.toggle('active', micOn);
  });

  recordBtn.addEventListener('click', () => {
    if (!remoteStream || remoteStream.getTracks().length === 0) {
      statusLine.textContent = 'Nothing to record yet — wait for the video to connect.';
      return;
    }

    if (!isRecording) {
      recordedChunks = [];
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : 'video/webm';
      mediaRecorder = new MediaRecorder(remoteStream, { mimeType });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        a.href = url;
        a.download = `home-camera-${ts}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        statusLine.textContent = 'Clip saved to your downloads.';
      };

      mediaRecorder.start();
      isRecording = true;
      recordBtn.textContent = '⏹ Stop & Save';
      recordBtn.classList.add('active');
      statusLine.textContent = 'Recording...';
    } else {
      mediaRecorder.stop();
      isRecording = false;
      recordBtn.textContent = '⏺ Record';
      recordBtn.classList.remove('active');
    }
  });

  retryBtn.addEventListener('click', () => {
    statusLine.textContent = 'Retrying...';
    if (pc) {
      pc.close();
      pc = null;
    }
    startCall();
  });
})();
