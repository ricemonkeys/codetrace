export function greet(name: string): string {
  return formatGreeting(`Hello, ${name}!`);
}

export function formatGreeting(message: string): string {
  return message.toUpperCase();
}

export function main(): void {
  const out = greet('CodeTrace');
  console.log(out);
}
