let currentLang = 'pl';

document.getElementById('language-flag').addEventListener('click', () => {
currentLang = currentLang === 'pl' ? 'en' : 'pl';

const flag = document.getElementById('language-flag');
flag.src = flag.getAttribute('src').replace(/(gb|pl)\.png$/, currentLang === 'pl' ? 'gb.png' : 'pl.png');
document.getElementById('language-flag').alt = currentLang === 'pl' ? 'English' : 'Polski';

document.querySelectorAll('[data-pl][data-en]').forEach(el => {
    const translation = el.getAttribute(`data-${currentLang}`);
    el.innerHTML = translation.replaceAll('\\n', '<br>');});
});
