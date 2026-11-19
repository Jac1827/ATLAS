/* Sum the decimal values that JSON/PostgreSQL sees, then round once to cents.
 * Source cells remain unchanged. Missing inputs remain unavailable. */
const finite=value=>typeof value==='number'&&Number.isFinite(value);
function decimal(value){
 const [coefficient,exponent='0']=String(value).toLowerCase().split('e'),[whole,fraction='']=coefficient.split('.');
 return {units:BigInt(whole+fraction),scale:fraction.length-Number(exponent)};
}
function total(values,subtract){
 if(!values.every(finite))return null;
 const parts=values.map(decimal),scale=Math.max(0,...parts.map(part=>part.scale));
 const units=parts.reduce((sum,part,index)=>sum+(subtract&&index>0?-1n:1n)*part.units*10n**BigInt(scale-part.scale),0n),negative=units<0n,absolute=negative?-units:units;
 let cents;
 if(scale<=2)cents=absolute*10n**BigInt(2-scale);
 else {const divisor=10n**BigInt(scale-2);cents=absolute/divisor+(absolute%divisor*2n>=divisor?1n:0n);}
 const digits=cents.toString().padStart(3,'0'),amount=Number((negative?'-':'')+digits.slice(0,-2)+'.'+digits.slice(-2));
 return Number.isFinite(amount)?amount:null;
}
export const sumMoney=values=>total(values,false);
export const differenceMoney=(...values)=>values.length?total(values,true):null;
