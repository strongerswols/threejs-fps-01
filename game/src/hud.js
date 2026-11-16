// The HUD: every number the player needs, in DOM so it stays crisp over the canvas.
// Health and ammo bottom corners, timer and score on top, money beside the ammo, the
// kill feed top right, and overlays for start, pause, buy, round end and match end.
// The buy menu is a real DOM panel with prices; the player buys with keys 1-4.
import { WEAPONS, GRENADE_PRICE } from './weapons.js';

const $ = (id) => document.getElementById(id);

export function createHud(callbacks) {
  const els = {
    healthValue: $('health-value'),
    healthBar: $('health-bar'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    ammo: $('ammo'),
    money: $('money-value'),
    weaponName: $('weapon-name'),
    timer: $('timer'),
    scoreEmber: $('score-ember'),
    scoreVanta: $('score-vanta'),
    aliveEmber: $('alive-ember'),
    aliveVanta: $('alive-vanta'),
    roundLabel: $('round-label'),
    killfeed: $('killfeed'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    hitmarkerHead: $('hitmarker-head'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    overlay: $('overlay'),
    overlayTitle: $('overlay-title'),
    overlayCopy: $('overlay-copy'),
    play: $('play'),
    buy: $('buy'),
    buyMoney: $('buy-money'),
    progress: $('progress'),
    progressFill: $('progress-fill'),
    progressLabel: $('progress-label'),
    bombStatus: $('bomb-status'),
    sparkHint: $('spark-hint'),
  };

  let hitTimer = 0;

  function setHealth(health) {
    els.healthValue.textContent = String(Math.max(0, Math.ceil(health)));
    els.healthBar.style.width = `${Math.max(0, Math.min(100, health))}%`;
    els.healthBar.classList.toggle('low', health <= 30);
  }

  function setAmmo(mag, reserve) {
    els.ammoMag.textContent = String(mag);
    els.ammoReserve.textContent = `/ ${reserve}`;
    els.ammo.classList.toggle('empty', mag === 0);
  }

  function setWeapon(name, grenades) {
    els.weaponName.textContent = grenades > 0 ? `${name}  ·  ${grenades}× Spark Grenade` : name;
  }

  function setMoney(money) {
    els.money.textContent = `$${money.toLocaleString('en-US')}`;
    els.buyMoney.textContent = `$${money.toLocaleString('en-US')}`;
  }

  function setTimer(seconds) {
    const safe = Math.max(0, Math.ceil(seconds));
    els.timer.textContent = `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
    els.timer.classList.toggle('urgent', safe <= 10);
  }

  function setScore(ember, vanta, round) {
    els.scoreEmber.textContent = String(ember);
    els.scoreVanta.textContent = String(vanta);
    els.roundLabel.textContent = `Round ${round}`;
  }

  function setAlive(ember, vanta) {
    els.aliveEmber.textContent = '●'.repeat(Math.max(0, ember));
    els.aliveVanta.textContent = '●'.repeat(Math.max(0, vanta));
  }

  function setKillfeed(lines) {
    els.killfeed.innerHTML = lines.map((line) => `<div>${line}</div>`).join('');
  }

  function setSpread(spread) {
    // The crosshair opens up with spread, so the player sees accuracy at a glance.
    const gap = 4 + Math.min(26, spread * 900);
    els.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
  }

  function hitMarker(headshot) {
    els.hitmarker.classList.add('on');
    els.hitmarkerHead.classList.toggle('on', headshot);
    window.clearTimeout(hitTimer);
    hitTimer = window.setTimeout(() => {
      els.hitmarker.classList.remove('on');
      els.hitmarkerHead.classList.remove('on');
    }, 110);
  }

  function showBanner(title, sub) {
    els.bannerTitle.textContent = title;
    els.bannerSub.textContent = sub;
    els.banner.hidden = false;
  }

  function hideBanner() {
    els.banner.hidden = true;
  }

  function showOverlay(kind, data = {}) {
    els.overlay.hidden = false;
    els.buy.hidden = true;
    if (kind === 'start') {
      els.overlayTitle.textContent = 'EMBERLINE';
      els.overlayCopy.textContent = 'Dustline Yard — Ember attacks, Vanta defends. Plant the Spark at the Kiln or the Silo, or wipe the defenders out. First to 5 rounds takes the yard.';
      els.play.textContent = 'Click to play';
    } else if (kind === 'paused') {
      els.overlayTitle.textContent = 'Paused';
      els.overlayCopy.textContent = 'Click to keep playing.';
      els.play.textContent = 'Resume';
    } else if (kind === 'dead') {
      els.overlayTitle.textContent = 'You are down';
      els.overlayCopy.textContent = 'Your team fights on. The next round starts soon.';
      els.play.textContent = 'Watch';
    } else if (kind === 'matchEnd') {
      els.overlayTitle.textContent = data.winner === 'ember' ? 'Ember takes the yard' : data.winner === 'vanta' ? 'Vanta holds the yard' : 'A dead heat';
      els.overlayCopy.textContent = `Final score ${data.ember} — ${data.vanta}. Play again from round one.`;
      els.play.textContent = 'Play again';
    }
  }

  function hideOverlay() {
    els.overlay.hidden = true;
    els.buy.hidden = true;
  }

  function showBuy(money, owned) {
    els.overlay.hidden = true;
    els.buy.hidden = false;
    els.buyMoney.textContent = `$${money.toLocaleString('en-US')}`;
    for (const [id, def] of Object.entries(WEAPONS)) {
      const row = $(`buy-${id}`);
      if (!row) continue;
      row.querySelector('.buy-price').textContent = def.price === 0 ? 'Owned' : `$${def.price}`;
      row.classList.toggle('owned', owned.includes(id));
      row.classList.toggle('unaffordable', def.price > money && !owned.includes(id));
    }
    const grenadeRow = $('buy-grenade');
    grenadeRow.querySelector('.buy-price').textContent = `$${GRENADE_PRICE}`;
    grenadeRow.classList.toggle('unaffordable', GRENADE_PRICE > money);
  }

  function hideBuy() {
    els.buy.hidden = true;
  }

  function setProgress(label, fraction) {
    if (!label) {
      els.progress.hidden = true;
      return;
    }
    els.progress.hidden = false;
    els.progressLabel.textContent = label;
    els.progressFill.style.width = `${Math.round(fraction * 100)}%`;
  }

  function setBombStatus(text) {
    els.bombStatus.textContent = text;
    els.bombStatus.hidden = !text;
  }

  function setSparkHint(text) {
    els.sparkHint.textContent = text;
    els.sparkHint.hidden = !text;
  }

  els.play.addEventListener('click', () => callbacks.onPlay());
  document.addEventListener('keydown', (event) => {
    if (event.code === 'KeyB') callbacks.onBuyToggle();
    if (event.code === 'Digit1') callbacks.onBuy('pistol');
    if (event.code === 'Digit2') callbacks.onBuy('rifle');
    if (event.code === 'Digit3') callbacks.onBuy('smg');
    if (event.code === 'Digit4') callbacks.onBuy('grenade');
  });

  return {
    setHealth,
    setAmmo,
    setWeapon,
    setMoney,
    setTimer,
    setScore,
    setAlive,
    setKillfeed,
    setSpread,
    hitMarker,
    showBanner,
    hideBanner,
    showOverlay,
    hideOverlay,
    showBuy,
    hideBuy,
    setProgress,
    setBombStatus,
    setSparkHint,
  };
}
