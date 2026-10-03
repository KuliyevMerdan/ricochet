// FIXTURE — must be rejected by `phaser-stays-on-stage`: the world's physics is sim's, not Phaser's.
import { Physics } from 'phaser';

export const leak = Physics;
