const DB_NAME="EasyMocap2Temp";
const DB_VERSION=1;
const STORE="session";
const KEY="latest";

function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE);
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error("No pude abrir IndexedDB"));
  });
}

function requestValue(req){
  return new Promise((resolve,reject)=>{
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error("Falló IndexedDB"));
  });
}

function txDone(tx){
  return new Promise((resolve,reject)=>{
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error||new Error("Falló IndexedDB"));
    tx.onabort=()=>reject(tx.error||new Error("IndexedDB abortada"));
  });
}

export function audioSignature(file){
  if(!file)return null;
  return [file.name||"",file.size||0,file.lastModified||0,file.type||""].join("|");
}

export async function saveLatestTake({take,audioFile}){
  if(!take||!audioFile)throw new Error("Falta take o audio para sesión temporal.");
  const db=await openDb();
  try{
    const readTx=db.transaction(STORE,"readonly");
    const existing=await requestValue(readTx.objectStore(STORE).get(KEY));
    await txDone(readTx);

    const sig=audioSignature(audioFile);
    const same=existing?.audioSignature===sig;
    const next={
      audioSignature:sig,
      audioBlob:audioFile,
      audioName:audioFile.name||"audio",
      audioType:audioFile.type||"",
      savedAt:new Date().toISOString(),
      body:same?(existing?.body||null):null,
      face:same?(existing?.face||null):null
    };
    next[take.mode]=take;

    const writeTx=db.transaction(STORE,"readwrite");
    writeTx.objectStore(STORE).put(next,KEY);
    await txDone(writeTx);
    return next;
  }finally{
    db.close();
  }
}

export async function loadLatestSession(){
  const db=await openDb();
  try{
    const tx=db.transaction(STORE,"readonly");
    const value=await requestValue(tx.objectStore(STORE).get(KEY));
    await txDone(tx);
    return value||null;
  }finally{
    db.close();
  }
}

export async function clearLatestSession(){
  const db=await openDb();
  try{
    const tx=db.transaction(STORE,"readwrite");
    tx.objectStore(STORE).delete(KEY);
    await txDone(tx);
  }finally{
    db.close();
  }
}
