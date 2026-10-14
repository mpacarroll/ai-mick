/* The course store. Put each Gumroad link here when the listing exists; until
   then the button reads "Tell me when it opens" and goes to the email form on
   the same page. When a link goes in, also change that page's JSON-LD
   "availability" from PreOrder to InStock. */
var COURSE_STORE = {
  "ai-starts-here": "",
  "get-ai-to-help": "",
  "spec-driven-building": ""
};

(function(){
  var buy = document.getElementById('buy');
  if (!buy) return;
  var url = COURSE_STORE[buy.getAttribute('data-course')];
  if (!url) return;
  buy.href = url;
  buy.textContent = 'Get the course';
  var note = document.getElementById('buy-note');
  if (note) note.textContent = 'Instant PDF download. One-time payment, yours to keep.';
})();

/* The email form posts to the same list the hub uses. */
(function(){
  var f = document.getElementById('signup');
  if (!f) return;
  f.addEventListener('submit', function(e){
    e.preventDefault();
    var msg = f.querySelector('.status'), btn = f.querySelector('button');
    var email = (f.email.value || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'Please enter a valid email.'; return; }
    if (f.website.value) { msg.textContent = 'Thanks, you’re on the list.'; return; }
    btn.disabled = true; msg.textContent = 'Adding you…';
    fetch('https://join.micksfairdinkumai.com/subscribe', {method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({email: email, source: f.getAttribute('data-source')})})
      .then(function(r){ return r.json().catch(function(){ return {ok: r.ok}; }); })
      .then(function(d){
        if (d && d.ok) { msg.textContent = 'Thanks, you’re on the list.'; f.email.value = ''; }
        else { msg.textContent = (d && d.error) ? d.error : 'Something went wrong. Try again.'; btn.disabled = false; }
      })
      .catch(function(){ msg.textContent = 'Could not reach the server. Try again shortly.'; btn.disabled = false; });
  });
})();
