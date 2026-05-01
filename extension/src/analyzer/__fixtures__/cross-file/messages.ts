export function buildMessage(name: string): string {
  return normalize(name);
}

function normalize(name: string): string {
  return name.trim();
}
