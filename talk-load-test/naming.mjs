export const guestName = (prefix, index, total) => {
  const width = String(total).length;
  const number = String(index + 1).padStart(width, "0");
  return `${prefix}-${number}`;
};
