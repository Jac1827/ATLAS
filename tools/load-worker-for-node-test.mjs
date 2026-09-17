import fs from 'node:fs';
// Route tests run in Node. Durable Object implementations are exercised separately
// in their own tests; the SQL-backed object uses the Workers-only runtime import.
export async function loadWorker() {
  const url=new URL('../src/worker.mjs',import.meta.url);
  const source=fs.readFileSync(url,'utf8').replace(/^export \{.*\} from .*;$/mg,'')
    .replace(/^import ['"]([^'"]+)['"];$/mg,(_,path)=>`import ${JSON.stringify(new URL(path,url).href)};`);
  return (await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))).default;
}
