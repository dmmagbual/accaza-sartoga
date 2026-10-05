
/* Recipe repair & restore.
   A "Hot" choice written as the complete hot recipe was ADDED to the base, so every hot
   drink was costed and drawn from stock twice. This screen takes a restore point first,
   shows exactly what moves, then rewrites those choices as differences from the base. */

function recTempSeal(value){
  function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.keys(v).sort().reduce(function(o,k){o[k]=stable(v[k]);return o;},{});}
  return crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(value)))).then(function(buf){
    return Array.prototype.map.call(new Uint8Array(buf),function(b){return ('0'+b.toString(16)).slice(-2);}).join('');
  });
}

/* ---- Correcting the COGS that was already posted twice ---------------------------------- */

