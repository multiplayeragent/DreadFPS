// Multiplayer Agent config. The committed key is a placeholder on purpose.
// Your real key goes in mp.config.local.js (gitignored), which index.html loads after this file:
//   window.MP_CONFIG.key = 'pk_live_...';
// Someone starting from this repo gets their own key from remix_game or create_game.
window.MP_CONFIG = {
  key: 'pk_REPLACE_ME',
  endpoint: 'wss://live.multiplayeragent.com',
  apiUrl: 'https://api.multiplayeragent.com',
};
