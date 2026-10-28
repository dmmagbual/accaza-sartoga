// Pure Active Orders card parts (payment badge, verification policy, item list). No Firebase calls or writes.
function hasNonCashPayment(o){return(o.payments&&o.payments.length)?o.payments.some(function(p){return p.method&&p.method!=='Cash';}):(o.payment&&o.payment!=='Cash'&&o.payment!=='Split');}
export function verificationPolicy(o){var payments=(o.payments&&o.payments.length)?o.payments:[{method:o.payment}],direct=payments.filter(function(p){var m=String(p&&p.method||'').trim().toLowerCase();return m&&m!=='cash'&&m!=='grabfood'&&m!=='foodpanda';}),methods=(window.__posSettings&&window.__posSettings.payMethods)||[];if(!direct.length)return null;return direct.some(function(p){var row=methods.find(function(m){return String(m&&m.name||'').trim().toLowerCase()===String(p.method||'').trim().toLowerCase();}),policy=row&&row.verificationPolicy;if(policy!=='cashier_manager'&&policy!=='manager_only')policy=/gcash|maya/i.test(String(p.method||''))?'cashier_manager':'manager_only';return policy==='manager_only';})?'manager_only':'cashier_manager';}
export function paymentState(o){
  if(o.voided)return '<span class="order-payment-state voided">Voided sale</span>';
  if(o.paymentStatus==='pending')return '<span class="order-payment-state pending">'+(verificationPolicy(o)==='manager_only'?'Awaiting manager verification':'Awaiting cashier verification')+'</span>';
  if(o.paymentStatus==='cashier_verified')return '<span class="order-payment-state pending">Cashier verified · manager review pending</span>';
  if((o.paymentStatus==='manager_validated'||o.paymentStatus==='confirmed')&&hasNonCashPayment(o))return '<span class="order-payment-state confirmed">Manager validated</span>';
  if(o.status==='Completed'||o.status==='Received')return '<span class="order-payment-state locked">Sale locked</span>';
  return '<span class="order-payment-state active">Order in progress</span>';
}
function legacyItemLines(text){var out=[],buf='',depth=0;String(text||'').split('').forEach(function(ch){if(ch==='(')depth++;if(ch===')'&&depth>0)depth--;if(ch===','&&depth===0){if(buf.trim())out.push(buf.trim());buf='';}else buf+=ch;});if(buf.trim())out.push(buf.trim());return out;}
export function orderItemsHtml(o,escHtml){
  var isOnline=(o.source==='online'||o.channel==='online');function sizeTag(li){if(!li.size)return '';var n=String(li.name||'').toLowerCase(),sz=String(li.size).toLowerCase();if(n.indexOf('('+sz+')')>=0)return '';if(!isOnline)return '';return ' <span class="order-item-size">('+escHtml(li.size)+')</span>';}
  var lines=Array.isArray(o.lineItems)&&o.lineItems.length?o.lineItems.map(function(li){return{name:li.name||li.itemKey||'Item',size:li.size||'',options:Array.isArray(li.optLabels)?li.optLabels:[],qty:Math.max(1,Number(li.qty)||1)};}):legacyItemLines(o.items).map(function(text){var qm=text.match(/\s+x(\d+)\s*$/i);return{name:qm?text.slice(0,qm.index).trim():text,size:'',options:[],qty:qm?Math.max(1,Number(qm[1])||1):1};});
  if(!lines.length)return '<div class="order-admin-items-empty">No item details recorded</div>';
  return '<div class="order-admin-items" aria-label="Order items"><div class="order-items-heading">🛒 Order items <span>'+lines.length+' line'+(lines.length===1?'':'s')+'</span></div><ul class="order-item-list">'+lines.map(function(li){return '<li class="order-item-row"><span class="order-item-qty">'+escHtml(li.qty)+'×</span><span class="order-item-detail"><strong>'+escHtml(li.name)+sizeTag(li)+'</strong>'+(li.options.length?'<small>'+li.options.map(escHtml).join(' · ')+'</small>':'')+'</span></li>';}).join('')+'</ul></div>';
}
