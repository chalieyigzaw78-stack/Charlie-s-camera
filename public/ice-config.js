// ICE servers used by both camera and viewer to establish a peer-to-peer connection
// even when the two phones are on completely different networks.
// Includes Google's public STUN server plus a free public TURN relay (Open Relay Project)
// as a fallback for stricter networks (mobile data / carrier NAT / some WiFi routers).
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};
