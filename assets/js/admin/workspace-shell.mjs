const META={
  dashboard:['Overview','Store overview','Today’s activity, service signals, and the work that needs attention.','operations:System health'],
  pos:['Point of sale','Point of Sale','Build the order, take payment, and complete the sale.','ops:Register operations'],
  orders:['Orders & operations','Active orders','Move live orders forward and resolve customer hand-offs.','ops:Register operations'],
  ops:['Orders & operations','Register operations','Open and close shifts, count the drawer, and review register activity.','pos:Open POS'],
  reservations:['Orders & operations','Reservations','Review upcoming bookings and prepare the floor.','calendar:Open calendar'],
  calendar:['Orders & operations','Reservation calendar','See table demand and blocked dates at a glance.','reservations:View reservations'],
  inventory:['Inventory','Inventory','Monitor quantities, value, and stock conditions.','purchases:Record purchase'],
  purchases:['Inventory','Purchases','Receive stock and preserve its costing trail.','inventory:View inventory'],
  recipes:['Inventory','Recipes','Maintain recipe coverage and product cost definitions.',''],
  usage:['Inventory','Internal usage','Record staff use, testing, waste, and controlled adjustments.',''],
  packages:['Inventory','Packages & promotions','Build sellable bundles from the active catalog.',''],
  analytics:['Financials','Sales analytics','Understand sales mix and operating patterns.',''],
  pnl:['Financials','Profit & loss','Review revenue, cost of goods, and operating result.',''],
  dailyreport:['Financials','Daily report','Close the day with a concise operational and financial view.',''],
  payouts:['Financials','Platform payouts','Reconcile delivery-platform receivables and settlements.',''],
  cashflow:['Financials','Cash flow','Track controlled cash, bank, and ledger movements.',''],
  receivables:['Financials','Receivables','Follow money owed to the business.',''],
  payables:['Financials','Payables','Review obligations and payment status.',''],
  stockvalue:['Financials','Stock value','Review the financial value held in inventory.',''],
  discrepancy:['Financials','Discrepancies','Investigate and approve register exceptions.',''],
  petty:['Financials','Petty cash','Control vouchers, replenishments, and approvals.',''],
  reviews:['Customers','Reviews','Manage public feedback and customer proof points.',''],
  appcustomers:['Customers','App customers','Review registered customer-app activity.',''],
  channelpricing:['Settings','Channel pricing','Maintain channel-specific prices and fees.',''],
  dedupe:['Settings','Menu maintenance','Resolve duplicate catalog records safely.',''],
  payment:['Settings','Payment details','Manage the payment instructions shown to customers.',''],
  staffaccounts:['Settings','Account setup','Create and maintain staff portal accounts.',''],
  staffaccess:['Settings','Staff access','Assign the minimum permissions each role needs.',''],
  operations:['Overview','Operations Center','Review system health and actionable operational exceptions.','dashboard:Back to overview'],
  adminaccounts:['Settings','Admin accounts','Manage privileged portal access.',''],
  changepw:['Settings','Change password','Update the current portal credential.','']
};

function installWorkspaceShell(options={}){
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
    const connection=document.getElementById('adminServiceConnection'),shift=document.getElementById('adminServiceShift'),queue=document.getElementById('adminServiceQueue');
    if(connection){const online=window.__online!==false,label=online?'Online':'Offline';connection.className='admin-service-pill '+(online?'ok':'bad');connection.textContent=label;connection.setAttribute('aria-label','Connection: '+label);}
    if(shift){const open=!!window.__posShift,label=open?'Shift open':'Shift closed';shift.className='admin-service-pill '+(open?'ok':'warn');shift.textContent=label;shift.setAttribute('aria-label',label);}
    if(queue){queue.textContent='Offline queue';if(window.AccazaOfflineQueue&&window.AccazaOfflineQueue.summary)window.AccazaOfflineQueue.summary().then(s=>{const pending=Number(s.pending||0)+Number(s.syncing||0),failed=Number(s.failed||0),detail=failed?failed+' sync failed':pending?pending+' awaiting sync':'Queue clear';queue.className='admin-service-pill '+(failed?'bad':pending?'warn':'ok');queue.title=detail;queue.setAttribute('aria-label','Offline queue: '+detail);}).catch(()=>{queue.className='admin-service-pill warn';queue.title='Queue status unavailable';queue.setAttribute('aria-label','Offline queue status unavailable');});}
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
  try{window.addEventListener('online',refresh);window.addEventListener('offline',refresh);}catch(_error){}
  return{update,refresh,open};
}

export{installWorkspaceShell};
