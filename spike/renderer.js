const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const dogEl = document.getElementById('dog');
const bubbleEl = document.getElementById('bubble');
const answer = document.getElementById('answer');
const info = document.getElementById('info');

let dog = null;
let bubble = null;
let lastOver = false;

function place(el, r) {
  el.style.left = r.x + 'px';
  el.style.top = r.y + 'px';
  el.style.width = r.w + 'px';
  el.style.height = r.h + 'px';
}
const inside = (r, x, y) => r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + 'px';
  canvas.style.height = window.innerHeight + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

window.spike.onDraw((s) => {
  dog = s.dog;
  bubble = s.bubble;
  place(dogEl, dog);
  place(bubbleEl, bubble);
  info.textContent = s.info;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const w of s.windows) {
    const r = w.rect;
    ctx.lineWidth = w.fg ? 3 : 1.5;
    ctx.strokeStyle = w.fg ? '#00c853' : '#ff1744';
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    // Title-bar strip: the dog's walking surface.
    ctx.fillStyle = w.fg ? 'rgba(0,200,83,.25)' : 'rgba(255,23,68,.18)';
    ctx.fillRect(r.x, r.y, r.w, Math.min(32, r.h));
    ctx.fillStyle = '#000';
    ctx.font = '11px Segoe UI';
    ctx.fillText(w.process, r.x + 6, r.y + 14);
  }
});

// Forwarded mouse moves arrive here while the window ignores mouse events.
document.addEventListener('mousemove', (e) => {
  const over = inside(dog, e.clientX, e.clientY) || inside(bubble, e.clientX, e.clientY);
  if (over !== lastOver) {
    lastOver = over;
    window.spike.hit(over);
  }
});
document.addEventListener('mouseleave', () => {
  if (lastOver) {
    lastOver = false;
    window.spike.hit(false);
  }
});
dogEl.addEventListener('mousedown', () => window.spike.dogClick());
bubbleEl.addEventListener('mousedown', () => window.spike.focusBubble());
window.spike.onFocusInput(() => answer.focus());
answer.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    window.spike.submit(answer.value);
    answer.value = '';
    answer.blur();
  }
});
