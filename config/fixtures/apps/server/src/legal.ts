// FIXTURE — must NOT be flagged: the server's whole allow-list and its libraries.
import { step } from '@ricochet/sim';
import { decide } from '@ricochet/bots';
import { decode } from '@ricochet/protocol';
import { vec } from '@ricochet/geom';
import { fastify } from 'fastify';
import { WebSocketServer } from 'ws';

export const ok = [step, decide, decode, vec, fastify, WebSocketServer];
