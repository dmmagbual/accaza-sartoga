import fs from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc} from 'firebase/firestore';

const projectId='accaza-sartoga';
const rules=fs.readFileSync('firestore.rules','utf8');
const env=await initializeTestEnvironment({projectId,firestore:{rules}});

try{
  await env.withSecurityRulesDisabled(async(context)=>{
    await setDoc(doc(context.firestore(),'historicalOrders','seed'),{order:{id:'seed'},schemaVersion:1});
  });
  const guest=env.unauthenticatedContext().firestore();
  const owner=env.authenticatedContext('owner').firestore();
  await assertFails(getDoc(doc(guest,'historicalOrders','seed')));
  await assertFails(getDoc(doc(owner,'historicalOrders','seed')));
  await assertFails(setDoc(doc(owner,'historicalOrders','browser-write'),{order:{id:'browser-write'}}));
  await env.withSecurityRulesDisabled(async(context)=>{
    await assertSucceeds(getDoc(doc(context.firestore(),'historicalOrders','seed')));
  });
  console.log('PASS: Firestore historical archive rejects every browser read and write while retaining server access.');
}finally{
  await env.cleanup();
}
