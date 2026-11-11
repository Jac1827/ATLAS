const finite=v=>typeof v==='number'&&Number.isFinite(v);
// Match PostgreSQL numeric: operate on the retained decimal spelling and round
// once, half away from zero. Binary multiplication cannot decide a money tie.
export const decimal=value=>{const [coefficient,exponent='0']=String(value).split('e'),[whole,fraction='']=coefficient.split('.');return {units:BigInt(whole+fraction),scale:fraction.length-Number(exponent)};};
export const decimalSum=parts=>{const scale=Math.max(0,...parts.map(part=>part.scale));return {units:parts.reduce((total,part)=>total+part.units*10n**BigInt(scale-part.scale),0n),scale};};
export const decimalProduct=(a,b)=>({units:a.units*b.units,scale:a.scale+b.scale});
export const roundedDecimal=part=>{const scale=Math.max(2,part.scale),units=part.units*10n**BigInt(scale-part.scale),divisor=10n**BigInt(scale-2),absolute=units<0n?-units:units,cents=absolute/divisor+(absolute%divisor*2n>=divisor?1n:0n);if(cents===0n)return 0;const digits=cents.toString().padStart(3,'0'),result=Number((units<0n?'-':'')+digits.slice(0,-2)+'.'+digits.slice(-2));return finite(result)?result:null;};
export const roundMoney=value=>finite(value)?roundedDecimal(decimal(value)):null;
export const sumMoney=values=>values.every(finite)?roundedDecimal(decimalSum(values.map(decimal))):null;
// Multiply decimal inputs before rounding, matching PostgreSQL numeric products.
export const multiplyMoney=(...values)=>values.every(finite)?roundedDecimal(values.map(decimal).reduce(decimalProduct,{units:1n,scale:0})):null;
export const rentDriverMoney=(units,rate,growth=0,loss=0)=>[units,rate,growth,loss].every(finite)?roundedDecimal(decimalProduct(decimalProduct(decimalProduct(decimal(units),decimal(rate)),decimalSum([decimal(1),decimal(growth)])),decimalSum([decimal(1),decimal(-loss)]))):null;
