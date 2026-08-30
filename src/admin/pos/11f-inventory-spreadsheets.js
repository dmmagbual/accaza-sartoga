/* ---------- Inventory Excel export / import ---------- */
function invColumns(){return ['id','name','type','unit','stock','reorder','cost','serves','size','qtyPerOrder'];}
function invToAOA(){
  var cols=invColumns(); var aoa=[cols];
  ings().forEach(function(i){ var c=ingType(i)==='consumable';
    aoa.push([i.id,i.name||'',ingType(i),i.unit||'',Number(i.stock)||0,Number(i.reorder)||0,(i.cost!=null&&i.cost!==''?Number(i.cost):''),(c?(i.serves||'both'):''),(c?(i.size||''):''),(c?(i.qtyPerOrder!=null?i.qtyPerOrder:1):'')]);
  });
  return aoa;
}
function exportInventoryXlsx(){
  if(!window.XLSX){alert('Excel library is still loading — try again in a moment.');return;}
  var ws=XLSX.utils.aoa_to_sheet(invToAOA());
  var wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Inventory');
  XLSX.writeFile(wb,'accaza-inventory-'+window.AccazaDate.key()+'.xlsx');
}
function downloadInventoryTemplate(){
  if(!window.XLSX){alert('Excel library is still loading — try again in a moment.');return;}
  var ex=[invColumns(),
    ['','Espresso beans','base','g','',0,0.9,'','',''],
    ['','Fresh milk','base','ml','',0,0.06,'','',''],
    ['','Vanilla syrup','option','pump','',0,3.5,'','',''],
    ['','Medium paper cup','consumable','pcs','',0,2.2,'drink','M',1],
    ['','Stirrer','consumable','pcs','',0,0.3,'drink','',1],
    ['','Pastry box','consumable','pcs','',0,4,'food','',1]
  ];
  var ws=XLSX.utils.aoa_to_sheet(ex);
  var notes=[['Accaza — Inventory import template'],[''],
    ['HOW TO USE'],
    ['1. One row per item. Leave the id column BLANK for new items (fill it only when re-importing an exported file to update exact rows).'],
    ['2. name = required. type = base / option / consumable / operating_supply / office_supply. Supply types are never auto-deducted by recipes.'],
    ['3. unit = g, ml, oz, pcs, shot, pump, ea — use the SAME unit for cost and for recipe quantities.'],
    ['4. cost = price per ONE unit (per g, per ml, per pc). Blank = 0.'],
    ['5. serves / size / qtyPerOrder apply to CONSUMABLES only:'],
    ['      serves = both / drink / food ;  size = S / M / L for cups (blank = all sizes) ;  qtyPerOrder default 1.'],
    ['6. Import matches by id first, else by name (case-insensitive). Blank cells on an EXISTING item are left unchanged (so you will not wipe live stock).'],
    ['7. Delete these example rows, fill your own, Save As .xlsx, then use "⬆ Import Excel" in the Inventory tab.']
  ];
  var wsN=XLSX.utils.aoa_to_sheet(notes);
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Inventory');
  XLSX.utils.book_append_sheet(wb,wsN,'Instructions');
  XLSX.writeFile(wb,'accaza-inventory-template.xlsx');
}
function importInventoryXlsx(file){
  if(!window.XLSX){alert('Excel library is still loading — try again.');return;}
  var rd=new FileReader();
  rd.onload=function(e){
    try{
      var wb=XLSX.read(e.target.result,{type:'array'});
      var sh=wb.Sheets['Inventory']||wb.Sheets[wb.SheetNames[0]];
      var rows=XLSX.utils.sheet_to_json(sh,{defval:''});
      if(!rows.length){alert('No rows found on the Inventory sheet.');return;}
      var byId={},byName={};
      ings().forEach(function(i){byId[i.id]=i;byName[(i.name||'').trim().toLowerCase()]=i;});
      var created=0,updated=0,skipped=0; var a=A(), writes={}, moves=[];
      var importId='xlsx_'+String(file.name||'inventory').replace(/[^A-Za-z0-9_-]/g,'_').slice(0,70)+'_'+Number(file.lastModified||file.size||0);
      rows.forEach(function(r){
        var name=String(r.name||'').trim(); if(!name){skipped++;return;}
        var id=String(r.id||'').trim();
        var match=(id&&byId[id])||byName[name.toLowerCase()];
        function has(k){return r[k]!==''&&r[k]!=null;}
        var type=has('type')?String(r.type).trim().toLowerCase():(match?ingType(match):'base'); if(['base','option','both','consumable','operating_supply','office_supply'].indexOf(type)<0)type='base';
        var desiredStock=has('stock')?(Number(r.stock)||0):(match?(Number(match.stock)||0):0);
        var desiredCost=has('cost')?(Number(r.cost)||0):(match?(Number(match.cost)||0):0);
        var o=match?{}:{reorder:0};
        o.name=name; o.type=type;o.recipeItem=isSupplyType(type)?false:(match&&match.recipeItem===false?false:true);
        if(has('unit')){var importedUnit=String(r.unit).trim();if(match&&match.ledgerVersion&&uNorm(importedUnit)!==uNorm(match.unit)){throw new Error('Cannot change the unit of ledger item "'+name+'" by import. Create a new item or correct it before ledger initialization.');}o.unit=importedUnit;}
        if(has('reorder'))o.reorder=Number(r.reorder)||0;
        if(type==='consumable'){
          o.serves=has('serves')?String(r.serves).trim().toLowerCase():((match&&match.serves)||'both'); if(['both','drink','food'].indexOf(o.serves)<0)o.serves='both';
          o.size=has('size')?String(r.size).trim().toUpperCase():((match&&match.size)||''); if(['S','M','L'].indexOf(o.size)<0)o.size='';
          o.qtyPerOrder=has('qtyPerOrder')?(Number(r.qtyPerOrder)||1):((match&&match.qtyPerOrder!=null)?match.qtyPerOrder:1);
        }
        o.updatedAt=Date.now();
        var targetId;
        if(match){ targetId=match.id; Object.keys(o).forEach(function(k){writes['inventory/'+targetId+'/'+k]=o[k];}); updated++; byId[targetId]=Object.assign({},match,o); byName[name.toLowerCase()]=byId[targetId]; }
        else { targetId=uid('ing_'); writes['inventory/'+targetId]=Object.assign({},o,{stock:0,cost:0}); created++; var no=Object.assign({id:targetId,stock:0,cost:0},o); byId[targetId]=no; byName[name.toLowerCase()]=no; }
        var oldStock=match?(Number(match.stock)||0):0, oldCost=match?(Number(match.cost)||0):0;
        if(!match||desiredStock!==oldStock||desiredCost!==oldCost){moves.push({movementId:movementId('manual_edit',importId,targetId),itemId:targetId,type:'manual_edit',qty:desiredStock-oldStock,unitCost:desiredCost,setCost:true,sourceType:'inventory-xlsx',sourceId:importId,sourceLine:String(r.id||name),note:'Inventory Excel import',actorName:(window.__posShift&&window.__posShift.staff)||'Admin',occurredAt:Date.now()});}
      });
      a.update(a.ref(a.db),writes).then(function(){return moves.length?postMovements(moves):null;}).then(function(){alert('Import complete.\nCreated: '+created+'\nUpdated: '+updated+'\nLedger movements: '+moves.length+(skipped?'\nSkipped (no name): '+skipped:''));}).catch(function(err){alert('Import FAILED: '+((err&&err.message)||err)+'. The same file is safe to retry.');});
    }catch(err){ alert('Could not read that file: '+err); }
  };
  rd.readAsArrayBuffer(file);
}
