(function(global){
  'use strict';
  function number(value){return Number(value)||0;}
  function status(order){return order&&order.status==='Archived'?(order.prevStatus||''):String(order&&order.status||'');}
  function qualifies(order){return !!order&&!order.voided&&order.paymentStatus!=='pending'&&(status(order)==='Completed'||status(order)==='Received');}
  function amounts(order){order=order||{};var channel=String(order.channel||'').toLowerCase(),platform=channel==='grabfood'||channel==='foodpanda',gross=number(platform&&order.grossPlatform!=null?order.grossPlatform:(order.subtotal!=null?order.subtotal:order.total)),platformDiscount=order.netSalesPlatform!=null?Math.max(0,gross-number(order.netSalesPlatform)):number(order.platformDiscount),discount=platform?platformDiscount:number(order.discount),refund=number(order.refundAmount);return{gross:gross,discount:discount,refund:refund,net:Math.max(0,gross-discount-refund)};}
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
  /* A method absorbed by a reclassification (GCash and PayMaya folded into E-Wallet) keeps its old
     name on every posted order. Rather than rewrite posted records, each configured method may list
     the legacy names it absorbs, and history reports under the current classification. */
  function methodAliases(){
    var out={},methods=(global.__posSettings&&global.__posSettings.payMethods)||[];
    methods.forEach(function(m){
      var name=text(m&&m.name);if(!name)return;
      var list=Array.isArray(m.aliases)?m.aliases:text(m&&m.aliases).split(',');
      list.forEach(function(a){var alias=text(a).toLowerCase();if(alias&&alias!==name.toLowerCase())out[alias]=name;});
    });
    return out;
  }
  function paymentKey(payment){
    if(!payment)return'Other';
    var raw=typeof payment==='string'?splitMethod(payment,''):(text(payment.paymentMethod)||splitMethod(payment.method,payment.receivingAccountName));
    if(!raw)return'Other';
    return methodAliases()[raw.toLowerCase()]||raw;
  }
  /* The receiving account is the detail under a classification: which wallet, which bank. */
  function paymentAccount(payment){
    if(!payment||typeof payment==='string')return'';
    var named=text(payment.receivingAccountName);if(named)return named;
    var label=text(payment.method),cut=label.lastIndexOf(' \u00b7 ');
    return cut>0?label.slice(cut+3).trim():'';
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
