(function(global){
  'use strict';
  function number(value){return Number(value)||0;}
  function status(order){return order&&order.status==='Archived'?(order.prevStatus||''):String(order&&order.status||'');}
  function qualifies(order){return !!order&&!order.voided&&order.paymentStatus!=='pending'&&(status(order)==='Completed'||status(order)==='Received');}
  function amounts(order){order=order||{};var channel=String(order.channel||'').toLowerCase(),platform=channel==='grabfood'||channel==='foodpanda',gross=number(platform&&order.grossPlatform!=null?order.grossPlatform:(order.subtotal!=null?order.subtotal:order.total)),platformDiscount=order.netSalesPlatform!=null?Math.max(0,gross-number(order.netSalesPlatform)):number(order.platformDiscount),discount=platform?platformDiscount:(number(order.discount)+number(order.loyaltyDiscount)),refund=number(order.refundAmount);return{gross:gross,discount:discount,refund:refund,net:Math.max(0,gross-discount-refund)};}
  function stamp(order){return number(order&&order.completedAt)||number(order&&order.receivedAt)||number(order&&order.timestamp)||Date.parse(order&&order.date)||number(order&&order.archivedAt)||0;}
  var SIZE_SUFFIX=/\s*\((?:S|M|L)\)\s*$/i;
  function text(value){return typeof value==='string'?value.trim():'';}
  function stripSize(name,size){
    var n=text(name);if(!n)return'';
    var s=text(size);
    if(s){var exact=new RegExp('\\s*\\('+s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\)\\s*$','i');if(exact.test(n))return n.replace(exact,'').trim()||n;}
    return n;
  }
  /* Rank drinks by the stable menu id, never by the display name.
     POS writes name as "Spanish Latte (M)"; the online server writes "Spanish Latte" with size in its own field,
     so a name-keyed ranking splits one drink into several rows by the till that rang it up. */
  function drinkKey(line){
    if(!line)return'';
    var key=text(line.itemKey);
    if(key)return key.toLowerCase();
    return text(line.name).replace(SIZE_SUFFIX,'').trim().toLowerCase();
  }
  function drinkLabel(line,menuItems){
    if(!line)return'';
    var key=text(line.itemKey),item=key&&menuItems?menuItems[key]:null,menuName=text(item&&item.name);
    if(menuName)return menuName;
    return stripSize(line.name,line.size)||key;
  }
  var DRINK_CATEGORIES=['coffee','noncaf','frappe','nonfrappe','soda'];
  /* One drink/food test for every ranking surface, so Overview and Analytics cannot rank different row sets. */
  function isDrinkLine(line,ctx){
    ctx=ctx||{};
    var menu=ctx.menuItems||{},types=ctx.catType||{},item=menu[line&&line.itemKey],
        cat=(item&&item.cat)||(line&&line.categoryId)||'',type=types[cat];
    if(type)return type==='drink';
    if((ctx.drinkCategories||DRINK_CATEGORIES).indexOf(cat)>-1)return true;
    return !/(?:food|pastr|bakery|meal)/i.test([cat,line&&line.categoryName].filter(Boolean).join(' '));
  }
  /* Rank and total payments by the method, never by the display label.
     The POS writes method as "Bank Transfer \u00b7 BDO" when a receiving account resolves and plain
     "Bank Transfer" when it does not, so a label-keyed total splits one method across two rows.
     The bare method is already stored as paymentMethod; older records need the suffix trimmed. */
  /* A method an operator renamed keeps its old name on every posted order. Rather than rewrite posted
     records, each configured method may list the legacy names it absorbs, and history reports under
     the current classification. An alias never overrides the wallet that received the money. */
  function methodAliases(configuredMethods){
    var out={},methods=Array.isArray(configuredMethods)?configuredMethods:((global.__posSettings&&global.__posSettings.payMethods)||[]);
    methods.forEach(function(m){
      var name=text(m&&m.name);if(!name)return;
      var list=Array.isArray(m.aliases)?m.aliases:text(m&&m.aliases).split(',');
      list.forEach(function(a){var alias=text(a).toLowerCase();if(alias&&alias!==name.toLowerCase())out[alias]=name;});
    });
    return out;
  }
  /* A wallet name written on a row: GCash, G-Cash, Gcash and "G-Cash " are one wallet, so a sale rung
     as "E-Wallet \u00b7 G-Cash" and one rung as "GCash \u00b7 G-Cash" report as one channel. A rail with no
     wallet named on it is not a wallet. */
  function walletMethodName(value){
    var key=text(value).toLowerCase().replace(/[^a-z0-9]+/g,'');
    if(!key)return'';
    if(key.indexOf('gcash')>-1)return'GCash';
    if(key.indexOf('paymaya')>-1||key==='maya')return'PayMaya';
    if(key==='ewallet'||key==='wallet')return'';
    return key.indexOf('wallet')>-1?text(value):'';
  }
  /* E-Wallet is a means of payment, exactly like Bank Transfer: the channel a report shows is the
     wallet that received the money, read from the payment row. */
  function walletOnRow(payment){
    if(!payment||typeof payment!=='object')return'';
    var named=walletLabelName(payment.receivingAccountName);
    if(named)return named;
    var label=text(payment.method),cut=label.lastIndexOf(' \u00b7 ');
    return cut>0?walletLabelName(label.slice(cut+3).trim()):'';
  }
  /* An account type is readable only when the accounts map is loaded; without it the wallet named on
     the row is still evidence, and a named credential is never given up for a generic rail. */
  function isWalletCredential(payment,accounts){
    if(!payment||typeof payment!=='object')return false;
    if(!accounts)return true;
    var id=text(payment.receivingAccountId),account=id&&accounts[id];
    return account?text(account.type).toLowerCase()==='ewallet':true;
  }
  function canonicalPaymentName(value){
    var name=text(value),key=name.toLowerCase().replace(/[^a-z0-9]+/g,'');
    if(key==='cash')return'Cash';
    if(key.indexOf('grabfood')>-1)return'GrabFood';
    if(key.indexOf('foodpanda')>-1)return'FoodPanda';
    if(key.indexOf('gcash')>-1)return'GCash';
    if(key.indexOf('paymaya')>-1||key==='maya')return'PayMaya';
    if(key.indexOf('banktransfer')>-1||key==='bank')return'Bank Transfer';
    if(key==='ewallet'||key==='wallet')return'E-Wallet';
    return name||'Other';
  }
  /* The wallet named on a row, for any e-money account: known brands keep one spelling and a wallet
     no allowlist knows still reports by its own name instead of vanishing into the generic rail. */
  function walletLabelName(value){
    var label=text(value);
    if(!label)return'';
    var canonical=canonicalPaymentName(label);
    if(canonical==='Cash'||canonical==='GrabFood'||canonical==='FoodPanda'||canonical==='Bank Transfer'||canonical==='E-Wallet'||canonical==='Other')return'';
    var cleaned=canonical==='GCash'||canonical==='PayMaya'?canonical:label.replace(/\s+/g,' ');
    return cleaned.indexOf(' · ')>=0?cleaned.split(' · ')[0].trim():cleaned;
  }
  function paymentKey(payment,configuredMethods,accounts){
    if(!payment)return'Other';
    var raw=typeof payment==='string'?splitMethod(payment,''):(text(payment.paymentMethod)||splitMethod(payment.method,payment.receivingAccountName));
    if(!raw)return'Other';
    var aliases=methodAliases(configuredMethods),rail=canonicalPaymentName(raw);
    /* A wallet is the channel, whichever wallet the customer used, and a resolved wallet key is never
       folded back into the rail it sits under. */
    if(rail==='E-Wallet'&&isWalletCredential(payment,accounts)){
      var wallet=walletOnRow(payment)||walletMethodName(raw);
      if(wallet)return wallet;
    }
    /* Cash keeps the literal name Finance identifies it by; a wallet named on the row outranks every
       stored alias, because an alias only records that a name was absorbed. */
    if(rail==='Cash'||walletMethodName(raw))return rail;
    return aliases[raw.toLowerCase()]||aliases[rail.toLowerCase()]||rail;
  }
  /* The receiving account is the detail under a classification: which wallet, which bank.
     Online orders are created server-side without one, so the report resolves it exactly the way
     Financial.accountForPayment does for the ledger \u2014 by the account whose feedMethods claims the
     method. Report and ledger then name the same account by construction, not by coincidence. */
  function accountNameForMethod(method,accounts){
    var wanted=text(method).toLowerCase(),found='';
    if(!wanted||!accounts)return'';
    Object.keys(accounts).forEach(function(id){
      var a=accounts[id]||{},feeds=Array.isArray(a.feedMethods)?a.feedMethods:[];
      if(feeds.some(function(n){return text(n).toLowerCase()===wanted;}))found=text(a.name)||id;
    });
    return found;
  }
  function paymentAccount(payment,accounts){
    if(!payment||typeof payment==='string')return'';
    var named=text(payment.receivingAccountName);if(named)return named;
    var id=text(payment.receivingAccountId);
    if(id&&accounts&&accounts[id])return text(accounts[id].name)||id;
    var label=text(payment.method),cut=label.lastIndexOf(' \u00b7 ');
    if(cut>0)return label.slice(cut+3).trim();
    return accountNameForMethod(text(payment.paymentMethod)||label,accounts);
  }
  function splitMethod(label,accountName){
    var name=text(label);if(!name)return'';
    var account=text(accountName);
    if(account){var tail=' \u00b7 '+account;if(name.length>tail.length&&name.slice(-tail.length).toLowerCase()===tail.toLowerCase())return name.slice(0,-tail.length).trim()||name;}
    var cut=name.lastIndexOf(' \u00b7 ');
    return cut>0?name.slice(0,cut).trim()||name:name;
  }
  global.AccazaSales=Object.freeze({status:status,qualifies:qualifies,amounts:amounts,stamp:stamp,isDrinkLine:isDrinkLine,paymentKey:paymentKey,paymentAccount:paymentAccount,drinkKey:drinkKey,drinkLabel:drinkLabel});
})(window);
