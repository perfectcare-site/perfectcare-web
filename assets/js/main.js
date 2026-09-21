
const toggle = document.querySelector('.menu-toggle');
const menu = document.querySelector('.menu');
if (toggle && menu) {
  toggle.addEventListener('click', () => {
    const opened = menu.classList.toggle('open');
    toggle.setAttribute('aria-expanded', opened ? 'true' : 'false');
  });
}
