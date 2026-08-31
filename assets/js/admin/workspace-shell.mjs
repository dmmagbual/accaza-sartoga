const META={
  dashboard:['Home','Store overview','Today’s activity, service signals, and the work that needs attention.','operations:System health'],
  pos:['Point of sale','Point of Sale','Build the order, take payment, and complete the sale.','ops:Register operations'],
  orders:['Sales & service','Active orders','Move live orders forward and resolve customer hand-offs.',''],
  ops:['Point of sale','Shift & register','Open and close shifts, count the drawer, and review register activity.','pos:Open POS'],
  reservations:['Sales & service','Reservations','Review upcoming bookings and prepare the floor.','calendar:Open calendar'],
  calendar:['Sales & service','Reservation calendar','See table demand and blocked dates at a glance.','reservations:View reservations'],
  inventory:['Inventory','Stock items','Maintain the common stock items, approved brands, and quantities used by recipes.','purchases:Record purchase'],
  purchases:['Inventory','Purchases','Receive stock and preserve its costing trail.','inventory:View inventory'],
  recipes:['Inventory','Recipes','Maintain recipe coverage and product cost definitions.',''],
  usage:['Inventory','Internal usage','Record staff use, testing, waste, and controlled adjustments.',''],
  packages:['Inventory','Packages & promotions','Build sellable bundles from the active catalog.',''],
  analytics:['Reports','Sales analytics','Understand sales mix and operating patterns.',''],
  saleshistory:['Reports','Sales history','Find and reconcile every completed transaction.','analytics:Open analytics'],
  pnl:['Financials','Profit & loss','Review revenue, cost of goods, and operating result.',''],
  dailyreport:['Reports','Daily report','Close the day with a concise operational and financial view.',''],
  payouts:['Cash & controls','Platform payouts','Reconcile delivery-platform receivables and settlements.',''],
  cashflow:['Financials','Cash flow','Track controlled cash, bank, and ledger movements.',''],
  receivables:['Financials','Receivables','Follow money owed to the business.',''],
  payables:['Financials','Payables','Review obligations and payment status.',''],
  stockvalue:['Inventory','Inventory','Reconcile beginning stock, movements, ending balance, and inventory value.',''],
  discrepancy:['Cash & controls','Reconciliation issues','Investigate and approve register exceptions.',''],
  petty:['Cash & controls','Cash payments','Record approved expenses, owner withdrawals, and supplier payments from Undeposited Collection.','undeposited:View cash pool'],
  undeposited:['Cash & controls','Undeposited Collection','Reconcile cash on hand, approved payments, and amounts awaiting bank deposit.','petty:Record cash payment'],
  reviews:['Customers','Reviews','Manage public feedback and customer proof points.',''],
  appcustomers:['Customers','App customers','Review registered customer-app activity.',''],
  availability:['Sales & service','Menu availability','Manage categories, menu items, options, and what customers can order.',''],
  comments:['Customers','Comments & feedback','Review contact messages, complaints, suggestions, compliments, and other feedback.',''],
  channelpricing:['Settings','Channel pricing','Maintain channel-specific prices and fees.',''],
  dedupe:['Settings','Menu maintenance','Resolve duplicate catalog records safely.',''],
  payment:['Settings','Payment details','Manage the payment instructions shown to customers.',''],
  staffaccounts:['Settings','Account setup','Create and maintain staff portal accounts.',''],
  staffaccess:['Settings','Staff access','Assign the minimum permissions each role needs.',''],
  operations:['Home','Operations Center','Review system health and actionable operational exceptions.','dashboard:Back to home'],
  adminaccounts:['Settings','Admin accounts','Manage privileged portal access.',''],
  changepw:['Settings','Change password','Update the current portal credential.','']
  ,accountingperiods:['Settings','Accounting periods','Close a month after review, or reopen it for controlled corrections.','']
};

function installWorkspaceShell(options={}){
  const subscriptionHub=options.subscriptionHub;
  function open(tab){
    let button=null;
    document.querySelectorAll('.admin-tab').forEach(b=>{
      const oc=b.getAttribute('onclick')||'';
      if(!button&&oc.includes("'"+tab+"'"))button=b;
    });
    return window.posSwitchTab(tab,button);
  }
  function action(markup){
    const el=document.getElementById('adminWorkspaceActions');
    if(!el)return;
    el.innerHTML='';
    if(!markup)return;
    const pair=markup.split(':'),button=document.createElement('button');
    button.className='awh-action';button.type='button';button.textContent=pair[1]||'Open';button.onclick=()=>open(pair[0]);
    el.appendChild(button);
  }
  function refresh(){
    const connection=document.getElementById('adminServiceConnection'),connectionLabel=document.getElementById('adminServiceConnectionLabel'),shift=document.getElementById('adminServiceShift'),shiftLabel=document.getElementById('adminServiceShiftLabel'),cashier=document.getElementById('adminServiceCashier'),queue=document.getElementById('adminServiceQueue'),queueNote=document.getElementById('adminServiceQueueNote');
    if(connection){const online=window.__online!==false,label=online?'Online':'Offline';connection.className='admin-service-pill '+(online?'ok':'bad');if(connectionLabel)connectionLabel.textContent=label;connection.setAttribute('aria-label','Connection: '+label);}
    if(shift){const open=!!window.__posShift,label=open?'Shift open':'Shift closed',staff=open?String(window.__posShift.staff||window.__posShift.cashier||'').trim():'';shift.className='admin-service-pill '+(open?'ok':'warn');if(shiftLabel)shiftLabel.textContent=label;if(cashier)cashier.textContent=open?(' · Cashier '+(staff||'not assigned')):' · No cashier assigned';shift.setAttribute('aria-label',label+(open?' with cashier '+(staff||'not assigned'):''));}
    if(queue){if(window.AccazaOfflineQueue&&window.AccazaOfflineQueue.summary)window.AccazaOfflineQueue.summary().then(s=>{const pending=Number(s.pending||0)+Number(s.syncing||0),failed=Number(s.failed||0),detail=failed?failed+' sync failed':pending?pending+' awaiting sync':'Queue clear',note=failed?' · Push to retry '+failed+' failed':pending?' · Push to sync '+pending+' transaction'+(pending===1?'':'s'):' · Push to check sync queue';queue.className='admin-service-pill admin-service-queue '+(failed?'bad':pending?'warn':'ok');if(queueNote)queueNote.textContent=note;queue.title=detail;queue.setAttribute('aria-label','Offline queue: '+detail+'. '+note.replace(/^ · /,''));}).catch(()=>{queue.className='admin-service-pill admin-service-queue warn';if(queueNote)queueNote.textContent=' · Push to check sync status';queue.title='Queue status unavailable';queue.setAttribute('aria-label','Offline queue status unavailable. Push to check sync status.');});}
  }
  function update(tab){
    const meta=META[tab]||['Admin','Admin workspace','Manage this area of the Accaza operation.',''];
    document.body.classList.toggle('admin-pos-workspace',tab==='pos');
    document.body.classList.toggle('admin-workspace-focused',tab!=='dashboard');
    document.body.dataset.adminWorkspace=tab;
    document.body.dataset.adminArea=String(meta[0]).toLowerCase();
    const area=document.getElementById('adminWorkspaceArea'),title=document.getElementById('adminWorkspaceTitle'),sub=document.getElementById('adminWorkspaceSubtitle');
    if(area)area.textContent=meta[0];if(title)title.textContent=meta[1];if(sub)sub.textContent=meta[2];
    action(meta[3]);refresh();
    if(tab==='dashboard'&&window.__refreshOverviewCommand)window.__refreshOverviewCommand();
  }
  window.openAdminWorkspaceTab=open;window.__refreshWorkspaceStatus=refresh;
  if(subscriptionHub&&typeof subscriptionHub.subscribe==='function')subscriptionHub.subscribe('posActiveShift',snapshot=>{
    window.__posShift=snapshot&&typeof snapshot.val==='function'?(snapshot.val()||null):null;
    refresh();
    if(window.__refreshOverviewCommand)window.__refreshOverviewCommand();
  },{critical:true});
  try{window.addEventListener('online',refresh);window.addEventListener('offline',refresh);}catch(_error){}
  return{update,refresh,open};
}

export{installWorkspaceShell};
