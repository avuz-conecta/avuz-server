export const summarize = (results) => ({
  total: results.length,
  joined: results.filter((r) => r.joined).length,
  ice: results.filter((r) => r.ice).length,
  withErrors: results.filter((r) => r.errors.length > 0).length,
});

const yesNo = (value) => (value ? "yes" : "NO");

export const formatReport = (results) => {
  const rows = results.map((r) =>
    [
      r.name.padEnd(14),
      `join:${yesNo(r.joined)}`.padEnd(10),
      `ice:${yesNo(r.ice)}`.padEnd(9),
      `remote:${r.remote}`.padEnd(11),
      r.errors.length ? `errors:${r.errors.join("|")}` : "errors:-",
    ].join(" "),
  );
  const s = summarize(results);
  const footer = `\n${s.joined}/${s.total} joined, ${s.ice}/${s.total} ice, ${s.withErrors} with errors`;
  return `${rows.join("\n")}${footer}`;
};
