/* Finance Books sign-in gate (Danilo, 23 Oct 2026: "create a dedicated login page for finance/books").
   Nothing in Books shows until a staff account with Finance Books access signs in: Super Admin, Admin and
   Manager by role, or a staff-level account given "Finance Books app" under Admin > User Accounts & Access.
   This screen is the front door only; the database rules and the Books server functions enforce the same
   access on every read and action. live-pos.mjs decides access and calls BooksGate.show / BooksGate.hide. */
(function(){
  'use strict';
  var state='checking',info={},OFFLINE_AFTER_MS=10000;
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function gate(){return document.getElementById('booksGate');}
  var AUTH_ERRORS={'auth/invalid-credential':'Email or password is incorrect.','auth/wrong-password':'Email or password is incorrect.','auth/user-not-found':'Email or password is incorrect.','auth/invalid-email':'Enter a valid email address.','auth/user-disabled':'This account is disabled. Ask a Super Admin.','auth/too-many-requests':'Too many attempts. Wait a few minutes, then try again.','auth/network-request-failed':'No connection to the server. Check the internet and try again.'};
  function authMessage(error){var code=String(error&&error.code||'');return AUTH_ERRORS[code]||('Sign-in failed: '+String(error&&error.message||error||'unknown error'));}
  var DENIED={not_staff:'is not an Accaza staff account.',disabled:'is disabled.',no_permission:'does not have Finance Books access.'};
  function body(){
    if(state==='signin')return '<h1 id="booksGateTitle">Sign in to Finance Books</h1><p class="books-gate-lead">Use your Accaza staff account.</p>'
      +'<form id="booksGateForm" novalidate><label for="booksGateEmail">Email</label><input id="booksGateEmail" type="email" autocomplete="username" required/>'
      +'<label for="booksGatePassword">Password</label><input id="booksGatePassword" type="password" autocomplete="current-password" required/>'
      +'<p class="books-gate-error" id="booksGateError" role="alert" aria-live="assertive"></p><button type="submit" class="books-gate-primary" id="booksGateSubmit">Sign in</button></form>'
      +'<p class="books-gate-note">Forgot your password? A Super Admin can send a reset email from Admin &gt; User Accounts &amp; Access.</p>';
    if(state==='denied')return '<h1 id="booksGateTitle">No Finance Books access</h1><p class="books-gate-lead"><b>'+esc(info.email||'This account')+'</b> '+esc(DENIED[info.reason]||DENIED.no_permission)+'</p>'
      +'<p class="books-gate-note">Ask a Super Admin to tick <b>Finance Books app</b> for this account under Admin &gt; User Accounts &amp; Access, then sign in again.</p>'
      +'<div class="books-gate-actions"><button type="button" class="books-gate-primary" data-gate-signout>Sign out</button><a class="books-gate-secondary" href="admin.html">Go to POS / Admin</a></div>';
    if(state==='offline')return '<h1 id="booksGateTitle">Can\'t reach Finance Books</h1><p class="books-gate-lead">The sign-in service did not respond. Check the internet connection, then try again.</p>'
      +'<div class="books-gate-actions"><button type="button" class="books-gate-primary" data-gate-retry>Try again</button><a class="books-gate-secondary" href="admin.html">Go to POS / Admin</a></div>';
    return '<h1 id="booksGateTitle">Finance Books</h1><p class="books-gate-lead" role="status">Checking your sign-in…</p>';
  }
  function wire(root){
    var form=root.querySelector('#booksGateForm');
    if(form){var email=root.querySelector('#booksGateEmail');if(info.email)email.value=info.email;setTimeout(function(){(info.email?root.querySelector('#booksGatePassword'):email).focus();},0);
      form.onsubmit=function(event){event.preventDefault();var error=root.querySelector('#booksGateError'),button=root.querySelector('#booksGateSubmit'),pw=root.querySelector('#booksGatePassword');
        error.textContent='';if(!email.value.trim()||!pw.value){error.textContent='Enter your email and password.';return;}
        if(!window.__booksGateSignIn){error.textContent='The sign-in service is still starting. Wait a moment and try again.';return;}
        button.disabled=true;button.textContent='Signing in…';
        /* On success live-pos.mjs checks access and either opens Books or shows "No access". */
        window.__booksGateSignIn(email.value.trim(),pw.value).catch(function(e){button.disabled=false;button.textContent='Sign in';pw.value='';error.textContent=authMessage(e);pw.focus();});};}
    var out=root.querySelector('[data-gate-signout]');if(out)out.onclick=function(){out.disabled=true;Promise.resolve(window.__booksSignOut&&window.__booksSignOut()).catch(function(){}).then(function(){out.disabled=false;});};
    var retry=root.querySelector('[data-gate-retry]');if(retry)retry.onclick=function(){location.reload();};
  }
  function show(next,details){
    var root=gate();state=next||'signin';info=details||{};
    document.body.classList.add('books-locked');
    if(!root)return;root.hidden=false;root.innerHTML='<div class="books-gate-card" role="dialog" aria-modal="true" aria-labelledby="booksGateTitle"><div class="books-gate-brand"><span aria-hidden="true">☕</span> Accaza Books</div>'+body()+'</div>';wire(root);
  }
  function hide(){var root=gate();state='open';info={};document.body.classList.remove('books-locked');if(root){root.hidden=true;root.innerHTML='';}}
  /* The same access rule the database rules and Books server functions apply: Super Admin (incl. legacy
     Owner), Admin and Manager by role; any other staff account needs Finance Books app (cashflow) or an
     older receivables / payables grant. perms === null means "not read yet": decide by role alone. */
  var BOOKS_ROLES={owner:1,superadmin:1,admin:1,manager:1},BOOKS_PERMISSIONS=['cashflow','receivables','payables'];
  function decide(raw,perms){
    if(raw==null)return {allowed:false,reason:'not_staff'};
    if(raw&&typeof raw==='object'&&(raw.disabled===true||raw.active===false))return {allowed:false,reason:'disabled'};
    var role=String((raw===true?'owner':typeof raw==='string'?raw:raw&&raw.role)||'').toLowerCase();
    if(BOOKS_ROLES[role])return {allowed:true,role:role};
    var granted=BOOKS_PERMISSIONS.some(function(key){return perms&&perms[key]===true;});
    return granted?{allowed:true,role:role}:{allowed:false,reason:'no_permission',role:role};
  }
  window.BooksGate={show:show,hide:hide,decide:decide,state:function(){return state;}};
  /* The sign-in service never answered (blocked script, no network): say so instead of spinning. */
  setTimeout(function(){if(state==='checking')show('offline');},OFFLINE_AFTER_MS);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){if(state==='checking')show('checking');});else show('checking');
})();
