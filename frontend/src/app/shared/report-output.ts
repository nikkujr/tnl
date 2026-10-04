type CsvCell = string | number | boolean | null | undefined;

export function encodeCsv(rows: ReadonlyArray<Record<string, CsvCell>>) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cell = (value: CsvCell) => {
    let text = String(value ?? '');
    // Quoting alone does not stop spreadsheet formulas in user-supplied names/reasons.
    if (typeof value === 'string' && /^[\s\uFEFF]*[=+\-@＝＋－＠]|^[\t\r\n]/u.test(text))
      text = '\t' + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return (
    '\uFEFF' +
    [columns, ...rows.map((row) => columns.map((key) => row[key]))]
      .map((row) => row.map(cell).join(','))
      .join('\r\n') +
    '\r\n'
  );
}

export function downloadCsv(filename: string, rows: ReadonlyArray<Record<string, CsvCell>>) {
  const url = URL.createObjectURL(new Blob([encodeCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function printReport() {
  const closed = [
    ...document.querySelectorAll<HTMLDetailsElement>('.print-report details:not([open])'),
  ];
  closed.forEach((details) => (details.open = true));
  window.addEventListener('afterprint', () => closed.forEach((details) => (details.open = false)), {
    once: true,
  });
  window.print();
}
