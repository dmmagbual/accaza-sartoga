
// ── FEEDBACK ──
window.submitContact=async function(){
  const name=document.getElementById('conName').value.trim(),contact=document.getElementById('conContact').value.trim(),subject=document.getElementById('conSubject').value.trim(),message=document.getElementById('conMessage').value.trim();
  if(!name||!message){alert('Please fill in name and message.');return;}
  const body=(subject?('['+subject+'] '):'')+message;
  if(body.length>800){alert('Message is too long (max 800 characters). Please shorten it.');return;}
  const btn=document.querySelector("button[onclick='submitContact()']");if(btn)btn.disabled=true;
  try{await push(feedbacksRef,{name,contact,type:'Contact',message:body,status:'Unread',date:new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'}),timestamp:Date.now()});
    document.getElementById('conName').value='';document.getElementById('conContact').value='';document.getElementById('conSubject').value='';document.getElementById('conMessage').value='';
    document.getElementById('conConfirm').style.display='block';setTimeout(function(){document.getElementById('conConfirm').style.display='none';},6000);
  }catch(e){alert('Could not send your message: '+((e&&e.message)||e)+' Please try again or email us directly.');}
  finally{if(btn)btn.disabled=false;}
};
window.updateFbCounter=function(){const len=document.getElementById('fbMessage').value.length;const c=document.getElementById('fbCounter');c.textContent=len+' / 800';c.style.color=len>=720?'#ff8080':len>=560?'#f39c12':'rgba(224,212,198,0.5)';};
window.submitFeedback=async function(){
  const name=document.getElementById('fbName').value.trim(),message=document.getElementById('fbMessage').value.trim(),type=document.getElementById('fbType').value;
  if(!name||!message){alert('Please enter your name and message.');return;}
  try{await push(feedbacksRef,{name,contact:document.getElementById('fbContact').value.trim(),type,message,status:'Unread',date:new Date().toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'}),timestamp:Date.now()});
  document.getElementById('fbName').value='';document.getElementById('fbContact').value='';document.getElementById('fbMessage').value='';document.getElementById('fbCounter').textContent='0 / 800';
  const msgs={Complaint:'🙏 Thank you for letting us know. We sincerely apologize and will look into this right away.',Suggestion:'💡 Thank you for your suggestion!',Compliment:"❤️ Oh, this made our day! Thank you so much. ☕🐻",Other:'💛 Thank you for reaching out!'};
  document.getElementById('fbConfirmMsg').textContent=msgs[type]||msgs.Other;document.getElementById('fbConfirm').style.display='block';setTimeout(function(){document.getElementById('fbConfirm').style.display='none';},6000);}catch(e){alert('Error: '+e.message);}
};
