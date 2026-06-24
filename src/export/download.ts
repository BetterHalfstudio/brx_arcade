// Trigger a browser download for an exported PNG blob. Fully client-side.

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // give the click a tick before revoking
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function stampName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    "BRX_ARCADE_" +
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    "-" +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds()) +
    ".png"
  );
}
