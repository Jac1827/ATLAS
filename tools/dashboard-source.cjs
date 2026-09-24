// Source-only test helper. Browser fixtures must serve the real index and its assets.
const fs=require('node:fs'),path=require('node:path'),{fileURLToPath}=require('node:url');
function readDashboardSource(filename){
 const file=filename instanceof URL?fileURLToPath(filename):String(filename),base=path.dirname(file);
 let source=fs.readFileSync(file,'utf8');
 source=source.replace(/<script\b[^>]*\bsrc=["'](?:\.\/)?workspace-core\.js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/g,()=>'<script>\n'+fs.readFileSync(path.join(base,'workspace-core.js'),'utf8')+'\n</script>');
 source=source.replace(/<link\b[^>]*\bhref=["'](?:\.\/)?atlas-core\.css(?:\?[^"']*)?["'][^>]*\/?\s*>/g,()=>'<style>\n'+fs.readFileSync(path.join(base,'atlas-core.css'),'utf8')+'\n</style>');
 return source;
}
module.exports={readDashboardSource};
