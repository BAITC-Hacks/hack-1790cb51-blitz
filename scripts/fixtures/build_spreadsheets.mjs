import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'outputs/hackalem-long-documents');
const qa = path.join(root, '.test-data/fixture-qa');
const datasets = JSON.parse(await fs.readFile(path.join(qa, 'datasets.json'), 'utf8'));
const data = datasets.find(d => d.key === 'operations');

for (const phase of ['before', 'after']) {
  const workbook = Workbook.create();
  const names = phase === 'before'
    ? ['Закупки и поставки', 'Эксплуатация', 'Поддержка']
    : ['Операционные сервисы', 'Снабжение', 'Планирование ресурсов'];
  const layouts = phase === 'before' ? [[0, 1, 3], [2, 7], [4, 5, 6]] : [[0, 4, 7], [1, 3], [2, 5, 6]];
  for (let n = 0; n < names.length; n++) {
    const sheet = workbook.worksheets.add(names[n]);
    sheet.showGridLines = false;
    sheet.getRange('A2').values = [[data.config.company]];
    sheet.getRange('A3').values = [[phase === 'before' ? 'Редакция до реорганизации' : 'Редакция после реорганизации']];
    sheet.getRange('C2').values = [[data.config[phase === 'before' ? 'title' : 'after_title']]];
    sheet.getRange('C3').values = [['Одна строка описывает одну обязанность указанного подразделения']];
    sheet.getRange('A5:C5').values = [['Подразделение', 'Раздел и подраздел', 'Обязанность и порядок выполнения']];
    const records = layouts[n].flatMap(index => {
      const s = data[phase][index];
      return s.items.map((item, i) => [s.department,
        `${s.heading}. ${i < Math.ceil(s.items.length / 2) ? 'Основные обязанности' : 'Порядок выполнения'}`,
        `${item.number}. ${item.text}`]);
    });
    const last = records.length + 5;
    sheet.getRange(`A6:C${last}`).values = records;
    sheet.getRange(`A1:C${last}`).format.font = { name: 'Arial', size: 11, color: '#202833' };
    sheet.getRange(`A1:A${last}`).format.columnWidth = 36;
    sheet.getRange(`B1:B${last}`).format.columnWidth = 33;
    sheet.getRange(`C1:C${last}`).format.columnWidth = 112;
    sheet.getRange('A2:C3').format.rowHeight = 30;
    sheet.getRange('A2').format.font = {name: 'Arial', size: 15, bold: true};
    sheet.getRange('C2').format.font = {name: 'Arial', size: 15, bold: true};
    sheet.getRange('C2').format.wrapText = true;
    sheet.getRange('A3:C3').format.font = {name: 'Arial', size: 11, color: '#657080'};
    const header = sheet.getRange('A5:C5');
    header.format = {fill: '#23364B', font: {name: 'Arial', size: 11, bold: true, color: '#FFFFFF'}, wrapText: true, rowHeight: 33, horizontalAlignment: 'center', verticalAlignment: 'center'};
    const body = sheet.getRange(`A6:C${last}`);
    body.format.wrapText = true;
    body.format.verticalAlignment = 'center';
    body.format.horizontalAlignment = 'left';
    for (let i = 0; i < records.length; i++) {
      const row = sheet.getRange(`A${i + 6}:C${i + 6}`);
      row.format.rowHeight = Math.max(88, Math.ceil(records[i][2].length / 103) * 15 + 19);
      if (i % 2 === 1) row.format.fill = '#F1F4F7';
    }
    const table = sheet.tables.add(`A5:C${last}`, true, `Functions${n + 1}`);
    table.showFilterButton = true;
    sheet.freezePanes.freezeRows(5);
    sheet.freezePanes.freezeColumns(1);
    console.log(`${phase}: ${sheet.name}: ${records.length} duties`);
  }
  workbook.recalculate();
  const scan = await workbook.inspect({kind:'match', searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!', options:{useRegex:true,maxResults:20},maxChars:1000});
  console.log(scan.ndjson);
  for (let i = 0; i < names.length; i++) {
    const image = await workbook.render({sheetName:names[i],range:'A1:C9',scale:1.3,format:'png'});
    await fs.writeFile(path.join(qa, `operations-${phase}-sheet-${i + 1}.png`), new Uint8Array(await image.arrayBuffer()));
  }
  const file = await SpreadsheetFile.exportXlsx(workbook);
  await file.save(path.join(out, `operations-${phase}.xlsx`));
  await fs.rename(path.join(out, `operations-${phase}.xlsx.inspect.ndjson`), path.join(qa, `operations-${phase}.xlsx.inspect.ndjson`));
  console.log(JSON.stringify({file:`operations-${phase}.xlsx`,sheets:names}));
}
