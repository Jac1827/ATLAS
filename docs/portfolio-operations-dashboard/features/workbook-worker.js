/* One workbook per worker. Terminating the worker releases its parser, buffers and sheets. */
let workbook;
self.onmessage = async ({data}) => {
  const {id, operation} = data;
  try {
    if (operation === 'open') {
      importScripts('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
      const start = performance.now();
      workbook = XLSX.read(data.buffer, {type:'array', cellDates:true, raw:false});
      self.postMessage({id, result:{sheetNames:workbook.SheetNames, duration:performance.now()-start}});
    } else if (operation === 'sheet') {
      const start = performance.now();
      const sheet = workbook.Sheets[data.name];
      let candidate = false;
      // Inspect stored cells before conversion. Broad candidates are verified by the
      // existing report parsers; section anchors anywhere in a sheet remain discoverable.
      for (const key of Object.keys(sheet || {})) {
        if (key[0] === '!') continue;
        const value = String(sheet[key]?.w ?? sheet[key]?.v ?? '').trim();
        if (/^(availability|property pulse|lead activity|lead conversions|make ready status)\b/i.test(value)
          || /^(beginning|ending) occupied units$/i.test(value)) { candidate = true; break; }
      }
      let range;
      if (sheet?.['!ref']) range = XLSX.utils.decode_range(sheet['!ref']);
      const options = {header:1, defval:'', raw:false};
      if (range && (!candidate || data.metadata)) options.range = {...range, e:{...range.e, r:Math.min(range.e.r, range.s.r+79)}};
      const rows = XLSX.utils.sheet_to_json(sheet, options);
      const rowCount = range ? range.e.r-range.s.r+1 : 0;
      self.postMessage({id, result:{rows, rowCount, rangeStartRow:range?.s.r||0, candidate, duration:performance.now()-start}});
    } else throw new Error('Unknown workbook operation');
  } catch (error) { self.postMessage({id, error:String(error?.message || error)}); }
};
