// A review belongs to one authorization context, not to a rotating access token.
const activeScopes=new Set();
const message='Your signed-in workspace changed. Reopen the import or review before continuing.';
function context(central,host){
 const session=central?.getSession?.(),expiresAt=Number(session?.expires_at);
 return {central:host?.ATLAS_CENTRAL||central,actor:session?.user?.id,access:typeof central?.getAccessContextKey==='function'?central.getAccessContextKey():JSON.stringify(central?.getStoredProfile?.()),config:JSON.stringify(central?.getConfig?.()),valid:Boolean(session?.access_token&&session?.user?.id&&Number.isFinite(expiresAt)&&expiresAt>Math.floor(Date.now()/1000)),expiresAt};
}
export function captureReforecastSession(central,{hostWindow=globalThis.window?.parent||globalThis.window,beforeCheck,disposeWhenIdle=false}={}){
 const initial=context(central,hostWindow),dialogs=new Set();let valid=true,timer;
 const dispose=()=>{valid=false;clearTimeout(timer);hostWindow?.removeEventListener?.('atlas-central-auth-change',changed);activeScopes.delete(scope);};
 const invalidate=()=>{dispose();for(const el of [...dialogs]){if(el.open)el.close();el.remove();}dialogs.clear();};
 const check=()=>{const now=context(central,hostWindow);try{beforeCheck?.();if(!valid||!now.valid||now.central!==central||now.central!==initial.central||now.actor!==initial.actor||now.access!==initial.access||now.config!==initial.config)throw Error(message);}catch(error){invalidate();throw error;}return now;};
 const schedule=()=>{clearTimeout(timer);const now=check();timer=setTimeout(changed,Math.min(2147483647,Math.max(1,now.expiresAt*1000-Date.now())));timer?.unref?.();};
 const changed=()=>{try{schedule();}catch{/* Invalidated and closed synchronously. */}};
 const scope={check,invalidate,dispose,own(el){check();dialogs.add(el);el.addEventListener('close',()=>{dialogs.delete(el);if(disposeWhenIdle&&!dialogs.size)dispose();},{once:true});return el;}};
 activeScopes.add(scope);hostWindow?.addEventListener?.('atlas-central-auth-change',changed);schedule();return scope;
}
export function invalidateReforecastSessions(){for(const scope of [...activeScopes])scope.invalidate();}

// The chooser owns a pending load; the returned review owns it after handoff.
export async function loadReforecastDialog(central,chooser,load,{beforeCheck,...options}={}){
 let transferred=false;
 const scope=captureReforecastSession(central,{...options,disposeWhenIdle:true,beforeCheck:()=>{beforeCheck?.();if(!transferred&&(!chooser.open||!chooser.isConnected))throw Error('The import chooser was closed. Reopen it before continuing.');}});
 const closed=()=>{if(!transferred)scope.invalidate();};chooser.addEventListener('close',closed);
 try{const result=await load(scope);scope.check();transferred=true;return result;}catch(error){scope.invalidate();throw error;}finally{chooser.removeEventListener('close',closed);}
}
