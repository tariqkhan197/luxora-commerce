/** A small ranked table for the reports (first column is the label, the rest are right-aligned figures). */
export function RankingTable({
  title,
  headers,
  rows,
  empty,
}: {
  title: string;
  headers: string[];
  rows: string[][];
  empty: string;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="text-sm font-medium text-ink">{title}</h2>
      {rows.length ? (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-ink-faint">
            <tr>
              {headers.map((header, index) => (
                <th key={header} className={`py-1 font-normal ${index > 0 ? "text-right" : ""}`}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, index) => (
                  <td key={index} className={`py-1.5 ${index > 0 ? "text-right tabular-nums" : "text-ink"}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-ink-soft">{empty}</p>
      )}
    </section>
  );
}
