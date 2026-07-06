document.querySelectorAll('.sw, .seg').forEach(g=>{g.addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b)return;
  g.querySelectorAll('button').forEach(x=>x.classList.remove('on')); b.classList.add('on');
  const show=b.dataset.show; if(show){const p=b.closest('.panel')||document;
    p.querySelectorAll('[data-variant]').forEach(v=>v.style.display = v.dataset.variant===show?'':'none');}
});});
