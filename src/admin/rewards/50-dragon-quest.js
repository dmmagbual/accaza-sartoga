// Rewards · Dragon Brew Quest editor. Published seasons are immutable; an
// updated campaign is made by cloning to a new draft so existing customer
// progress always keeps the rules it started with.

function rewardsDragonStoryTemplate() {
  var now = Date.now(), end = now + 60 * 86400000;
  return {
    isNew: true,
    name: 'Dragon Brew Quest: The Ember Cup',
    story: 'Every night after the final cup is served, a trail of golden steam curls across Accaza and vanishes beneath the old brew bar. The legend says it belongs to Sariwa, the Ember Dragon—guardian of a cup that can keep one brave dream alive. But tonight, the trail is fading. Five enchanted seals have scattered through the menu, and only a new Brew Keeper can recover them. Follow the clues, awaken each chapter, and reach the Ember Cup before its last spark disappears.',
    startDate: rewardsDragonManilaDay(now), endDate: rewardsDragonManilaDay(end)
  };
}

function rewardsDragonChapterTemplate(sequence) {
  var chapters = [
    {name: 'The First Spark', story: 'Your badge glows for the first time. Beneath the brew bar, one tiny scale burns like a coal—and a voice whispers, “Find the cup that remembers fire.” Choose your first brew carefully. When the scale awakens, it will reveal who has been watching from the dark.', requirementText: 'Order any eligible coffee drink once.', requirementType: 'item_quantity', targetCount: 1, categoryIds: 'coffee', pairCategoryIds: '', oneCreditPerOrder: true, rewardName: 'First Spark chapter seal'},
    {name: 'The Guardian at the Gate', story: 'The scale becomes a key, opening a doorway no ordinary guest can see. A mischievous guardian blocks the path, guarding the second seal beneath its paw. It will move only for a pairing worthy of a dragon’s table—and it is very particular.', requirementText: 'Pair an eligible drink with a pastry in the same order.', requirementType: 'pair_same_order', targetCount: 1, categoryIds: 'coffee,noncaf,frappe,nonfrappe,soda', pairCategoryIds: 'pastry', oneCreditPerOrder: true, rewardName: 'Guardian’s chapter seal'},
    {name: 'Three Moonlit Returns', story: 'Beyond the gate lies a map drawn in invisible steam. It appears for only a moment, then fades. Return beneath three different skies; with every visit, another glowing path will remain—and something at the map’s centre will begin to wake.', requirementText: 'Make an eligible drink purchase on 3 different days.', requirementType: 'different_day_visits', targetCount: 3, categoryIds: 'coffee,noncaf,frappe,nonfrappe,soda', pairCategoryIds: '', oneCreditPerOrder: true, rewardName: 'Moonlit Trail chapter seal'},
    {name: 'The Many-Brewed Cipher', story: 'The completed map leads to a wall covered in ancient cup marks. One flavour reveals a symbol; another changes it. Explore three different brews to crack the cipher. Solve it, and the final door will speak your name: Brew Keeper.', requirementText: 'Try 3 different eligible drinks.', requirementType: 'distinct_items', targetCount: 3, categoryIds: 'coffee,noncaf,frappe,nonfrappe,soda', pairCategoryIds: '', oneCreditPerOrder: false, rewardName: 'Many-Brewed Cipher seal'},
    {name: 'Heart of the Ember Dragon', story: 'The final door opens. Sariwa sleeps around the Ember Cup, its golden flame reduced to one trembling spark. Place the last offering, restore the five seals, and wake the dragon. If the legends are true, the treasure it has guarded will choose you.', requirementText: 'Complete the final featured drink-and-food pairing.', requirementType: 'pair_same_order', targetCount: 1, categoryIds: 'coffee,noncaf,frappe,nonfrappe,soda', pairCategoryIds: 'pastry', oneCreditPerOrder: true, rewardName: 'Ember Dragon treasure'}
  ];
  var row = chapters[Math.min(chapters.length - 1, Math.max(0, Number(sequence || 1) - 1))];
  return Object.assign({isNew: true, sequence: Number(sequence) || 1, itemIds: '', pairItemIds: '', minimumNetAmount: 0, rewardType: 'catalog', rewardId: '', enabled: true}, row);
}

function rewardsDragonManilaDay(ms) {
  if (!Number(ms)) return '';
  var parts = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Manila', year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(new Date(Number(ms))), out = {};
  parts.forEach(function(part){if(part.type!=='literal')out[part.type]=part.value;});
  return out.year + '-' + out.month + '-' + out.day;
}

function rewardsDragonDateInput(ms) { return rewardsDragonManilaDay(ms); }

function rewardsDragonOptions(selected) {
  var ids = Object.keys(_rewardsState.catalog || {}).filter(function (id) { return (_rewardsState.catalog[id] || {}).enabled !== false; });
  ids.sort(function (a, b) { return String(_rewardsState.catalog[a].name || a).localeCompare(String(_rewardsState.catalog[b].name || b)); });
  return '<option value="">Choose a configured reward…</option>' + ids.map(function (id) {
    return '<option value="' + rewardsEscape(id) + '"' + (id === selected ? ' selected' : '') + '>' + rewardsEscape((_rewardsState.catalog[id].name || id) + ' · ' + id) + '</option>';
  }).join('');
}

function rewardsDragonHtml() {
  var state = _rewardsState.dragon;
  if (!state.loaded) return '<div class="rw-loading">' + (_rewardsState.busy ? 'Opening the quest editor…' : 'Press Refresh to load Dragon Brew Quest.') + '</div>';
  var ids = Object.keys(state.seasons || {}).sort(function (a, b) { return Number((state.seasons[b] || {}).createdAt) - Number((state.seasons[a] || {}).createdAt); });
  var selectedId = state.selectedSeasonId && state.seasons[state.selectedSeasonId] ? state.selectedSeasonId : (ids[0] || null);
  state.selectedSeasonId = selectedId;
  var cards = ids.length ? ids.map(function (id) {
    var row = state.seasons[id] || {}, active = id === state.activeSeasonId;
    return '<button type="button" class="rw-card" data-dragonseason="' + rewardsEscape(id) + '" style="width:100%;text-align:left;cursor:pointer;' + (id === selectedId ? 'border-color:var(--bd);' : '') + '"><b>' + rewardsEscape(row.name || id) + '</b><div class="rw-cell-sub">' + rewardsEscape(row.status || 'draft') + (active ? ' · LIVE' : '') + ' · ' + rewardsEscape(rewardsDragonDateInput(row.startAt)) + ' to ' + rewardsEscape(rewardsDragonDateInput(row.endAt)) + '</div></button>';
  }).join('') : '<div class="rw-empty"><div class="rw-empty-ic">🐉</div><div class="rw-empty-t">No quest season yet.</div><div class="rw-empty-s">Create the Ember Cup starter story, then adjust every mission and reward before publishing.</div></div>';
  return '<div class="rw-card"><div class="rw-card-head"><div><h4 class="rw-card-title">Dragon Brew Quest</h4><div class="rw-cell-sub">An optional story game for Rewards members. Only completed in-store POS orders can advance the active chapter.</div></div><button type="button" class="rw-btn ok" id="dragonNewSeason">Create story season</button></div></div>' +
    rewardsDragonSeasonFormHtml() + cards + (selectedId ? rewardsDragonSeasonDetailHtml(selectedId) : '');
}

function rewardsDragonSeasonFormHtml() {
  var edit = _rewardsState.dragon.editingSeason;
  if (!edit) return '';
  return '<div class="rw-form"><div class="rw-form-title">' + (edit.isNew ? 'New story season' : 'Edit draft story') + '</div><div class="rw-fields">' +
    '<div class="rw-field" style="flex:1;min-width:260px"><label>Season title</label><input id="dragonSeasonName" style="width:100%" value="' + rewardsEscape(edit.name || '') + '"></div>' +
    '<div class="rw-field"><label>Starts</label><input type="date" id="dragonSeasonStart" value="' + rewardsEscape(edit.startDate || rewardsDragonDateInput(edit.startAt)) + '"></div>' +
    '<div class="rw-field"><label>Ends</label><input type="date" id="dragonSeasonEnd" value="' + rewardsEscape(edit.endDate || rewardsDragonDateInput(edit.endAt)) + '"></div></div>' +
    '<div class="rw-field" style="margin-top:.65rem"><label>Opening story</label><textarea id="dragonSeasonStory" rows="5" maxlength="1200" style="display:block;width:100%;margin-top:.22rem;padding:.55rem;border:1px solid var(--cd);border-radius:8px;font:400 .8rem Inter,sans-serif">' + rewardsEscape(edit.story || '') + '</textarea></div>' +
    '<div class="rw-form-actions"><button type="button" class="rw-btn ok" id="dragonSeasonSave">Save draft</button><button type="button" class="rw-btn sec" id="dragonSeasonCancel">Cancel</button></div></div>';
}

function rewardsDragonSeasonDetailHtml(seasonId) {
  var state = _rewardsState.dragon, season = state.seasons[seasonId] || {}, missions = state.missions[seasonId] || {};
  var ordered = Object.keys(missions).map(function (id) { return Object.assign({missionId: id}, missions[id]); }).sort(function (a, b) { return Number(a.sequence) - Number(b.sequence); });
  var draft = season.status === 'draft';
  var actions = draft ? '<button type="button" class="rw-btn sec" id="dragonEditSeason">Edit story</button><button type="button" class="rw-btn ok" id="dragonPublish">Publish &amp; open season</button>' : season.status === 'published' ? '<button type="button" class="rw-btn sec" data-dragonaction="pause">Pause</button><button type="button" class="rw-btn danger" data-dragonaction="close">Close season</button>' : season.status === 'paused' ? '<button type="button" class="rw-btn ok" data-dragonaction="resume">Resume</button><button type="button" class="rw-btn danger" data-dragonaction="close">Close season</button>' : '';
  actions += '<button type="button" class="rw-btn sec" data-dragonaction="clone">Clone to new draft</button>';
  var rows = ordered.length ? ordered.map(function (m) { return '<tr><td>' + Number(m.sequence) + '</td><td><b>' + rewardsEscape(m.name) + '</b><div class="rw-cell-sub">' + rewardsEscape(m.requirementText) + '</div></td><td>' + rewardsEscape(m.rewardName) + '</td><td class="rw-actions">' + (draft ? '<button type="button" class="rw-btn sm sec" data-dragonmission="' + rewardsEscape(m.missionId) + '">Edit</button>' : '') + '</td></tr>'; }).join('') : '<tr><td colspan="4">No missions yet. Add Chapter 1 before publishing.</td></tr>';
  return '<div class="rw-card"><div class="rw-card-head"><div><h4 class="rw-card-title">' + rewardsEscape(season.name || seasonId) + '</h4><div class="rw-cell-sub">' + rewardsEscape(season.story || '') + '</div></div></div><div class="rw-actions-row">' + actions + '</div></div>' +
    '<div class="rw-card"><div class="rw-card-head"><h4 class="rw-card-title">Story chapters</h4>' + (draft ? '<button type="button" class="rw-btn ok" id="dragonNewMission">Add next chapter</button>' : '') + '</div><table class="rw-table"><thead><tr><th>#</th><th>Mission</th><th>Reward</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>' + rewardsDragonMissionFormHtml() + '</div>';
}

function rewardsDragonMissionFormHtml() {
  var edit = _rewardsState.dragon.editingMission;
  if (!edit) return '';
  var types = [{id:'item_quantity',label:'Buy a quantity of eligible items'}, {id:'distinct_items',label:'Try different eligible menu items'}, {id:'pair_same_order',label:'Pair two item/category groups in one order'}, {id:'different_day_visits',label:'Visit on different business days'}];
  return '<div class="rw-form"><div class="rw-form-title">Chapter ' + Number(edit.sequence || 1) + '</div><div class="rw-fields">' +
    '<div class="rw-field"><label>Sequence</label><input id="dragonMissionSequence" type="number" min="1" max="20" value="' + rewardsEscape(edit.sequence || 1) + '"></div>' +
    '<div class="rw-field" style="flex:1;min-width:220px"><label>Chapter name</label><input id="dragonMissionName" style="width:100%" value="' + rewardsEscape(edit.name || '') + '"></div>' +
    '<div class="rw-field"><label>Mechanic</label><select id="dragonMissionType">' + types.map(function(t){return '<option value="'+t.id+'"'+(edit.requirementType===t.id?' selected':'')+'>'+rewardsEscape(t.label)+'</option>';}).join('') + '</select></div>' +
    '<div class="rw-field"><label>Target</label><input id="dragonMissionTarget" type="number" min="1" max="30" value="' + rewardsEscape(edit.targetCount || 1) + '"></div>' +
    '<div class="rw-field"><label>Minimum order ₱</label><input id="dragonMissionMinimum" type="number" min="0" step="0.01" value="' + rewardsEscape(edit.minimumNetAmount || 0) + '"></div></div>' +
    '<div class="rw-field" style="margin-top:.6rem"><label>Chapter story</label><textarea id="dragonMissionStory" rows="4" maxlength="1200" style="display:block;width:100%;margin-top:.22rem;padding:.55rem;border:1px solid var(--cd);border-radius:8px;font:400 .8rem Inter,sans-serif">' + rewardsEscape(edit.story || '') + '</textarea></div>' +
    '<div class="rw-field" style="margin-top:.6rem"><label>Clear customer instruction</label><input id="dragonMissionRequirement" style="width:100%" value="' + rewardsEscape(edit.requirementText || '') + '"></div>' +
    '<div class="rw-fields" style="margin-top:.6rem"><div class="rw-field"><label>Eligible item IDs (comma separated)</label><input id="dragonMissionItems" value="' + rewardsEscape(Array.isArray(edit.itemIds) ? edit.itemIds.join(',') : edit.itemIds || '') + '"></div><div class="rw-field"><label>Eligible category IDs</label><input id="dragonMissionCategories" value="' + rewardsEscape(Array.isArray(edit.categoryIds) ? edit.categoryIds.join(',') : edit.categoryIds || '') + '"></div><div class="rw-field"><label>Pair item IDs</label><input id="dragonMissionPairItems" value="' + rewardsEscape(Array.isArray(edit.pairItemIds) ? edit.pairItemIds.join(',') : edit.pairItemIds || '') + '"></div><div class="rw-field"><label>Pair category IDs</label><input id="dragonMissionPairCategories" value="' + rewardsEscape(Array.isArray(edit.pairCategoryIds) ? edit.pairCategoryIds.join(',') : edit.pairCategoryIds || '') + '"></div></div>' +
    '<div class="rw-fields" style="margin-top:.6rem"><div class="rw-field"><label>Reward</label><select id="dragonMissionRewardId">' + rewardsDragonOptions(edit.rewardId || '') + '</select></div><div class="rw-field" style="flex:1;min-width:220px"><label>Customer-facing reward name</label><input id="dragonMissionRewardName" style="width:100%" value="' + rewardsEscape(edit.rewardName || '') + '"></div></div>' +
    '<div class="rw-checks"><label><input type="checkbox" id="dragonMissionOne"' + (edit.oneCreditPerOrder ? ' checked' : '') + '> Maximum one credit per order</label><label><input type="checkbox" id="dragonMissionEnabled"' + (edit.enabled !== false ? ' checked' : '') + '> Enabled</label></div>' +
    '<div class="rw-form-actions"><button type="button" class="rw-btn ok" id="dragonMissionSave">Save chapter</button><button type="button" class="rw-btn sec" id="dragonMissionCancel">Cancel</button></div></div>';
}

function rewardsDragonLoad() {
  var api = rewardsApi(); if (!api || _rewardsState.busy) return;
  _rewardsState.busy = true; renderRewards();
  Promise.all([api.manageDragonQuest({action:'list'}), api.manageLoyaltyRewardCatalog({action:'list'})]).then(function(results) {
    var data = (results[0] && results[0].data) || {};
    _rewardsState.dragon.seasons = data.seasons || {}; _rewardsState.dragon.missions = data.missions || {}; _rewardsState.dragon.activeSeasonId = data.activeSeasonId || null; _rewardsState.dragon.loaded = true;
    _rewardsState.catalog = ((results[1] && results[1].data) || {}).catalog || {}; _rewardsState.catalogLoaded = true;
  }).catch(function(error) { _rewardsState.note = rewardsMessage(error, 'Could not load Dragon Brew Quest.'); _rewardsState.noteBad = true; }).then(function(){ _rewardsState.busy = false; renderRewards(); });
}

function rewardsDragonCall(payload, success) {
  var api = rewardsApi(); if (!api || _rewardsState.busy) return;
  _rewardsState.busy = true; renderRewards();
  api.manageDragonQuest(payload).then(function() { _rewardsState.note = success; _rewardsState.noteBad = false; _rewardsState.dragon.editingSeason = null; _rewardsState.dragon.editingMission = null; _rewardsState.dragon.loaded = false; _rewardsState.busy = false; rewardsDragonLoad(); }).catch(function(error) { _rewardsState.busy = false; _rewardsState.note = rewardsMessage(error, 'Dragon Brew Quest could not be updated.'); _rewardsState.noteBad = true; renderRewards(); });
}

function rewardsDragonWire(root) {
  var state = _rewardsState.dragon;
  root.querySelectorAll('[data-dragonseason]').forEach(function(btn){btn.onclick=function(){state.selectedSeasonId=btn.getAttribute('data-dragonseason');state.editingMission=null;state.editingSeason=null;renderRewards();};});
  var newSeason = root.querySelector('#dragonNewSeason'); if (newSeason) newSeason.onclick=function(){state.editingSeason=rewardsDragonStoryTemplate();renderRewards();};
  var cancelSeason = root.querySelector('#dragonSeasonCancel'); if(cancelSeason)cancelSeason.onclick=function(){state.editingSeason=null;renderRewards();};
  var saveSeason = root.querySelector('#dragonSeasonSave'); if(saveSeason)saveSeason.onclick=function(){var edit=state.editingSeason||{};rewardsDragonCall({action:'save_season',seasonId:edit.seasonId||null,name:root.querySelector('#dragonSeasonName').value,story:root.querySelector('#dragonSeasonStory').value,startAt:new Date(root.querySelector('#dragonSeasonStart').value+'T00:00:00+08:00').getTime(),endAt:new Date(root.querySelector('#dragonSeasonEnd').value+'T23:59:59+08:00').getTime()},'Quest story draft saved.');};
  var editSeason = root.querySelector('#dragonEditSeason'); if(editSeason)editSeason.onclick=function(){var id=state.selectedSeasonId,row=state.seasons[id]||{};state.editingSeason=Object.assign({seasonId:id,startDate:rewardsDragonDateInput(row.startAt),endDate:rewardsDragonDateInput(row.endAt)},row);renderRewards();};
  var newMission=root.querySelector('#dragonNewMission');if(newMission)newMission.onclick=function(){var rows=state.missions[state.selectedSeasonId]||{},next=Object.keys(rows).reduce(function(n,id){return Math.max(n,Number(rows[id].sequence)||0);},0)+1;state.editingMission=rewardsDragonChapterTemplate(next);renderRewards();};
  root.querySelectorAll('[data-dragonmission]').forEach(function(btn){btn.onclick=function(){var id=btn.getAttribute('data-dragonmission'),row=(state.missions[state.selectedSeasonId]||{})[id]||{};state.editingMission=Object.assign({missionId:id},row);renderRewards();};});
  var cancelMission=root.querySelector('#dragonMissionCancel');if(cancelMission)cancelMission.onclick=function(){state.editingMission=null;renderRewards();};
  var saveMission=root.querySelector('#dragonMissionSave');if(saveMission)saveMission.onclick=function(){var edit=state.editingMission||{},rewardId=root.querySelector('#dragonMissionRewardId').value;rewardsDragonCall({action:'save_mission',seasonId:state.selectedSeasonId,missionId:edit.missionId||null,sequence:Number(root.querySelector('#dragonMissionSequence').value),name:root.querySelector('#dragonMissionName').value,story:root.querySelector('#dragonMissionStory').value,requirementText:root.querySelector('#dragonMissionRequirement').value,requirementType:root.querySelector('#dragonMissionType').value,targetCount:Number(root.querySelector('#dragonMissionTarget').value),minimumNetAmount:Number(root.querySelector('#dragonMissionMinimum').value)||0,itemIds:root.querySelector('#dragonMissionItems').value,categoryIds:root.querySelector('#dragonMissionCategories').value,pairItemIds:root.querySelector('#dragonMissionPairItems').value,pairCategoryIds:root.querySelector('#dragonMissionPairCategories').value,oneCreditPerOrder:root.querySelector('#dragonMissionOne').checked,rewardType:'catalog',rewardId:rewardId,rewardName:root.querySelector('#dragonMissionRewardName').value,enabled:root.querySelector('#dragonMissionEnabled').checked},'Quest chapter saved.');};
  var publish=root.querySelector('#dragonPublish');if(publish)publish.onclick=function(){if(confirm('Publish this season? Its story, mission requirements and reward snapshots become immutable for customer fairness.'))rewardsDragonCall({action:'publish',seasonId:state.selectedSeasonId},'Dragon Brew Quest is published.');};
  root.querySelectorAll('[data-dragonaction]').forEach(function(btn){btn.onclick=function(){var action=btn.getAttribute('data-dragonaction');if((action==='close'||action==='clone')&&!confirm(action==='close'?'Close this quest season? Customer progress will stop.':'Clone this season into a new editable draft?'))return;rewardsDragonCall({action:action,seasonId:state.selectedSeasonId},'Quest season updated.');};});
}
