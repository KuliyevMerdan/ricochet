// FIXTURE — must NOT be flagged: the web shell's allow-list, Phaser included.
import { connect } from '@ricochet/netcode';
import { Arena } from '@ricochet/renderer';
import { decode } from '@ricochet/protocol';
import { vec } from '@ricochet/geom';
import { Game } from 'phaser';

export const ok = [connect, Arena, decode, vec, Game];
