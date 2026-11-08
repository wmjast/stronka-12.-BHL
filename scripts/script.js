document.querySelectorAll('.faq-question').forEach(question => {
  question.addEventListener('click', () => {
    const answer = question.nextElementSibling;
    const icon = question.querySelector('.faq-toggle');

    const isOpen = answer.style.height && answer.style.height !== '0px';

    // Zamknij wszystkie inne
    document.querySelectorAll('.faq-answer').forEach(ans => {
      if (ans !== answer) {
        ans.style.height = '0px';
      }
    });

    document.querySelectorAll('.faq-toggle').forEach(iconEl => {
      if (iconEl !== icon) {
        iconEl.textContent = "+";
        iconEl.classList.remove('rotate');
      }
    });

if (isOpen) {
  answer.classList.remove('open');
  answer.style.height = '0px';
  icon.textContent = "+";
  icon.classList.remove('rotate');
} else {
  answer.classList.add('open');
  answer.style.height = answer.scrollHeight + 'px';
  icon.textContent = "−";
  icon.classList.add('rotate');
}
  });
});

const p11Btn = document.getElementById('partners11-toggle');
const p11Content = document.getElementById('partners11-content');

// Zwijanie i rozwijanie partnerów 11. edycji jednym przyciskiem
if (p11Btn && p11Content) {
  p11Btn.addEventListener('click', () => {
    const isOpen = p11Btn.getAttribute('aria-expanded') === 'true';
    const label = p11Btn.querySelector('.partners11-label');

    if (isOpen) {
      p11Content.style.height = p11Content.scrollHeight + 'px'; // z 'auto' na px, inaczej animacja nie ruszy
      p11Content.offsetHeight;                                   // wymuszenie reflow przed zmianą na 0
      p11Content.style.height = '0px';
      label.setAttribute('data-pl', 'Pokaż partnerów');
      label.setAttribute('data-en', 'Show partners');
    } else {
      p11Content.style.height = p11Content.scrollHeight + 'px'; // rozwinięcie do pełnej wysokości
      label.setAttribute('data-pl', 'Ukryj partnerów');
      label.setAttribute('data-en', 'Hide partners');
    }

    p11Btn.setAttribute('aria-expanded', String(!isOpen));
    label.textContent = label.getAttribute(`data-${currentLang}`); // napis w aktualnie wybranym języku
  });

  p11Content.addEventListener('transitionend', () => {
    if (p11Btn.getAttribute('aria-expanded') === 'true') p11Content.style.height = 'auto'; // po rozwinięciu wysokość sama się dopasuje, np. przy obrocie telefonu
  });
}
