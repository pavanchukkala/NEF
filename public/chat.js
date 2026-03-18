/*
  chat.js

  Provides text chat and voice chat functionality for Volt Surge.
  Text chat is built on top of the Firebase helpers exported from
  `network.js`.  Voice chat uses WebRTC to establish peer‑to‑peer
  audio streams between players.  Signalling is performed via
  Firebase as well, but the full implementation is beyond the scope
  of this example.  Stub functions are provided with guidance on
  how to extend them.
*/

import * as Network from './network.js';

// Text chat
export function initChat(lobbyCode, onMessages) {
  return Network.onChat(lobbyCode, msgs => {
    // Sort messages by timestamp ascending
    msgs.sort((a,b) => a.timestamp - b.timestamp);
    onMessages(msgs);
  });
}

export function sendMessage(lobbyCode, text) {
  return Network.sendChatMessage(lobbyCode, text);
}

// Voice chat
export async function initVoice(lobbyCode, localAudioEl, onRemoteStream) {
  /*
    Example usage:
      const local = document.getElementById('localAudio');
      initVoice(code, local, (stream) => {
        const remoteEl = document.createElement('audio');
        remoteEl.srcObject = stream;
        remoteEl.play();
        document.body.appendChild(remoteEl);
      });

    This function should perform the following steps:
      1. Call navigator.mediaDevices.getUserMedia({audio:true}) to obtain
         a local microphone stream.  Attach it to localAudioEl.
      2. Create a new RTCPeerConnection.
      3. Add the local audio track to the connection.
      4. Use Firebase to exchange offer/answer and ICE candidates
         between peers in the same lobby (using a dedicated
         signalling path under `voices/{code}/{uid}`).
      5. When a remote track arrives, call onRemoteStream(stream).

    To keep this template concise, these steps are not fully
    implemented.  If you wish to enable voice chat, you can use
    libraries such as simple-peer or implement your own signalling.
  */
  console.warn('Voice chat initialisation is not implemented in this skeleton.');
}