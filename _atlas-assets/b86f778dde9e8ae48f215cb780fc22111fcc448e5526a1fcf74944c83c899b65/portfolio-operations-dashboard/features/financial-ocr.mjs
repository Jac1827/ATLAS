// Local-in-browser OCR: document pixels are not sent to a recognition service.
let library;
function load(){
 if(window.Tesseract)return Promise.resolve(window.Tesseract);
 if(library)return library;
 library=new Promise((resolve,reject)=>{const script=document.createElement('script');const timer=setTimeout(()=>{script.remove();reject(Error('OCR library timed out.'));},20000);script.src='https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';script.onload=()=>{clearTimeout(timer);resolve(window.Tesseract);};script.onerror=()=>{clearTimeout(timer);script.remove();reject(Error('OCR unavailable. Retry this package when the library is reachable.'));};document.head.append(script);}).catch(e=>{library=null;throw e;});return library;
}
export async function recognizePage(page,{signal,onProgress=()=>{}}={}){
 const check=()=>{if(signal?.aborted)throw new DOMException('OCR canceled','AbortError');};check();
 const t=await load();check();let worker,render,timer,canvas=document.createElement('canvas');
 const cancel=()=>{render?.cancel();void worker?.terminate();};signal?.addEventListener('abort',cancel,{once:true});
 try{
  worker=await t.createWorker('eng',1,{workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@6.0.0',logger:m=>onProgress(`Reading scanned statement: ${m.status} ${Math.round((m.progress||0)*100)}%`)});check();
  const viewport=page.getViewport({scale:Math.min(2.5,3000/Math.max(page.view[2],page.view[3]))});canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  render=page.render({canvasContext:canvas.getContext('2d'),viewport});await render.promise;check();
  await worker.setParameters({preserve_interword_spaces:'1'});
  const result=await Promise.race([worker.recognize(canvas),new Promise((_,reject)=>{timer=setTimeout(()=>{cancel();reject(Error('OCR exceeded the per-page limit. Review a clearer statement copy.'));},60000);})]);check();
  return {text:result.data.text,confidence:result.data.confidence};
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);await worker?.terminate();canvas.width=canvas.height=0;canvas=null;}
}
