// Keyboard and mouse, and the pointer lock that turns the mouse into look. Plain browser
// APIs only. The game reads movementX/Y while it holds the lock and keeps a set of held
// key codes; main.js polls that set once per fixed step.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressedKeys = new Set();
  const state = { keys, locked: false, firing: false, lookX: 0, lookY: 0 };
  let pressedMouse = false;

  function setKey(event, down) {
    if (down) {
      keys.add(event.code);
      pressedKeys.add(event.code);
    } else keys.delete(event.code);
    if (event.code === 'Space') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => {
    keys.clear();
    pressedKeys.clear();
    state.firing = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (state.locked && event.button === 0) {
      state.firing = true;
      pressedMouse = true;
    }
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    // Edge triggers: true once per press, so a click between two slow frames
    // still fires once. Auto weapons use the held `firing` flag instead.
    takePress() {
      const pressed = pressedMouse;
      pressedMouse = false;
      return pressed;
    },
    takeKey(code) {
      if (!pressedKeys.has(code)) return false;
      pressedKeys.delete(code);
      return true;
    },
  };
}
