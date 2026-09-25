// Accaza AI business context (Sep 2026): the Business Profile and the Campaign Log that
// management keeps on ai-business.html, and the AI tools that read them and measure a
// campaign against the sales rollup. Stored ONLY in this feature's own Firestore collections
// (aiBusiness, aiCampaigns) through this server callable; Firestore rules still deny every
// client, and nothing here touches the Realtime Database, POS, admin or Finance Books.
// Campaigns are never hard-deleted: "archive" keeps the record and its change history.
const ACCAZA_AI_CAMPAIGN_CHANNELS = ["all","instore","grabfood","foodpanda","online","social"];
const ACCAZA_AI_CAMPAIGN_TYPES = ["discount","bundle","new_item","social_post","event","loyalty","sampling","other"];
const ACCAZA_AI_CAMPAIGN_LIMIT = 300;
const ACCAZA_AI_MEASURE_MAX_DAYS = 92;
function accazaAiBizText(value,max){return String(value==null?"":value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,"").trim().slice(0,max);}
function accazaAiBizDate(value,label){const text=String(value||"").trim();if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(Date.parse(`${text}T00:00:00+08:00`)))throw new HttpsError("invalid-argument",`${label} must be a date (YYYY-MM-DD).`);return text;}
function accazaAiBizCents(value,label){const number=Number(value==null||value===""?0:value);if(!Number.isFinite(number)||number<0||number>10000000)throw new HttpsError("invalid-argument",`${label} must be between 0 and 10,000,000.`);return Math.round(number*100);}
function accazaAiCampaignStatus(campaign,today){if(campaign.archived)return"archived";if(campaign.startDate>today)return"planned";if(campaign.endDate<today)return"ended";return"active";}
function accazaAiCampaignOut(id,row,today){const campaign=Object.assign({id},row||{});return{id,name:campaign.name||"",type:campaign.type||"other",channel:campaign.channel||"all",offer:campaign.offer||"",items:Array.isArray(campaign.items)?campaign.items:[],itemNames:Array.isArray(campaign.itemNames)?campaign.itemNames:[],startDate:campaign.startDate||"",endDate:campaign.endDate||"",cost:accazaAiPesos(campaign.costCents),promoCode:campaign.promoCode||"",goal:campaign.goal||"",notes:campaign.notes||"",status:accazaAiCampaignStatus(campaign,today),updatedAt:Number(campaign.updatedAt||0),updatedByName:campaign.updatedByName||""};}
function accazaAiProfileOut(row){const profile=row||{};return{goals:profile.goals||"",monthlyMarketingBudget:accazaAiPesos(profile.monthlyBudgetCents),targetCustomers:profile.targetCustomers||"",positioning:profile.positioning||"",competitors:profile.competitors||"",seasonality:profile.seasonality||"",constraints:profile.constraints||"",notes:profile.notes||"",updatedAt:Number(profile.updatedAt||0),updatedByName:profile.updatedByName||""};}
async function accazaAiLoadCampaigns(limit){const snap=await getFirestore().collection("aiCampaigns").orderBy("startDate","desc").limit(limit).get();return snap.docs.map(doc=>({id:doc.id,data:doc.data()||{}}));}

exports.manageAccazaAiBusiness=onCall({region:ORDER_REGION,enforceAppCheck:ENFORCE_APP_CHECK,timeoutSeconds:60,memory:"256MiB"},async request=>{
  const db=getDatabase(),actor=await requirePortalUser(db,request);
  if(!ACCAZA_AI_TOOL_ROLES.includes(actor.role))throw new HttpsError("permission-denied","The business profile and campaign log are for management accounts.");
  const data=request.data||{},action=accazaAiBizText(data.action,30),firestore=getFirestore(),now=Date.now(),today=financeDateFromTimestamp(now),byName=accazaAiBizText(actor.name||actor.email||actor.role,80);
  if(action==="load"){
    const [profileSnap,campaigns,menuSnap]=await Promise.all([firestore.collection("aiBusiness").doc("profile").get(),accazaAiLoadCampaigns(ACCAZA_AI_CAMPAIGN_LIMIT),/* download-ok: catalog menu item names for the campaign item picker */db.ref("/menuItems").get()]);
    const menu=Object.entries(menuSnap.val()||{}).map(([id,row])=>({id,name:accazaAiBizText(row&&row.name,80)})).filter(row=>row.name).sort((a,b)=>a.name.localeCompare(b.name));
    return{profile:accazaAiProfileOut(profileSnap.exists?profileSnap.data():null),campaigns:campaigns.map(row=>accazaAiCampaignOut(row.id,row.data,today)),menu,channels:ACCAZA_AI_CAMPAIGN_CHANNELS,types:ACCAZA_AI_CAMPAIGN_TYPES,today};
  }
  if(action==="save_profile"){
    const input=data.profile||{},profile={goals:accazaAiBizText(input.goals,1200),monthlyBudgetCents:accazaAiBizCents(input.monthlyMarketingBudget,"Monthly marketing budget"),targetCustomers:accazaAiBizText(input.targetCustomers,800),positioning:accazaAiBizText(input.positioning,800),competitors:accazaAiBizText(input.competitors,800),seasonality:accazaAiBizText(input.seasonality,800),constraints:accazaAiBizText(input.constraints,800),notes:accazaAiBizText(input.notes,1500),updatedAt:now,updatedBy:actor.uid,updatedByName:byName,schemaVersion:1};
    await firestore.collection("aiBusiness").doc("profile").set(profile);
    return{profile:accazaAiProfileOut(profile)};
  }
  if(action==="save_campaign"||action==="archive_campaign"||action==="restore_campaign"){
    const input=data.campaign||{},id=accazaAiBizText(input.id||data.id,40);
    if(id&&!/^[A-Za-z0-9_-]{6,40}$/.test(id))throw new HttpsError("invalid-argument","Invalid campaign ID.");
    const ref=id?firestore.collection("aiCampaigns").doc(id):firestore.collection("aiCampaigns").doc();
    const result=await firestore.runTransaction(async transaction=>{
      const snap=await transaction.get(ref),existing=snap.exists?snap.data()||{}:null;
      if(id&&!existing)throw new HttpsError("not-found","That campaign no longer exists.");
      if(action!=="save_campaign"){if(!existing)throw new HttpsError("not-found","Campaign not found.");const next=Object.assign({},existing,{archived:action==="archive_campaign",updatedAt:now,updatedBy:actor.uid,updatedByName:byName,history:[...(Array.isArray(existing.history)?existing.history:[]),{at:now,by:byName,action:action==="archive_campaign"?"archived":"restored"}].slice(-30)});transaction.set(ref,next);return next;}
      const name=accazaAiBizText(input.name,80);if(name.length<3)throw new HttpsError("invalid-argument","Give the campaign a name (at least 3 characters).");
      const startDate=accazaAiBizDate(input.startDate,"Start date"),endDate=accazaAiBizDate(input.endDate||input.startDate,"End date");
      if(endDate<startDate)throw new HttpsError("invalid-argument","The end date is before the start date.");
      if((Date.parse(`${endDate}T00:00:00+08:00`)-Date.parse(`${startDate}T00:00:00+08:00`))/86400000>366)throw new HttpsError("invalid-argument","A campaign can run for at most one year; split longer ones.");
      const channel=ACCAZA_AI_CAMPAIGN_CHANNELS.includes(input.channel)?input.channel:"all",type=ACCAZA_AI_CAMPAIGN_TYPES.includes(input.type)?input.type:"other";
      const items=(Array.isArray(input.items)?input.items:[]).map(value=>accazaAiBizText(value,60)).filter(value=>/^[A-Za-z0-9_-]+$/.test(value)).slice(0,20),itemNames=(Array.isArray(input.itemNames)?input.itemNames:[]).map(value=>accazaAiBizText(value,80)).slice(0,20);
      const next={name,type,channel,offer:accazaAiBizText(input.offer,300),items,itemNames,startDate,endDate,costCents:accazaAiBizCents(input.cost,"Cost"),promoCode:accazaAiBizText(input.promoCode,40),goal:accazaAiBizText(input.goal,300),notes:accazaAiBizText(input.notes,1000),archived:existing?existing.archived===true:false,createdAt:existing?Number(existing.createdAt||now):now,createdBy:existing?existing.createdBy||actor.uid:actor.uid,updatedAt:now,updatedBy:actor.uid,updatedByName:byName,schemaVersion:1};
      next.history=[...(existing&&Array.isArray(existing.history)?existing.history:[]),{at:now,by:byName,action:existing?"edited":"created"}].slice(-30);
      transaction.set(ref,next);return next;
    });
    return{campaign:accazaAiCampaignOut(ref.id,result,today)};
  }
  throw new HttpsError("invalid-argument","Unknown action.");
});

function accazaAiPeriodMetrics(days,dayList,campaign){
  let netCents=0,orders=0,tradingDays=0,channelNet=0,channelOrders=0,itemUnits=0,itemNet=0;
  dayList.forEach(day=>{const row=days[day];if(!row)return;tradingDays+=1;netCents+=Number(row.netCents)||0;orders+=Number(row.orders)||0;
    if(campaign.channel&&!["all","social"].includes(campaign.channel)){const ch=row.channels&&row.channels[campaign.channel]||{};channelNet+=Number(ch.netCents)||0;channelOrders+=Number(ch.orders)||0;}
    (campaign.items||[]).forEach(key=>{const item=row.items&&row.items[key];if(item){itemUnits+=Number(item.units)||0;itemNet+=Number(item.netCents)||0;}});});
  const perDay=value=>dayList.length?value/dayList.length:0;
  const out={calendarDays:dayList.length,tradingDays,net:accazaAiPesos(netCents),orders,netPerDay:accazaAiPesos(perDay(netCents)),ordersPerDay:Math.round(perDay(orders)*10)/10,averageTicket:orders?accazaAiPesos(netCents/orders):null,_netCents:netCents};
  if(campaign.channel&&!["all","social"].includes(campaign.channel))Object.assign(out,{channelNet:accazaAiPesos(channelNet),channelOrdersPerDay:Math.round(perDay(channelOrders)*10)/10,channelNetPerDay:accazaAiPesos(perDay(channelNet)),_channelNet:channelNet});
  if((campaign.items||[]).length)Object.assign(out,{campaignItemUnits:itemUnits,campaignItemUnitsPerDay:Math.round(perDay(itemUnits)*10)/10,campaignItemNet:accazaAiPesos(itemNet)});
  return out;
}
function accazaAiDayList(startMs,count){const list=[];for(let index=0;index<count;index+=1)list.push(new Date(startMs+index*86400000+8*3600000).toISOString().slice(0,10));return list;}
Object.assign(ACCAZA_AI_RECORD_TOOLS,{
  get_business_context:{
    description:"Accaza's business profile (goals, monthly marketing budget, target customers, positioning, competitors, seasonality, constraints) and the campaign log (planned, active, recent and past promotions with dates, channel, offer, items and cost). Call this first for strategy and marketing questions.",
    params:{},
    async run(_db,_range,_args,ctx){
      await accazaAiClaimFirestoreReads(ctx,51);
      const [profileSnap,campaigns]=await Promise.all([getFirestore().collection("aiBusiness").doc("profile").get(),accazaAiLoadCampaigns(50)]),today=financeDateFromTimestamp(Date.now());
      return{records:1+campaigns.length,result:{profile:profileSnap.exists?accazaAiProfileOut(profileSnap.data()):"No business profile saved yet. Suggest filling it in on ai-business.html.",campaigns:campaigns.map(row=>accazaAiCampaignOut(row.id,row.data,today)).filter(row=>row.status!=="archived").map(({updatedAt,updatedByName,...row})=>row),note:"Campaigns are logged by management; measure one with measure_campaign."}};
    },
  },
  measure_campaign:{
    description:"Measures one logged campaign against the sales rollup: net sales, orders and average ticket per day during the campaign versus the same number of days just before it (and just after, if it has ended), for the whole shop, the campaign's channel and its items, with the estimated extra gross profit after the campaign's cost. Also lists campaigns that overlapped it.",
    params:{campaign_id:{type:"string",description:"The campaign ID from get_business_context."}},
    async run(_db,_range,args,ctx){
      const id=String(args&&args.campaign_id||"").trim();if(!/^[A-Za-z0-9_-]{6,40}$/.test(id))return{records:0,result:{error:"Give a campaign_id from get_business_context."}};
      await accazaAiClaimFirestoreReads(ctx,51);
      const snap=await getFirestore().collection("aiCampaigns").doc(id).get();if(!snap.exists)return{records:1,result:{error:"No campaign with that ID."}};
      const campaign=snap.data()||{},todayMs=Date.parse(`${financeDateFromTimestamp(Date.now())}T00:00:00+08:00`),start=Date.parse(`${campaign.startDate}T00:00:00+08:00`),endFull=Date.parse(`${campaign.endDate}T00:00:00+08:00`);
      if(start>=todayMs)return{records:1,result:{campaign:accazaAiCampaignOut(id,campaign,financeDateFromTimestamp(Date.now())),error:"This campaign has not started yet, so there is nothing to measure."}};
      const end=Math.min(endFull,todayMs-86400000),length=Math.min(ACCAZA_AI_MEASURE_MAX_DAYS,Math.max(1,Math.round((end-start)/86400000)+1));
      const during=accazaAiDayList(start,length),before=accazaAiDayList(start-length*86400000,length),afterStart=endFull+86400000,afterLength=Math.max(0,Math.min(length,Math.round((todayMs-afterStart)/86400000))),after=endFull<todayMs-86400000&&afterLength>0?accazaAiDayList(afterStart,afterLength):[];
      const allDays=[...before,...during,...after],range={days:allDays};
      const {days,monthsRead}=await accazaAiRangeDays(ctx,range);
      const duringM=accazaAiPeriodMetrics(days,during,campaign),beforeM=accazaAiPeriodMetrics(days,before,campaign),afterM=after.length?accazaAiPeriodMetrics(days,after,campaign):null;
      let marginNet=0,marginCogs=0;[...before,...during].forEach(day=>{const row=days[day];if(row){marginNet+=Number(row.netCents)||0;marginCogs+=Number(row.cogsCents)||0;}});
      const marginRate=marginNet?(marginNet-marginCogs)/marginNet:0,focusKey=campaign.channel&&!["all","social"].includes(campaign.channel)?"_channelNet":"_netCents",extraNetCents=Math.round(((duringM[focusKey]||0)/Math.max(1,during.length)-(beforeM[focusKey]||0)/Math.max(1,before.length))*during.length),extraGrossProfitCents=Math.round(extraNetCents*marginRate),costCents=Number(campaign.costCents)||0;
      const lift=(a,b)=>accazaAiPct(a-b,b);
      const others=(await accazaAiLoadCampaigns(50)).filter(row=>row.id!==id&&row.data.archived!==true&&row.data.startDate<=campaign.endDate&&row.data.endDate>=campaign.startDate).map(row=>({name:row.data.name,channel:row.data.channel,startDate:row.data.startDate,endDate:row.data.endDate}));
      [duringM,beforeM,afterM].forEach(row=>{if(row){delete row._netCents;delete row._channelNet;}});
      return{records:2+monthsRead+50,result:{campaign:accazaAiCampaignOut(id,campaign,financeDateFromTimestamp(Date.now())),measuredDays:`${during[0]} to ${during[during.length-1]}${endFull>end?" (still running; measured to yesterday)":""}`,before:beforeM,during:duringM,after:afterM,
        change:{netPerDayPct:lift(duringM.netPerDay,beforeM.netPerDay),ordersPerDayPct:lift(duringM.ordersPerDay,beforeM.ordersPerDay),averageTicketPct:duringM.averageTicket!=null&&beforeM.averageTicket?lift(duringM.averageTicket,beforeM.averageTicket):null,channelNetPerDayPct:duringM.channelNetPerDay!=null?lift(duringM.channelNetPerDay,beforeM.channelNetPerDay):null,campaignItemUnitsPerDayPct:duringM.campaignItemUnitsPerDay!=null?lift(duringM.campaignItemUnitsPerDay,beforeM.campaignItemUnitsPerDay):null},
        estimate:{basis:focusKey==="_channelNet"?`${campaign.channel} channel net sales`:"whole-shop net sales",extraNetSales:accazaAiPesos(extraNetCents),grossMarginUsedPct:Math.round(marginRate*1000)/10,extraGrossProfit:accazaAiPesos(extraGrossProfitCents),campaignCost:accazaAiPesos(costCents),estimatedReturnAfterCost:accazaAiPesos(extraGrossProfitCents-costCents)},
        overlappingCampaigns:others,caveats:"Before-versus-during comparison, not a controlled test: weekdays, paydays, weather, holidays and overlapping campaigns also move sales. Treat the return as an estimate."}};
    },
  },
});
