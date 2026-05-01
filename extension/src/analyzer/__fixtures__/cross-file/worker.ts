export class Worker {
  public run(message: string): string {
    return this.decorate(message);
  }

  private decorate(value: string): string {
    return `[${value}]`;
  }
}
