// The match: rounds, money, the buy phase, the Spark (bomb) and the win conditions.
// Ember attacks and plants the Spark at the Kiln or the Silo; Vanta defends. A round
// ends when one team is eliminated, the Spark explodes, it is defused, or the timer
// runs out (defenders win on time). First to 5 round wins takes the match, at most 9
// rounds. Money is earned per round and per kill and spent in the buy phase.
import { SITES } from './world.js';

export const BUY_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const PLANT_SECONDS = 4;
export const DEFUSE_SECONDS = 5;
export const FUSE_SECONDS = 35;
export const WIN_ROUNDS = 5;
export const MAX_ROUNDS = 9;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const PLANT_REWARD = 300;

export function createMatch() {
  const state = {
    phase: 'buy', // buy | live | roundEnd | matchEnd
    phaseLeft: BUY_SECONDS,
    round: 1,
    wins: { ember: 0, vanta: 0 },
    money: 800,
    kills: 0,
    deaths: 0,
    spark: {
      state: 'carried', // carried | dropped | planted | exploded | defused
      site: null,
      position: null,
      fuseLeft: 0,
      plantProgress: 0,
      defuseProgress: 0,
      carrier: 'player',
    },
    roundWinner: null,
    roundReason: '',
    matchWinner: null,
    lastKillFeed: [],
  };

  function resetRound() {
    state.phase = 'buy';
    state.phaseLeft = BUY_SECONDS;
    state.spark = {
      state: 'carried', site: null, position: null, fuseLeft: 0,
      plantProgress: 0, defuseProgress: 0, carrier: 'player',
    };
    state.roundWinner = null;
    state.roundReason = '';
  }

  function startLive() {
    state.phase = 'live';
    state.phaseLeft = ROUND_SECONDS;
  }

  function endRound(winner, reason) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return false;
    state.roundWinner = winner;
    state.roundReason = reason;
    state.wins[winner] += 1;
    state.money += winner === 'ember' ? WIN_REWARD : LOSS_REWARD;
    if (state.wins[winner] >= WIN_ROUNDS || state.round >= MAX_ROUNDS) {
      state.phase = 'matchEnd';
      state.matchWinner = state.wins.ember > state.wins.vanta ? 'ember'
        : state.wins.vanta > state.wins.ember ? 'vanta' : 'draw';
      state.phaseLeft = 0;
    } else {
      state.phase = 'roundEnd';
      state.phaseLeft = 4;
    }
    return true;
  }

  function nextRound() {
    state.round += 1;
    resetRound();
  }

  function siteAt(position) {
    for (const [key, site] of Object.entries(SITES)) {
      if (Math.abs(position.x - site.center.x) <= site.half
        && Math.abs(position.z - site.center.z) <= site.half) return key;
    }
    return null;
  }

  function plantSpark(siteKey, position) {
    state.spark.state = 'planted';
    state.spark.site = siteKey;
    state.spark.position = position.clone();
    state.spark.fuseLeft = FUSE_SECONDS;
    state.spark.plantProgress = 0;
  }

  function dropSpark(position) {
    state.spark.state = 'dropped';
    state.spark.position = position.clone();
    state.spark.carrier = null;
  }

  function pickUpSpark(carrier) {
    state.spark.state = 'carried';
    state.spark.carrier = carrier;
    state.spark.position = null;
  }

  return {
    state,
    resetRound,
    startLive,
    endRound,
    nextRound,
    siteAt,
    plantSpark,
    dropSpark,
    pickUpSpark,
    addKillFeed(text) {
      state.lastKillFeed.unshift(text);
      if (state.lastKillFeed.length > 5) state.lastKillFeed.pop();
    },
  };
}
