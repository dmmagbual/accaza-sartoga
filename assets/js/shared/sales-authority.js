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
  global.AccazaSales=Object.freeze({status:status,qualifies:qualifies,amounts:amounts,stamp:stamp,isDrinkLine:isDrinkLine,drinkKey:drinkKey,drinkLabel:drinkLabel});
})(window);
