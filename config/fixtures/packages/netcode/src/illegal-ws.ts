// FIXTURE — must be rejected by `packages-no-server-libs`: netcode is handed its socket.
import { WebSocket } from 'ws';

export const leak = WebSocket;
