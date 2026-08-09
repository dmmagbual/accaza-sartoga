function escHtml(value){return String(value==null?'':value).replace(/[&<>"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];});}
function safeImageSrc(value){var source=String(value||'');if(/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(source)||/^https:\/\//i.test(source))return escHtml(source);return '';}

export{escHtml,safeImageSrc};
